/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ServerlessMysql } from 'serverless-mysql';

import {
  getAddressWalletInfo,
  getLatestHeight,
  getWalletBalances as dbGetWalletBalances,
  getWalletUnlockedUtxos,
  unlockUtxos as dbUnlockUtxos,
  updateAddressLockedBalance,
  updateWalletLockedBalance,
  getVersionData,
  updateVersionData,
  getBlockByHeight,
  getTxsAfterHeight,
  removeTxs,
  getTxOutputs,
  getTxOutputsBySpent,
  removeTxsHeight,
  unspendUtxos,
  deleteUtxos,
  getTransactionsById,
} from '@src/db';
import {
  DecodedOutput,
  StringMap,
  TokenBalanceMap,
  TxInput,
  TxOutput,
  Utxo,
  Tx,
  Wallet,
  Block,
  WalletTokenBalance,
  FullNodeVersionData,
} from '@src/types';

import {
  getUnixTimestamp,
  checkBlockForVoided,
} from '@src/utils';

import hathorLib from '@hathor/wallet-lib';

const VERSION_CHECK_MAX_DIFF = 60 * 60 * 1000; // 1 hour

/**
 * Update the unlocked/locked balances for addresses and wallets connected to the given UTXOs.
 *
 * @param mysql - Database connection
 * @param utxos - List of UTXOs that are unlocked by height
 * @param updateTimelocks - If this update is triggered by a timelock expiring, update the next lock expiration
 */
export const unlockUtxos = async (mysql: ServerlessMysql, utxos: Utxo[], updateTimelocks: boolean): Promise<void> => {
  if (utxos.length === 0) return;

  const outputs: TxOutput[] = utxos.map((utxo) => {
    const decoded: DecodedOutput = {
      type: 'P2PKH',
      address: utxo.address,
      timelock: utxo.timelock,
    };
    return {
      value: utxo.authorities > 0 ? utxo.authorities : utxo.value,
      token: utxo.tokenId,
      decoded,
      locked: false,
      // set authority bit if necessary
      token_data: utxo.authorities > 0 ? hathorLib.constants.TOKEN_AUTHORITY_MASK : 0,
      // we don't care about spent_by and script
      spent_by: null,
      script: '',
    };
  });

  // mark as unlocked in database (this just changes the 'locked' flag)
  await dbUnlockUtxos(mysql, utxos);

  const addressBalanceMap: StringMap<TokenBalanceMap> = getAddressBalanceMap([], outputs);
  // update address_balance table
  await updateAddressLockedBalance(mysql, addressBalanceMap, updateTimelocks);

  // check if addresses belong to any started wallet
  const addressWalletMap: StringMap<Wallet> = await getAddressWalletInfo(mysql, Object.keys(addressBalanceMap));

  // update wallet_balance table
  const walletBalanceMap: StringMap<TokenBalanceMap> = getWalletBalanceMap(addressWalletMap, addressBalanceMap);
  await updateWalletLockedBalance(mysql, walletBalanceMap, updateTimelocks);
};

/**
 * Mark a transaction's outputs that are locked. Modifies the outputs in place.
 *
 * @remarks
 * The timestamp is used to determine if each output is locked by time. On the other hand, `hasHeightLock`
 * applies to all outputs.
 *
 * The idea is that `hasHeightLock = true` should be used for blocks, whose outputs are locked by
 * height. Timelocks are handled by the `now` parameter.
 *
 * @param outputs - The transaction outputs
 * @param now - Current timestamp
 * @param hasHeightLock - Flag that tells if outputs are locked by height
 */
export const markLockedOutputs = (outputs: TxOutput[], now: number, hasHeightLock = false): void => {
  for (const output of outputs) {
    output.locked = false;
    if (hasHeightLock || output.decoded.timelock > now) {
      output.locked = true;
    }
  }
};

/**
 * Get the map of token balances for each address in the transaction inputs and outputs.
 *
 * @example
 * Return map has this format:
 * ```
 * {
 *   address1: {token1: balance1, token2: balance2},
 *   address2: {token1: balance3}
 * }
 * ```
 *
 * @param inputs - The transaction inputs
 * @param outputs - The transaction outputs
 * @returns A map of addresses and its token balances
 */
export const getAddressBalanceMap = (
  inputs: TxInput[],
  outputs: TxOutput[],
): StringMap<TokenBalanceMap> => {
  const addressBalanceMap = {};

  for (const input of inputs) {
    const address = input.decoded.address;

    // get the TokenBalanceMap from this input
    const tokenBalanceMap = TokenBalanceMap.fromTxInput(input);
    // merge it with existing TokenBalanceMap for the address
    addressBalanceMap[address] = TokenBalanceMap.merge(addressBalanceMap[address], tokenBalanceMap);
  }

  for (const output of outputs) {
    const address = output.decoded.address;

    // get the TokenBalanceMap from this output
    const tokenBalanceMap = TokenBalanceMap.fromTxOutput(output);

    // merge it with existing TokenBalanceMap for the address
    addressBalanceMap[address] = TokenBalanceMap.merge(addressBalanceMap[address], tokenBalanceMap);
  }

  return addressBalanceMap;
};

/**
 * Get the map of token balances for each wallet.
 *
 * @remarks
 * Different addresses can belong to the same wallet, so this function merges their
 * token balances.
 *
 * @example
 * Return map has this format:
 * ```
 * {
 *   wallet1: {token1: balance1, token2: balance2},
 *   wallet2: {token1: balance3}
 * }
 * ```
 *
 * @param addressWalletMap - Map of addresses and corresponding wallets
 * @param addressBalanceMap - Map of addresses and corresponding token balances
 * @returns A map of wallet ids and its token balances
 */
export const getWalletBalanceMap = (
  addressWalletMap: StringMap<Wallet>,
  addressBalanceMap: StringMap<TokenBalanceMap>,
): StringMap<TokenBalanceMap> => {
  const walletBalanceMap = {};
  for (const [address, balanceMap] of Object.entries(addressBalanceMap)) {
    const wallet = addressWalletMap[address];
    const walletId = wallet && wallet.walletId;

    // if this address is not from a started wallet, ignore
    if (!walletId) continue;

    walletBalanceMap[walletId] = TokenBalanceMap.merge(walletBalanceMap[walletId], balanceMap);
  }
  return walletBalanceMap;
};

/**
 * Get a wallet's balance, taking into account any existing timelocks.
 *
 * @remarks
 * If any timelock has expired, database tables will be refreshed before returning the balances.
 *
 * @param mysql - Database connection
 * @param now - Current timestamp
 * @param walletId - The wallet id
 * @param tokenIds - A list of token ids
 */
export const getWalletBalances = async (
  mysql: ServerlessMysql,
  now: number,
  walletId: string,
  tokenIds: string[] = [],
): Promise<WalletTokenBalance[]> => {
  let balances = await dbGetWalletBalances(mysql, walletId, tokenIds);

  // if any of the balances' timelock has expired, update the tables before returning
  const refreshBalances = balances.some((tb) => {
    if (tb.balance.lockExpires && tb.balance.lockExpires <= now) {
      return true;
    }
    return false;
  });

  if (refreshBalances) {
    const currentHeight = await getLatestHeight(mysql);
    const utxos = await getWalletUnlockedUtxos(mysql, walletId, now, currentHeight);
    await unlockUtxos(mysql, utxos, true);
    balances = await dbGetWalletBalances(mysql, walletId, tokenIds);
  }
  return balances;
};

/**
 * Updates the wallet-lib constants if needed.
 *
 * @returns A promise that resolves when the wallet-lib constants have been set.
 */
export const maybeRefreshWalletConstants = async (mysql: ServerlessMysql): Promise<void> => {
  const lastVersionData: FullNodeVersionData = await getVersionData(mysql);
  const now = getUnixTimestamp();

  if (!lastVersionData || now - lastVersionData.timestamp > VERSION_CHECK_MAX_DIFF) {
    // Query and update versions
    const apiResponse = await hathorLib.version.checkApiVersion();
    const versionData: FullNodeVersionData = {
      timestamp: now,
      version: apiResponse.version,
      network: apiResponse.network,
      minWeight: apiResponse.min_weight,
      minTxWeight: apiResponse.min_tx_weight,
      minTxWeightCoefficient: apiResponse.min_tx_weight_coefficient,
      minTxWeightK: apiResponse.min_tx_weight_k,
      tokenDepositPercentage: apiResponse.token_deposit_percentage,
      rewardSpendMinBlocks: apiResponse.reward_spend_min_blocks,
      maxNumberInputs: apiResponse.max_number_inputs,
      maxNumberOutputs: apiResponse.max_number_outputs,
    };

    await updateVersionData(mysql, versionData);
  } else {
    hathorLib.transaction.updateTransactionWeightConstants(
      lastVersionData.minTxWeight,
      lastVersionData.minTxWeightCoefficient,
      lastVersionData.minTxWeightK,
    );
    hathorLib.tokens.updateDepositPercentage(lastVersionData.tokenDepositPercentage);
    hathorLib.transaction.updateMaxInputsConstant(lastVersionData.maxNumberInputs);
    hathorLib.transaction.updateMaxOutputsConstant(lastVersionData.maxNumberOutputs);
    hathorLib.wallet.updateRewardLockConstant(lastVersionData.rewardSpendMinBlocks);
  }
};

/**
 * Searches our blocks database for the last block that is not voided.
 *
 * @returns A Block instance with the last block that is not voided.
 */
export const searchForLatestValidBlock = async (mysql: ServerlessMysql): Promise<Block> => {
  // Get our current best block.
  const latestHeight: number = await getLatestHeight(mysql);
  const bestBlock: Block = await getBlockByHeight(mysql, latestHeight);

  let start = 0;
  let end = bestBlock.height; // 63
  let latestValidBlock = bestBlock; // 63

  while (start <= end) {
    const midHeight = Math.floor((start + end) / 2);

    // Check if the block at middle position is voided
    const middleBlock: Block = await getBlockByHeight(mysql, midHeight);
    const isVoided: boolean = await checkBlockForVoided(middleBlock.txId);

    console.log(middleBlock.txId, middleBlock.height, isVoided);

    if (!isVoided) {
      // Not voided, discard left half as all blocks to the left should
      // be valid, the reorg happened after this height.
      latestValidBlock = middleBlock;
      start = midHeight + 1;
    } else {
      end = midHeight - 1;
    }
  }

  return latestValidBlock;
};

export const handleReorg = async (mysql: ServerlessMysql): Promise<void> => {
  const { height } = await searchForLatestValidBlock(mysql);

  // step 1: fetch all block transactions where height > latestValidBlock
  const allTxsAfterHeight = await getTxsAfterHeight(mysql, height);
  let txs: Tx[] = allTxsAfterHeight.filter((tx) => [
    hathorLib.constants.BLOCK_VERSION,
    hathorLib.constants.MERGED_MINED_BLOCK_VERSION,
  ].indexOf(tx.version) > -1);

  console.log(`All blocks where height > ${height}`);
  console.log(txs);

  while (txs.length > 0) {
    console.log(`Removing ${txs.length} transactions...`);
    await removeTxs(mysql, txs);

    const txOutputs: Utxo[] = await getTxOutputs(mysql, txs); // "A" Outputs

    // txOutputs might contain more than one output that spend from the same tx
    const txIds = txOutputs.reduce((acc: Set<string>, utxo: Utxo) => {
      acc.add(utxo.spentBy);

      return acc;
    }, new Set<string>());

    // delete tx outputs:
    console.log(`Deleting ${txOutputs.length} utxos...`);
    await deleteUtxos(mysql, txOutputs);

    // get outputs that were spent in txOutputs
    const spentOutputs: Utxo[] = await getTxOutputsBySpent(mysql, [...txIds]);
    if (spentOutputs.length > 0) {
      console.log(`Unspending ${spentOutputs.length} outputs...`);
      await unspendUtxos(mysql, spentOutputs);
    }

    // fetch all transactions that spend those voided txs outputs:
    txs = await getTransactionsById(mysql, [...txIds]);
  }

  // get all remaining txs and set height = null (mempool)
  const remainingTxs: Tx[] = await getTxsAfterHeight(mysql, height);
  if (remainingTxs.length > 0) {
    console.log(`Removing ${remainingTxs.length} remainingTxs...`);
    await removeTxsHeight(mysql, remainingTxs);
  }
};
