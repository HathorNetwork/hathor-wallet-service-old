/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import 'source-map-support/register';
import hathorLib from '@hathor/wallet-lib';

import {
  getAddressBalanceMap,
  getWalletBalanceMap,
  markLockedOutputs,
  unlockUtxos,
} from '@src/commons';
import {
  addNewAddresses,
  addUtxos,
  generateAddresses,
  getAddressWalletInfo,
  getLockedUtxoFromInputs,
  getUtxosLockedAtHeight,
  maybeUpdateLatestHeight,
  removeUtxos,
  storeTokenInformation,
  updateAddressTablesWithTx,
  updateWalletTablesWithTx,
} from '@src/db';
import {
  StringMap,
  Transaction,
  TokenBalanceMap,
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
  // TODO not sure if it should be 'now' or max(now, tx.timestamp), as we allow some flexibility for timestamps
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
  if (tx.version === hathorLib.constants.BLOCK_VERSION
    || tx.version === hathorLib.constants.MERGED_MINED_BLOCK_VERSION) {
    // unlock older blocks
    const utxos = await getUtxosLockedAtHeight(mysql, now, tx.height);
    await unlockUtxos(mysql, utxos, false);

    // set heightlock
    heightlock = tx.height + blockRewardLock;

    // update height on database
    await maybeUpdateLatestHeight(mysql, tx.height);
  }

  if (tx.version === hathorLib.constants.CREATE_TOKEN_TX_VERSION) {
    await storeTokenInformation(mysql, tx.tx_id, tx.token_name, tx.token_symbol);
  }

  // check if any of the inputs are still marked as locked and update tables accordingly.
  // See remarks on getLockedUtxoFromInputs for more explanation. It's important to perform this
  // before updating the balances
  const lockedInputs = await getLockedUtxoFromInputs(mysql, tx.inputs);
  await unlockUtxos(mysql, lockedInputs, true);

  // add outputs to utxo table
  markLockedOutputs(tx.outputs, now, heightlock !== null);
  await addUtxos(mysql, txId, tx.outputs, heightlock);

  // remove inputs from utxo table
  await removeUtxos(mysql, tx.inputs);

  // get balance of each token for each address
  const addressBalanceMap: StringMap<TokenBalanceMap> = getAddressBalanceMap(tx.inputs, tx.outputs);

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

    const { newAddresses } = await generateAddresses(mysql, wallet.xpubkey, wallet.maxGap);
    // might need to generate new addresses to keep maxGap
    await addNewAddresses(mysql, walletId, newAddresses);
    // update existing addresses' walletId and index
  }
  // update wallet_balance and wallet_tx_history tables
  const walletBalanceMap: StringMap<TokenBalanceMap> = getWalletBalanceMap(addressWalletMap, addressBalanceMap);
  await updateWalletTablesWithTx(mysql, txId, tx.timestamp, walletBalanceMap);
};
