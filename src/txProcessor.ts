import { APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import 'source-map-support/register';

import {
  addNewAddresses,
  addUtxos,
  generateAddresses,
  getAddressWalletInfo,
  getUtxosLockedAtHeight,
  removeUtxos,
  updateAddressTablesWithTx,
  updateAddressLockedBalance,
  updateExistingAddresses,
  updateWalletLockedBalance,
  updateWalletTablesWithTx,
} from '@src/db';
import {
  DecodedOutput,
  StringMap,
  Transaction,
  TokenBalanceMap,
  TxInput,
  TxOutput,
  Utxo,
  Wallet,
} from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';

const mysql = getDbConnection();

/**
 * Function called when a new transaction arrives.
 *
 * @remarks
 * This is a lambda function that should be triggered by an SQS event. The queue might batch
 * messages, so we expect a list of transactions. This function only parses the SQS event and
 * calls the appropriate function to handle the transaction.
 *
 * @param event - The SQS event
 */
export const onNewTxEvent = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  const now = getUnixTimestamp();
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);
  for (const evt of event.Records) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await addNewTx(evt.body, now, blockRewardLock);
  }

  await closeDbConnection(mysql);

  // TODO delete message from queue
  // https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
  // When a consumer receives and processes a message from a queue, the message remains in the queue.
  // Amazon SQS doesn't automatically delete the message. Thus, the consumer must delete the message from the
  // queue after receiving and processing it.

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Added new transactions' }),
  };
};

/**
 * Add a new transaction or block, updating the proper tables.
 *
 * @param tx - The transaction or block
 * @param now - Current timestamp
 * @param blockRewardLock - The block reward lock
 */
const addNewTx = async (tx: Transaction, now: number, blockRewardLock: number) => {
  // TODO mysql error treatment

  const txId = tx.tx_id;

  let heightlock = null;
  if (tx.version === 0 || tx.version === 3) {
    // if (tx.isBlock())

    // unlock older block
    const utxos = await getUtxosLockedAtHeight(mysql, now, tx.height);
    await unlockUtxos(mysql, utxos, now);

    // set heightlock
    heightlock = tx.height + blockRewardLock;
  }

  // add outputs to utxo table
  await addUtxos(mysql, txId, tx.outputs, heightlock);

  // remove inputs from utxo table
  await removeUtxos(mysql, tx.inputs);

  // get balance of each token for each address
  const addressBalanceMap: StringMap<TokenBalanceMap> = getAddressBalanceMap(tx.inputs, tx.outputs, now, heightlock !== null);

  // update address tables (address, address_balance, address_tx_history)
  await updateAddressTablesWithTx(mysql, txId, tx.timestamp, addressBalanceMap);

  // for the addresses present on the tx, check if there are any wallets associated
  const addressWalletMap: StringMap<Wallet> = await getAddressWalletInfo(mysql, Object.keys(addressBalanceMap));

  // for each already started wallet, update databases
  const seenWallets = new Set();
  for (const wallet of Object.values(addressWalletMap)) {
    const walletId = wallet.walletId;

    // this map might contain duplicate wallet values, as 2 different addresses might belong to the same wallet
    if (seenWallets.has(walletId)) continue;
    seenWallets.add(walletId);

    const { existingAddresses, newAddresses } = await generateAddresses(mysql, wallet.xpubkey, wallet.maxGap);
    // might need to generate new addresses to keep maxGap
    await addNewAddresses(mysql, walletId, newAddresses);
    // update existing addresses' walletId and index
    await updateExistingAddresses(mysql, walletId, existingAddresses);
  }
  // update wallet_balance and wallet_tx_history tables
  const walletBalanceMap: StringMap<TokenBalanceMap> = getWalletBalanceMap(addressWalletMap, addressBalanceMap);
  await updateWalletTablesWithTx(mysql, txId, tx.timestamp, walletBalanceMap);

  // TODO schedule unlock lambda if there's a timelock
};

/**
 * Get the map of token balances for each address in the transaction inputs and outputs.
 *
 * @remarks
 * Besides the inputs and outputs, it also expects a timestamp and outputsLocked flag. The timestamp
 * is used to determine if the outputs are locked or not. The same for outputsLocked, but as it's a
 * boolean, `outputsLocked = true` means (all) outputs are locked, no matter the timestamp. If it's
 * false, it depends on the timestamp.
 *
 * The idea is that `outputsLocked = true` should be used for blocks, whose outputs are locked by
 * height. Timelocks are handled by the `now` parameter.
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
 * @param now - Current timestamp
 * @param outputsLocked - Flag that tells if outputs are all locked
 * @returns A map of addresses and its token balances
 */
export const getAddressBalanceMap = (
  inputs: TxInput[],
  outputs: TxOutput[],
  now: number,
  outputsLocked = false,
): StringMap<TokenBalanceMap> => {
  const addressBalanceMap = {};
  // TODO handle authority

  for (const output of outputs) {
    const address = output.decoded.address;

    // get the TokenBalanceMap from this output
    const tokenBalanceMap = TokenBalanceMap.fromTxOutput(output, now, outputsLocked);
    // merge it with existing TokenBalanceMap for the address
    addressBalanceMap[address] = TokenBalanceMap.merge(addressBalanceMap[address], tokenBalanceMap);
  }

  for (const input of inputs) {
    const address = input.decoded.address;

    // get the TokenBalanceMap from this input
    const tokenBalanceMap = TokenBalanceMap.fromTxInput(input);
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
 * Update the unlocked/locked balances for addresses and wallets connected to the given UTXOs.
 *
 * @remarks
 * UTXOs become unlocked by block height, but might still be locked by timelock (although very unusual).
 * The UTXOs passed to this function should be already unlocked by height. This function will determine
 * if they're still locked by time.
 *
 * @param _mysql - Database connection
 * @param utxos - List of UTXOs that are unlocked by height
 * @param now - current timestamp
 */
export const unlockUtxos = async (_mysql: ServerlessMysql, utxos: Utxo[], now: number): Promise<void> => {
  if (utxos.length === 0) return;

  const outputs: TxOutput[] = utxos.map((utxo) => {
    const decoded: DecodedOutput = {
      type: 'P2PKH',
      address: utxo.address,
      timelock: utxo.timelock,
      value: utxo.value,
    };
    return {
      value: utxo.value,
      token: utxo.tokenId,
      decoded,
      // we don't care about spent_by, token_data and script
      spent_by: null,
      script: '',
    };
  });

  // getAddressBalanceMap takes care of checking the timelock
  const addressBalanceMap: StringMap<TokenBalanceMap> = getAddressBalanceMap([], outputs, now, false);
  // update address_balance table
  await updateAddressLockedBalance(_mysql, addressBalanceMap);

  // check if addresses belong to any started wallet
  const addressWalletMap: StringMap<Wallet> = await getAddressWalletInfo(_mysql, Object.keys(addressBalanceMap));

  // update wallet_balance table
  const walletBalanceMap: StringMap<TokenBalanceMap> = getWalletBalanceMap(addressWalletMap, addressBalanceMap);
  await updateWalletLockedBalance(_mysql, walletBalanceMap);
};
