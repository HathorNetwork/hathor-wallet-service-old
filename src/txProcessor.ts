/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import 'source-map-support/register';
import hathorLib from '@hathor/wallet-lib';

import {
  getAddressBalanceMap,
  getWalletBalanceMap,
  markLockedOutputs,
  unlockUtxos,
  searchForLatestValidBlock,
  handleReorg,
} from '@src/commons';
import {
  addNewAddresses,
  addUtxos,
  addOrUpdateTx,
  updateTx,
  addBlock,
  generateAddresses,
  getAddressWalletInfo,
  getLockedUtxoFromInputs,
  getUtxosLockedAtHeight,
  removeUtxos,
  storeTokenInformation,
  updateAddressTablesWithTx,
  updateWalletTablesWithTx,
  fetchTx,
} from '@src/db';
import {
  StringMap,
  Transaction,
  TokenBalanceMap,
  Wallet,
  Block,
  Tx,
} from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';

const mysql = getDbConnection();

export const IGNORE_TXS = {
  mainnet: [
    '000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
    '0002d4d2a15def7604688e1878ab681142a7b155cbe52a6b4e031250ae96db0a',
    '0002ad8d1519daaddc8e1a37b14aac0b045129c01832281fb1c02d873c7abbf9',
  ],
  testnet: [
    '0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85',
    '00e161a6b0bee1781ea9300680913fb76fd0fac4acab527cd9626cc1514abdc9',
    '00975897028ceb037307327c953f5e7ad4d3f42402d71bd3d11ecb63ac39f01a',
  ],
};

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

export const onNewTxRequest: APIGatewayProxyHandler = async (event) => {
  const now = getUnixTimestamp();
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await addNewTx(event.body, now, blockRewardLock);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};

export const onHandleReorgRequest: APIGatewayProxyHandler = async () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await handleReorg(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};

export const onSearchForLatestValidBlockRequest: APIGatewayProxyHandler = async () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const latestValidBlock = await searchForLatestValidBlock(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, latestValidBlock }),
  };
};

/**
 * Add a new transaction or block, updating the proper tables.
 *
 * @param tx - The transaction or block
 * @param now - Current timestamp
 * @param blockRewardLock - The block reward lock
 */
export const addNewTx = async (tx: Transaction, now: number, blockRewardLock: number): Promise<void> => {
  // TODO mysql error treatment

  const txId = tx.tx_id;
  const network = process.env.NETWORK;

  // we should ignore genesis transactions as they have no parents, inputs and outputs and we expect the service
  // to already have the pre-mine utxos on its database.
  if (network in IGNORE_TXS) {
    if (IGNORE_TXS[network].includes(txId)) {
      throw new Error('Rejecting tx as it is part of the genesis transactions.');
    }
  }

  const dbTx: Tx = await fetchTx(mysql, txId);

  // check if we already have the tx on our database:
  if (dbTx) {
    // ignore tx if we already have it confirmed on our database
    if (dbTx.height) {
      return;
    }

    // set height and break out because it was already on the mempool
    // so we can consider that our balances have already been calculated
    // and the utxos were already inserted
    await updateTx(mysql, txId, tx.height, tx.timestamp, tx.version);

    return;
  }

  let heightlock = null;
  if (tx.version === hathorLib.constants.BLOCK_VERSION
    || tx.version === hathorLib.constants.MERGED_MINED_BLOCK_VERSION) {
    // unlock older blocks
    const utxos = await getUtxosLockedAtHeight(mysql, now, tx.height);
    await unlockUtxos(mysql, utxos, false);

    // set heightlock
    heightlock = tx.height + blockRewardLock;

    const block: Block = {
      txId: tx.tx_id as string,
      height: tx.height as number,
    };

    await addBlock(mysql, block);
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
  await addOrUpdateTx(mysql, txId, tx.height, tx.timestamp, tx.version);
  await addUtxos(mysql, txId, tx.outputs, heightlock);

  // remove inputs from utxo table
  await removeUtxos(mysql, tx.inputs, txId);

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
