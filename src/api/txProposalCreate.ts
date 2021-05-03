import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import 'source-map-support/register';
import { v4 as uuidv4 } from 'uuid';
import {
  baseActionSchema,
  createTxSchema,
  createTokenSchema,
  mintTokenSchema,
  meltTokenSchema,
  delegateAuthoritySchema,
  destroyAuthoritySchema,
} from '@src/api/schemas';
import { ApiError } from '@src/api/errors';
import { getWalletBalances, maybeRefreshWalletConstants } from '@src/commons';
import {
  addTxProposalOutputs,
  addTxProposalTokenInfo,
  createTxProposal,
  getUnusedAddresses,
  getUtxos,
  getWallet,
  getWalletAddressDetail,
  getWalletSortedValueUtxos,
  markUtxosWithProposalId,
  getAuthorityUtxoForToken,
} from '@src/db';
import {
  AddressInfo,
  Balance,
  IWalletInput,
  IWalletOutput,
  TokenBalanceMap,
  Utxo,
  WalletTokenBalance,
  ValidationResult,
  TokenActionType,
} from '@src/types';
import { closeDbAndGetError } from '@src/api/utils';
import { arrayShuffle, closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
import hathorLib from '@hathor/wallet-lib';

const mysql = getDbConnection();

enum InputSelectionAlgo {
  USE_LARGER_UTXOS = 'use-larger-utxos',
}

interface IWalletInsufficientFunds {
  tokenId: string;
  requested: number;
  available: number;
}

export const createRegularTx = async (body, walletId: string): Promise<APIGatewayProxyResult> => {
  if (body.outputs.length > hathorLib.transaction.getMaxOutputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_OUTPUTS, { outputs: body.outputs.length });
  }

  const outputs: IWalletOutput[] = body.outputs;
  const inputs: IWalletInput[] = body.inputs;

  const inputSelectionAlgo = (function getInputAlgoFromBody() {
    if (!body.inputSelectionAlgo) {
      return InputSelectionAlgo.USE_LARGER_UTXOS;
    }

    return InputSelectionAlgo[body.inputSelectionAlgo];
  }());

  if (!inputSelectionAlgo) {
    return closeDbAndGetError(mysql, ApiError.INVALID_SELECTION_ALGORITHM);
  }

  const status = await getWallet(mysql, walletId);
  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const now = getUnixTimestamp();
  const outputsBalance = getOutputsBalance(outputs, now);

  // check if wallet's balances are enough for the request
  const balances = await getWalletBalances(mysql, now, walletId, outputsBalance.getTokens());
  const insufficientFunds = checkWalletFunds(balances, outputsBalance);
  if (insufficientFunds.length > 0) {
    return closeDbAndGetError(mysql, ApiError.INSUFFICIENT_FUNDS, { insufficient: insufficientFunds });
  }

  // fetch the utxos that will be used
  let inputUtxos = [];
  if (inputs && inputs.length > 0) {
    inputUtxos = await getUtxos(mysql, inputs);

    const missing = checkMissingUtxos(inputs, inputUtxos);

    if (missing.length > 0) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_NOT_FOUND, { missing });
    }

    // check if inputs sent by user are not part of another tx proposal
    if (checkUsedUtxos(inputUtxos)) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_ALREADY_USED);
    }
  } else {
    for (const [tokenId, tokenBalance] of outputsBalance.iterator()) {
      const utxos = await getUtxosForTokenBalance(mysql, inputSelectionAlgo, walletId, tokenId, tokenBalance);
      inputUtxos.push(...utxos);
    }
  }

  if (inputUtxos.length > hathorLib.transaction.getMaxInputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_INPUTS, { inputs: inputUtxos.length });
  }

  // the difference between inputs and outputs will be the change
  const inputsBalance = getInputsBalance(inputUtxos);
  const diff = TokenBalanceMap.merge(outputsBalance, inputsBalance);

  /* Make sure diff is 0 or lower, which means inputs sum is greater than (or equal to) outputs sum.
   * This should only happen when we receive the inputs from user and he didn't select enough inputs.
   */
  const insufficientInputs = [];
  for (const [token, tokenBalance] of diff.iterator()) {
    if (tokenBalance.total() > 0) insufficientInputs.push(token);
  }
  if (insufficientInputs.length > 0) {
    return closeDbAndGetError(mysql, ApiError.INSUFFICIENT_INPUTS, { insufficient: insufficientInputs });
  }

  const addresses = await getUnusedAddresses(mysql, walletId);
  const changeOutputs = getChangeOutputs(diff, addresses);
  const finalOutputs = outputs.concat(changeOutputs);

  // we also need to do this check here, as we may have added change outputs
  if (finalOutputs.length > hathorLib.transaction.getMaxOutputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_OUTPUTS, { outputs: finalOutputs.length });
  }

  /**
   * We shuffle the array to prevent the change address from always being the last output so we can give some more
   * privacy to the user
   */
  arrayShuffle(finalOutputs);

  // mark utxos with tx-proposal id
  // XXX should this be done atomically?
  const txProposalId = uuidv4();
  markUtxosWithProposalId(mysql, txProposalId, inputUtxos);

  await createTxProposal(mysql, txProposalId, walletId, now);
  await addTxProposalOutputs(mysql, txProposalId, finalOutputs);

  await closeDbConnection(mysql);

  const inputPromises = inputUtxos.map(async (utxo) => {
    const addressDetail: AddressInfo = await getWalletAddressDetail(mysql, walletId, utxo.address);
    // XXX We should store in address table the path of the address, not the index
    // For now we return the hardcoded path with only the address index as variable
    // The client will be prepared to receive any path when we add this in the service in the future
    const addressPath = `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/${addressDetail.index}`;
    return { txId: utxo.txId, index: utxo.index, addressPath };
  });

  const retInputs = await Promise.all(inputPromises);

  // We need to return the tokens array as it's needed to assemble the tx for mining
  const tokens = Array.from(new Set([...outputsBalance.getTokens()]));

  return {
    statusCode: 201,
    body: JSON.stringify({
      success: true,
      txProposalId,
      inputs: retInputs,
      outputs: finalOutputs,
      tokens,
    }),
  };
};

export const createToken = async (body, walletId): Promise<APIGatewayProxyResult> => {
  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const inputs: IWalletInput[] = body.inputs;

  const destinationAddress: string = await (async function getDestinationAddress() {
    if (!body.destinationAddress) {
      const unusedAddresses = await getUnusedAddresses(mysql, walletId);

      return unusedAddresses[0];
    }

    return body.destinationAddress;
  }());

  const inputSelectionAlgo = (function getInputAlgoFromBody() {
    if (!body.inputSelectionAlgo) {
      return InputSelectionAlgo.USE_LARGER_UTXOS;
    }

    return InputSelectionAlgo[body.inputSelectionAlgo];
  }());

  const { uid } = hathorLib.constants.HATHOR_TOKEN_CONFIG;

  const necessaryDepositAmount = hathorLib.tokensUtils.getDepositAmount(body.amount);

  // we create a fake output to get available utxos from the database to fill it
  const necessaryHtrBalance = new TokenBalanceMap();
  necessaryHtrBalance.set(uid, new Balance(necessaryDepositAmount, 0)); // 1% deposit

  // If inputs were sent, we must validate if they are enough for the amount of tokens we want to create.
  let inputUtxos = [];
  if (inputs && inputs.length > 0) {
    inputUtxos = await getUtxos(mysql, inputs);

    const missing = checkMissingUtxos(inputs, inputUtxos);

    if (missing.length > 0) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_NOT_FOUND, { missing });
    }

    // check if inputs sent by user are not part of another tx proposal
    if (checkUsedUtxos(inputUtxos)) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_ALREADY_USED);
    }
  } else {
    const utxos = await getUtxosForTokenBalance(mysql, inputSelectionAlgo, walletId, uid, new Balance(necessaryDepositAmount, 0));
    inputUtxos.push(...utxos);
  }

  if (inputUtxos.length > hathorLib.transaction.getMaxInputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_INPUTS, { inputs: inputUtxos.length });
  }

  // Here we should check if we selected enough hathor for the deposit
  const inputsBalance = getInputsBalance(inputUtxos);
  const htrInputBalance = inputsBalance.get(uid);

  if ((htrInputBalance.unlockedAmount * -1) < necessaryDepositAmount) {
    return closeDbAndGetError(mysql, ApiError.INSUFFICIENT_INPUTS, { insufficient: [uid] });
  }

  // Get unused addresses to be used on change and authority outputs
  const addresses = await getUnusedAddresses(mysql, walletId);

  // Create the deposit change without creating an deposit output
  const diff = TokenBalanceMap.merge(necessaryHtrBalance, inputsBalance);
  const changeOutputs = getChangeOutputs(diff, addresses);

  const tokenIndex = 1; // We only allow the creation of 1 token per api call, so this can be fixed.

  // Create the output with the token to be created
  const tokensOutputs: IWalletOutput[] = [{
    value: body.amount,
    token_data: tokenIndex,
    address: destinationAddress,
    timelock: null,
  }];

  // Create the outputs with the mint and melt authorities if necessary

  // Mint
  if (body.createMint) {
    const mintDestination: string = (function getMintDestinationAddress() {
      if (!body.mintDestination) {
        // TODO: Make sure we are not already using this address on change outputs
        return addresses[1];
      }

      return body.mintDestination;
    }());

    const mintOutput: IWalletOutput = {
      value: hathorLib.constants.TOKEN_MINT_MASK,
      // eslint-disable-next-line no-bitwise
      token_data: hathorLib.constants.TOKEN_AUTHORITY_MASK | tokenIndex,
      address: mintDestination,
      timelock: null,
    };

    tokensOutputs.push(mintOutput);
  }

  // Melt
  if (body.createMelt) {
    const meltDestination: string = (function getMeltDestinationAddress() {
      if (!body.meltDestination) {
        // TODO: Make sure we are not already using this address on change outputs
        return addresses[2];
      }

      return body.meltDestination;
    }());

    const meltOutput: IWalletOutput = {
      value: hathorLib.constants.TOKEN_MELT_MASK,
      // eslint-disable-next-line no-bitwise
      token_data: hathorLib.constants.TOKEN_AUTHORITY_MASK | tokenIndex,
      address: meltDestination,
      timelock: null,
    };

    tokensOutputs.push(meltOutput);
  }

  const finalOutputs: IWalletOutput[] = [...changeOutputs, ...tokensOutputs];

  // we also need to do this check here, as we may have added change outputs and the full-node will reject
  // the tx with too many outputs
  if (finalOutputs.length > hathorLib.transaction.getMaxOutputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_OUTPUTS, { outputs: finalOutputs.length });
  }

  const txProposalId = uuidv4();
  markUtxosWithProposalId(mysql, txProposalId, inputUtxos);

  const now = getUnixTimestamp();

  await createTxProposal(mysql, txProposalId, walletId, now, TokenActionType.CREATE_TOKEN);
  await addTxProposalOutputs(mysql, txProposalId, finalOutputs);
  await addTxProposalTokenInfo(mysql, txProposalId, body.name, body.symbol);

  // DB operations are over, close the mysql conn:
  await closeDbConnection(mysql);

  const inputPromises = inputUtxos.map(async (utxo) => {
    const addressDetail: AddressInfo = await getWalletAddressDetail(mysql, walletId, utxo.address);
    // XXX We should store in address table the path of the address, not the index
    // For now we return the hardcoded path with only the address index as variable
    // The client will be prepared to receive any path when we add this in the service in the future
    const addressPath = `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/${addressDetail.index}`;
    return { txId: utxo.txId, index: utxo.index, addressPath };
  });

  const retInputs = await Promise.all(inputPromises);

  return {
    statusCode: 201,
    body: JSON.stringify({
      success: true,
      txProposalId,
      inputs: retInputs,
      outputs: finalOutputs,
    }),
  };
};

export const mintToken = async (body, walletId): Promise<APIGatewayProxyResult> => {
  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const inputs: IWalletInput[] = body.inputs;

  const destinationAddress: string = await (async function getDestinationAddress() {
    if (!body.destinationAddress) {
      const unusedAddresses = await getUnusedAddresses(mysql, walletId);

      return unusedAddresses[0];
    }

    return body.destinationAddress;
  }());

  const inputSelectionAlgo = (function getInputAlgoFromBody() {
    if (!body.inputSelectionAlgo) {
      return InputSelectionAlgo.USE_LARGER_UTXOS;
    }

    return InputSelectionAlgo[body.inputSelectionAlgo];
  }());

  const { uid } = hathorLib.constants.HATHOR_TOKEN_CONFIG;

  const necessaryDepositAmount = hathorLib.tokensUtils.getDepositAmount(body.amount);

  let inputUtxos = [];
  if (inputs && inputs.length > 0) {
    // Fetch user-sent inputs
    inputUtxos = await getUtxos(mysql, inputs);

    const missing = checkMissingUtxos(inputs, inputUtxos);

    if (missing.length > 0) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_NOT_FOUND, { missing });
    }

    // check if inputs sent by user are not part of another tx proposal
    if (checkUsedUtxos(inputUtxos)) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_ALREADY_USED);
    }
  } else {
    const utxos = await getUtxosForTokenBalance(mysql, inputSelectionAlgo, walletId, uid, new Balance(necessaryDepositAmount, 0));
    const mintAuthorityUtxo = await getAuthorityUtxoForToken(mysql, walletId, body.token, hathorLib.constants.TOKEN_MINT_MASK);

    if (mintAuthorityUtxo) {
      inputUtxos.push(mintAuthorityUtxo);
    }

    inputUtxos.push(...utxos);
  }

  if (inputUtxos.length > hathorLib.transaction.getMaxInputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_INPUTS, { inputs: inputUtxos.length });
  }

  // check if we have exactly one mint authority for exactly the token we want to mint
  const mintAuthorities = inputUtxos.filter((utxo) => (
    utxo.authorities === hathorLib.constants.TOKEN_MINT_MASK
    && utxo.tokenId === body.token
  ));

  // more than one authority was sent from the user
  if (mintAuthorities.length > 1) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_AUTHORITIES, {
      authorities: mintAuthorities.length,
      expected: 1,
    });
  }

  // user has no authority or no authority was sent on inputs
  if (mintAuthorities.length <= 0) {
    return closeDbAndGetError(mysql, ApiError.MISSING_AUTHORITY_INPUT, {
      authority: hathorLib.constants.TOKEN_MINT_MASK,
    });
  }

  // check if we selected enough hathor for the deposit
  const inputsBalance = getInputsBalance(inputUtxos);
  const htrInputBalance = inputsBalance.get(uid);

  if ((htrInputBalance.unlockedAmount * -1) < necessaryDepositAmount) {
    return closeDbAndGetError(mysql, ApiError.INSUFFICIENT_INPUTS, { insufficient: [uid] });
  }

  // get unused addresses to be used on change outputs
  const addresses = await getUnusedAddresses(mysql, walletId);

  // create the deposit change without creating an deposit output
  const necessaryHtrBalance = new TokenBalanceMap();
  necessaryHtrBalance.set(uid, new Balance(necessaryDepositAmount, 0));
  const diff = TokenBalanceMap.merge(necessaryHtrBalance, inputsBalance);
  const changeOutputs = getChangeOutputs(diff, addresses);

  // create the output with the newly minted tokens
  const tokensOutputs: IWalletOutput[] = [{
    value: body.amount,
    token_data: 1,
    address: destinationAddress,
    timelock: null,
  }];

  // re-create the outputs with the mint authority if necessary
  if (body.createAnotherAuthority) {
    const mintDestination: string = (function getMintDestinationAddress() {
      if (!body.authorityAddress) {
        // TODO: Make sure we are not already using this address on change outputs
        return addresses[1];
      }

      return body.authorityAddress;
    }());

    const mintOutput: IWalletOutput = {
      value: hathorLib.constants.TOKEN_MINT_MASK,
      // eslint-disable-next-line no-bitwise
      token_data: hathorLib.constants.TOKEN_AUTHORITY_MASK | 1,
      address: mintDestination,
      timelock: null,
    };

    tokensOutputs.push(mintOutput);
  }

  const finalOutputs: IWalletOutput[] = [...changeOutputs, ...tokensOutputs];

  /* we also need to do this check here, as we may have added change outputs and the full-node will reject
   * the tx with too many outputs
   */
  if (finalOutputs.length > hathorLib.transaction.getMaxOutputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_OUTPUTS, { outputs: finalOutputs.length });
  }

  const txProposalId = uuidv4();
  markUtxosWithProposalId(mysql, txProposalId, inputUtxos);

  const now = getUnixTimestamp();

  await createTxProposal(mysql, txProposalId, walletId, now, TokenActionType.MINT_TOKEN);
  await addTxProposalOutputs(mysql, txProposalId, finalOutputs);

  // DB operations are over, close the mysql conn:
  await closeDbConnection(mysql);

  const inputPromises = inputUtxos.map(async (utxo) => {
    const addressDetail: AddressInfo = await getWalletAddressDetail(mysql, walletId, utxo.address);
    // XXX We should store in address table the path of the address, not the index
    // For now we return the hardcoded path with only the address index as variable
    // The client will be prepared to receive any path when we add this in the service in the future
    const addressPath = `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/${addressDetail.index}`;
    return { txId: utxo.txId, index: utxo.index, addressPath };
  });

  const retInputs = await Promise.all(inputPromises);

  return {
    statusCode: 201,
    body: JSON.stringify({
      success: true,
      txProposalId,
      inputs: retInputs,
      outputs: finalOutputs,
    }),
  };
};

export const meltToken = async (body, walletId): Promise<APIGatewayProxyResult> => {
  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const inputs: IWalletInput[] = body.inputs;

  const destinationAddress: string = await (async function getDestinationAddress() {
    if (!body.destinationAddress) {
      const unusedAddresses = await getUnusedAddresses(mysql, walletId);

      return unusedAddresses[0];
    }

    return body.destinationAddress;
  }());

  const inputSelectionAlgo = (function getInputAlgoFromBody() {
    if (!body.inputSelectionAlgo) {
      return InputSelectionAlgo.USE_LARGER_UTXOS;
    }

    return InputSelectionAlgo[body.inputSelectionAlgo];
  }());

  // calculate htr withdraw amount
  const refundedAmount = hathorLib.tokensUtils.getWithdrawAmount(body.amount);

  // if inputs were sent, we must validate if they contain an Melt Authority
  let inputUtxos = [];
  if (inputs && inputs.length > 0) {
    inputUtxos = await getUtxos(mysql, inputs);

    const missing = checkMissingUtxos(inputs, inputUtxos);

    if (missing.length > 0) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_NOT_FOUND, { missing });
    }

    // check if inputs sent by user are not part of another tx proposal
    if (checkUsedUtxos(inputUtxos)) {
      return closeDbAndGetError(mysql, ApiError.INPUTS_ALREADY_USED);
    }
  } else {
    // fetch token utxos to melt
    const utxos = await getUtxosForTokenBalance(mysql, inputSelectionAlgo, walletId, body.token, new Balance(body.amount, 0));
    const meltAuthorityUtxo = await getAuthorityUtxoForToken(mysql, walletId, body.token, hathorLib.constants.TOKEN_MELT_MASK);

    if (meltAuthorityUtxo) {
      inputUtxos.push(meltAuthorityUtxo);
    }

    inputUtxos.push(...utxos);
  }

  if (inputUtxos.length > hathorLib.transaction.getMaxInputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_INPUTS, { inputs: inputUtxos.length });
  }

  // check if we have exactly one melt authority for exactly the token we want to mint
  const meltAuthorities = inputUtxos.filter((utxo) => (
    utxo.authorities === hathorLib.constants.TOKEN_MELT_MASK
    && utxo.tokenId === body.token
  ));

  // more than one authority was sent from the user
  if (meltAuthorities.length > 1) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_AUTHORITIES, {
      authorities: meltAuthorities.length,
      expected: 1,
    });
  }

  // user has no authority or no authority was sent on inputs
  if (meltAuthorities.length <= 0) {
    return closeDbAndGetError(mysql, ApiError.MISSING_AUTHORITY_INPUT, {
      authority: hathorLib.constants.TOKEN_MELT_MASK,
    });
  }

  // check if we selected enough token to melt
  const inputsBalance = getInputsBalance(inputUtxos);
  const tokenInputBalance = inputsBalance.get(body.token);

  if ((tokenInputBalance.unlockedAmount * -1) < body.amount) {
    return closeDbAndGetError(mysql, ApiError.INSUFFICIENT_INPUTS, { insufficient: [body.token] });
  }

  // get unused addresses to be used on change outputs
  const addresses = await getUnusedAddresses(mysql, walletId);

  // create the refund change
  const meltAmountBalanceMap = new TokenBalanceMap();
  meltAmountBalanceMap.set(body.token, new Balance(body.amount, 0));

  const diff = TokenBalanceMap.merge(meltAmountBalanceMap, inputsBalance);
  const changeOutputs = getChangeOutputs(diff, addresses);

  const tokensOutputs: IWalletOutput[] = [];

  // create the output with the refunded htr
  if (refundedAmount > 0) {
    const { uid } = hathorLib.constants.HATHOR_TOKEN_CONFIG;

    tokensOutputs.push({
      token: uid,
      value: refundedAmount,
      address: destinationAddress,
      timelock: null,
    });
  }

  // re-create the outputs with the melt authority if necessary
  if (body.createAnotherAuthority) {
    const meltDestination: string = (function getMeltDestinationAddress() {
      if (!body.authorityAddress) {
        // TODO: Make sure we are not already using this address on change outputs
        return addresses[1];
      }

      return body.authorityAddress;
    }());

    const meltOutput: IWalletOutput = {
      value: hathorLib.constants.TOKEN_MELT_MASK,
      // eslint-disable-next-line no-bitwise
      token_data: hathorLib.constants.TOKEN_AUTHORITY_MASK | 1,
      address: meltDestination,
      timelock: null,
    };

    tokensOutputs.push(meltOutput);
  }

  const finalOutputs: IWalletOutput[] = [...changeOutputs, ...tokensOutputs];

  if (finalOutputs.length > hathorLib.transaction.getMaxOutputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_OUTPUTS, { outputs: finalOutputs.length });
  }

  const txProposalId = uuidv4();
  markUtxosWithProposalId(mysql, txProposalId, inputUtxos);

  const now = getUnixTimestamp();

  await createTxProposal(mysql, txProposalId, walletId, now, TokenActionType.MELT_TOKEN);
  await addTxProposalOutputs(mysql, txProposalId, finalOutputs);

  // DB operations are over, close the mysql conn:
  await closeDbConnection(mysql);

  const inputPromises = inputUtxos.map(async (utxo) => {
    const addressDetail: AddressInfo = await getWalletAddressDetail(mysql, walletId, utxo.address);
    // XXX We should store in address table the path of the address, not the index
    // For now we return the hardcoded path with only the address index as variable
    // The client will be prepared to receive any path when we add this in the service in the future
    const addressPath = `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/${addressDetail.index}`;
    return { txId: utxo.txId, index: utxo.index, addressPath };
  });

  const retInputs = await Promise.all(inputPromises);

  return {
    statusCode: 201,
    body: JSON.stringify({
      success: true,
      txProposalId,
      inputs: retInputs,
      outputs: finalOutputs,
    }),
  };
};

export const delegateAuthority = async (body, walletId): Promise<APIGatewayProxyResult> => {
  const status = await getWallet(mysql, walletId);
  console.log(body);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  return {
    statusCode: 501,
    body: JSON.stringify({
      success: false,
      message: 'Not yet implemented.',
    }),
  };
};

export const destroyAuthority = async (body, walletId): Promise<APIGatewayProxyResult> => {
  const status = await getWallet(mysql, walletId);
  console.log(body);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  return {
    statusCode: 501,
    body: JSON.stringify({
      success: false,
      message: 'Not yet implemented.',
    }),
  };
};

/*
 * Create a tx-proposal.
 *
 * This lambda is called by API Gateway on POST /txproposals
 */
export const create: APIGatewayProxyHandler = async (event) => {
  await maybeRefreshWalletConstants(mysql);

  // Validate actionType and walletId:
  const baseTx = validateBody(event, 'base');

  if (baseTx.error) {
    const details = baseTx.error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  // Validate the body, using the actionType
  const { value, error } = validateBody(event, baseTx.value.actionType);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const body = value;
  const walletId = baseTx.value.id;

  let response: APIGatewayProxyResult = {
    statusCode: 500,
    body: JSON.stringify({
      success: false,
      message: 'Invalid action type',
    }),
  };

  switch (baseTx.value.actionType) {
    case TokenActionType.REGULAR_TRANSACTION:
      response = await createRegularTx(body, walletId);
      break;
    case TokenActionType.CREATE_TOKEN:
      response = await createToken(body, walletId);
      break;
    case TokenActionType.MINT_TOKEN:
      response = await mintToken(body, walletId);
      break;
    case TokenActionType.MELT_TOKEN:
      response = await meltToken(body, walletId);
      break;
    case TokenActionType.DELEGATE_MINT:
      response = await delegateAuthority(body, walletId);
      break;
    case TokenActionType.DELEGATE_MELT:
      response = await delegateAuthority(body, walletId);
      break;
    case TokenActionType.DESTROY_MINT:
      response = await destroyAuthority(body, walletId);
      break;
    case TokenActionType.DESTROY_MELT:
      response = await destroyAuthority(body, walletId);
      break;
    default:
      break;
  }

  return response;
};

/**
 * Calculates the total balance for the outputs.
 *
 * @param outputs - List of outputs
 * @param now - Current timestamp
 * @returns A balance map merging all outputs
 */
export const getOutputsBalance = (outputs: IWalletOutput[], now: number): TokenBalanceMap => {
  let outputsBalance = null;
  for (const output of outputs) {
    const decoded = { type: 'P2PKH', address: output.address, timelock: output.timelock };
    // take advantage of TokenBalanceMap.fromTxOuput
    const txOutput = {
      decoded,
      value: output.value,
      token: output.token,
      // This is being done in https://github.com/HathorNetwork/hathor-wallet-service/pull/13
      token_data: 0,
      script: null,
      spent_by: null,
      locked: output.timelock > now,
    };
    outputsBalance = TokenBalanceMap.merge(outputsBalance, TokenBalanceMap.fromTxOutput(txOutput));
  }
  return outputsBalance;
};

/**
 * Calculates the total balance for the input UTXOs.
 *
 * @param inputUtxos - List of input UTXOs
 * @returns A balance map merging all input UTXOs
 */
export const getInputsBalance = (inputUtxos: Utxo[]): TokenBalanceMap => {
  let inputsBalance = null;
  for (const utxo of inputUtxos) {
    const decoded = { type: 'P2PKH', address: utxo.address, timelock: utxo.timelock };
    // take advantage of TokenBalanceMap.fromTxInput
    const txInput = {
      decoded,
      tx_id: utxo.txId,
      index: utxo.index,
      value: utxo.value,
      token: utxo.tokenId,
      // TODO not handling authorities
      token_data: 0,
      script: null,
    };
    inputsBalance = TokenBalanceMap.merge(inputsBalance, TokenBalanceMap.fromTxInput(txInput));
  }
  return inputsBalance;
};

/**
 * Create the change outputs, given the difference between inputs and outputs.
 *
 * @remarks
 * Balances should either be zero or negative. A positive balance would indicate that the sum of
 * outputs is greater than the inputs, which would make an invalid transaction.
 *
 * @param diff - The difference between outputs and inputs
 * @returns The change outputs
 */
export const getChangeOutputs = (diff: TokenBalanceMap, addresses: string[]): IWalletOutput[] => {
  const changeOutputs = [];
  let addressToUse = 0;
  for (const [token, balance] of diff.iterator()) {
    if (balance.total() < 0) {
      changeOutputs.push({
        address: addresses[addressToUse++],
        value: Math.abs(balance.total()),
        token,
        timelock: null,
      });

      if (addressToUse >= addresses.length) {
        // this treats an unlikely case, where we have more change outputs than addresses. In this case,
        // we will repeat some addresses. Ideally, we should just generate more, but it's so unlikely
        // that this happens that we can handle it later
        addressToUse = 0;
      }
    }
  }
  return changeOutputs;
};

/**
 * Select the UTXOs to be spent, given the token balance.
 *
 * @param _mysql - The database connection
 * @param inputSelectionAlgo - The input selection algorithm
 * @param walletId - The wallet id
 * @param tokenId - The token id
 * @param tokenBalance - Balance for the queried token
 * @returns A list of UTXOs that sum at least the requested balance
 */
const getUtxosForTokenBalance = async (
  _mysql: ServerlessMysql,
  inputSelectionAlgo: InputSelectionAlgo,
  walletId: string,
  tokenId: string,
  tokenBalance: Balance,
): Promise<Utxo[]> => {
  switch (inputSelectionAlgo) {
    case InputSelectionAlgo.USE_LARGER_UTXOS:
    default:
      return useLargerUtxos(_mysql, walletId, tokenId, tokenBalance.total());
  }
};

export const useLargerUtxos = async (
  _mysql: ServerlessMysql,
  walletId: string,
  tokenId: string,
  balance: number,
): Promise<Utxo[]> => {
  const finalUtxos: Utxo[] = [];

  let remainingBalance = balance;
  const valueUtxos = await getWalletSortedValueUtxos(_mysql, walletId, tokenId);
  for (const utxo of valueUtxos) {
    remainingBalance -= utxo.value;
    finalUtxos.push(utxo);
    if (remainingBalance <= 0) break;
  }

  return finalUtxos;
};

/**
 * Check if the wallet has the required amount for each token.
 *
 * @remarks
 * The check is only done using the wallet's unlocked tokens.
 *
 * @param walletBalances - The wallet's balance for all requested tokens
 * @param outputsBalance - The amount requested for each token
 * @returns A list of tokens whose requested value is larger than the wallet's available balance
 */
export const checkWalletFunds = (walletBalances: WalletTokenBalance[], outputsBalance: TokenBalanceMap): IWalletInsufficientFunds[] => {
  const insufficientFunds = [];
  const missingTokens = new Set(outputsBalance.getTokens());
  for (const balance of walletBalances) {
    const token = balance.token;
    missingTokens.delete(token.id);
    const requested = outputsBalance.get(token.id).total();
    const available = balance.balance.unlockedAmount;
    if (requested > available) {
      // unlocked tokens are not enough
      insufficientFunds.push({ tokenId: token.id, requested, available });
    }
  }
  for (const tokenId of missingTokens) {
    // these tokens don't have any balance in the wallet
    insufficientFunds.push({ tokenId, requested: outputsBalance.get(tokenId).total(), available: 0 });
  }
  return insufficientFunds;
};

/**
 * Confirm that all inputs requested by the user have been fetched.
 *
 * @param inputs - List of inputs sent by the user
 * @param utxos - List of UTXOs retrieved from database
 * @returns A list with the missing UTXOs, if any
 */
export const checkMissingUtxos = (inputs: IWalletInput[], utxos: Utxo[]): IWalletInput[] => {
  if (inputs.length === utxos.length) return [];

  const remaining = new Set(inputs.map((input) => [input.txId, input.index]));
  for (const utxo of utxos) {
    remaining.delete([utxo.txId, utxo.index]);
  }

  const missing = [];
  for (const utxo of remaining) {
    missing.push({ txId: utxo[0], index: utxo[1] });
  }
  return missing;
};

/**
 * Confirm that the inputs requested by the user are not already being used on another TxProposal
 *
 * @param utxos - List of UTXOs retrieved from database
 * @returns A list with the missing UTXOs, if any
 */
export const checkUsedUtxos = (utxos: Utxo[]): boolean => {
  for (let x = 0; x < utxos.length; x++) {
    if (utxos[x].txProposalId) {
      return true;
    }
  }

  return false;
};

/**
 * Uses diferent Joi schema validators depending on the TokenActionType
 * Will also accept 'base' to validate if the transaction contains the actionType parameter before
 * validating the rest of the body
 *
 * @param event - The received tx action event
 * @returns The validated object depending on the Schema rules
 */
export const validateBody = (event: any, actionType: TokenActionType | string): ValidationResult => {
  const eventBody = (function parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }(event.body));

  const options = {
    abortEarly: false, // We want it to return all the errors not only the first
    convert: false, // We want it to be strict with the parameters and not parse a string as integer
  };

  if (actionType === 'base') {
    return baseActionSchema.validate(eventBody, options) as ValidationResult;
  }

  switch (actionType) {
    case TokenActionType.REGULAR_TRANSACTION:
      return createTxSchema.validate(eventBody, options) as ValidationResult;
    case TokenActionType.CREATE_TOKEN:
      return createTokenSchema.validate(eventBody, options) as ValidationResult;
    case TokenActionType.MINT_TOKEN:
      return mintTokenSchema.validate(eventBody, options) as ValidationResult;
    case TokenActionType.MELT_TOKEN:
      return meltTokenSchema.validate(eventBody, options) as ValidationResult;
    case TokenActionType.DELEGATE_MINT:
      return delegateAuthoritySchema.validate(eventBody, options) as ValidationResult;
    case TokenActionType.DELEGATE_MELT:
      return delegateAuthoritySchema.validate(eventBody, options) as ValidationResult;
    case TokenActionType.DESTROY_MINT:
      return destroyAuthoritySchema.validate(eventBody, options) as ValidationResult;
    case TokenActionType.DESTROY_MELT:
      return destroyAuthoritySchema.validate(eventBody, options) as ValidationResult;
    default:
      throw new Error('Unhandled action type.');
  }
};
