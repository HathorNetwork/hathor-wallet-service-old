/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import AWS from 'aws-sdk';
import { APIGatewayProxyHandler, APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import 'source-map-support/register';
import hathorLib from '@hathor/wallet-lib';
import {
  getAddressBalanceMap,
  getWalletBalanceMap,
  markLockedOutputs,
  unlockUtxos,
  unlockTimelockedUtxos,
  searchForLatestValidBlock,
  handleReorg,
  handleVoided,
  prepareOutputs,
} from '@src/commons';
import { Logger } from 'winston';
import {
  addNewAddresses,
  addUtxos,
  addOrUpdateTx,
  updateTx,
  generateAddresses,
  getAddressWalletInfo,
  getLockedUtxoFromInputs,
  getUtxosLockedAtHeight,
  updateTxOutputSpentBy,
  storeTokenInformation,
  updateAddressTablesWithTx,
  updateWalletTablesWithTx,
  fetchTx,
  addMiner,
} from '@src/db';
import {
  transactionDecorator,
} from '@src/db/utils';
import {
  TxOutputWithIndex,
  StringMap,
  Transaction,
  TokenBalanceMap,
  Wallet,
  Tx,
} from '@src/types';
import {
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
} from '@src/utils';
import createDefaultLogger from '@src/logger';

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
  const logger: Logger = createDefaultLogger();

  // TODO not sure if it should be 'now' or max(now, tx.timestamp), as we allow some flexibility for timestamps
  const now = getUnixTimestamp();
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);
  for (const evt of event.Records) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await addNewTx(logger, evt.body, now, blockRewardLock);
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
 * Function called when to process new transactions or blocks.
 *
 * @remarks
 * This is a lambda function that should be invoked using the aws-sdk.
 */
export const onNewTxRequest: APIGatewayProxyHandler = async (event, context) => {
  const logger = createDefaultLogger();

  // Logs the request id on every line so we can see all logs from a request
  logger.defaultMeta = {
    requestId: context.awsRequestId,
  };

  const now = getUnixTimestamp();
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await addNewTx(logger, event.body, now, blockRewardLock);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (e) {
    // eslint-disable-next-line
    logger.error('Errored on onNewTxRequest: ', e);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: 'Tx processor failed',
      }),
    };
  }
};

/**
 * Function called when a reorg is detected on the wallet-service daemon
 *
 * @remarks
 * This is a lambda function that should be invoked using the aws-sdk.
 */
export const onHandleReorgRequest: APIGatewayProxyHandler = async (_event, context) => {
  const logger = createDefaultLogger();
  logger.defaultMeta = {
    requestId: context.awsRequestId,
  };

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    /* eslint-disable-next-line  @typescript-eslint/ban-types */
    const wrappedHandleReorg = await transactionDecorator(mysql, handleReorg);

    await wrappedHandleReorg(mysql, logger);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (e) {
    // eslint-disable-next-line
    logger.error('Errored on onHandleReorgRequest: ', e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: 'Reorg failed.',
      }),
    };
  }
};

/**
 * Function called to search for the latest valid block
 *
 * @remarks
 * This is a lambda function that should be invoked using the aws-sdk.
 */
export const onSearchForLatestValidBlockRequest: APIGatewayProxyHandler = async () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const latestValidBlock = await searchForLatestValidBlock(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, latestValidBlock }),
  };
};

export const handleVoidedTx = async (tx: Transaction): Promise<void> => {
  const txId = tx.tx_id;
  const transaction: Tx = await fetchTx(mysql, txId);
  const logger = createDefaultLogger();
  logger.defaultMeta = {
    txId,
  };

  if (!transaction) {
    throw new Error(`Transaction ${txId} not found.`);
  }

  await handleVoided(mysql, logger, transaction);
};

/**
 * Add a new transaction or block, updating the proper tables.
 *
 * @param tx - The transaction or block
 * @param now - Current timestamp
 * @param blockRewardLock - The block reward lock
 */
const _unsafeAddNewTx = async (_logger: Logger, tx: Transaction, now: number, blockRewardLock: number): Promise<void> => {
  const txId = tx.tx_id;
  const network = process.env.NETWORK;

  // add the tx id to all logs from this method, so we can search by txId on CloudWatch
  const logger = _logger;
  logger.defaultMeta = {
    ...logger.defaultMeta,
    txId,
  };

  logger.debug(`Transaction ${txId} received`, {
    tx,
  });

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
      logger.debug(`Ignoring ${txId} as it already has height on the database`, {
        txId,
      });
      return;
    }

    // set height and break out because it was already on the mempool
    // so we can consider that our balances have already been calculated
    // and the utxos were already inserted
    await updateTx(mysql, txId, tx.height, tx.timestamp, tx.version, tx.weight);

    return;
  }

  let heightlock = null;
  if (tx.version === hathorLib.constants.BLOCK_VERSION
    || tx.version === hathorLib.constants.MERGED_MINED_BLOCK_VERSION) {
    // unlock older blocks
    const utxos = await getUtxosLockedAtHeight(mysql, now, tx.height);
    logger.debug(`Block transaction, unlocking ${utxos.length} locked utxos at height ${tx.height}`, {
      unlockedUtxos: utxos,
    });
    await unlockUtxos(mysql, utxos, false);

    // set heightlock
    heightlock = tx.height + blockRewardLock;

    // get the first output address
    const blockRewardOutput = tx.outputs[0];

    // add miner to the miners table
    await addMiner(mysql, blockRewardOutput.decoded.address, tx.tx_id);

    // here we check if we have any utxos on our database that is locked but
    // has its timelock < now
    //
    // we've decided to do this here considering that it is acceptable to have
    // a delay between the actual timelock expiration time and the next block
    // (that will unlock it). This delay is only perceived on the wallet as the
    // sync mechanism will unlock the timelocked utxos as soon as they are seen
    // on a received transaction.
    await unlockTimelockedUtxos(mysql, now);
  }

  if (tx.version === hathorLib.constants.CREATE_TOKEN_TX_VERSION) {
    await storeTokenInformation(mysql, tx.tx_id, tx.token_name, tx.token_symbol);
  }

  const outputs: TxOutputWithIndex[] = prepareOutputs(tx.outputs, txId);

  // check if any of the inputs are still marked as locked and update tables accordingly.
  // See remarks on getLockedUtxoFromInputs for more explanation. It's important to perform this
  // before updating the balances
  const lockedInputs = await getLockedUtxoFromInputs(mysql, tx.inputs);
  await unlockUtxos(mysql, lockedInputs, true);

  // add transaction outputs to the tx_outputs table
  markLockedOutputs(outputs, now, heightlock !== null);
  logger.debug(`Adding ${txId} to database`);
  await addOrUpdateTx(mysql, txId, tx.height, tx.timestamp, tx.version, tx.weight);
  logger.debug(`Adding ${outputs.length} utxos to database`);
  await addUtxos(mysql, txId, outputs, heightlock);

  // mark the tx_outputs used in the transaction (tx.inputs) as spent by txId
  logger.debug(`Marking ${tx.inputs.length} tx_outputs as spent`, {
    inputs: tx.inputs,
  });
  await updateTxOutputSpentBy(mysql, tx.inputs, txId);

  // get balance of each token for each address
  const addressBalanceMap: StringMap<TokenBalanceMap> = getAddressBalanceMap(tx.inputs, outputs);
  logger.debug('Updating address_balance and address_tx_history tables', {
    addressBalanceMap,
  });

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
    const { newAddresses, lastUsedAddressIndex } = await generateAddresses(mysql, wallet.xpubkey, wallet.maxGap);
    // might need to generate new addresses to keep maxGap
    await addNewAddresses(mysql, walletId, newAddresses, lastUsedAddressIndex);
    // update existing addresses' walletId and index
  }
  // update wallet_balance and wallet_tx_history tables
  const walletBalanceMap: StringMap<TokenBalanceMap> = getWalletBalanceMap(addressWalletMap, addressBalanceMap);
  logger.debug('Updating wallet_balance and wallet_tx_history tables', {
    walletBalanceMap,
  });
  await updateWalletTablesWithTx(mysql, txId, tx.timestamp, walletBalanceMap);

  const queueUrl = process.env.NEW_TX_SQS;
  if (!queueUrl) return;

  const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
  const params = {
    MessageBody: JSON.stringify({
      wallets: Array.from(seenWallets),
      tx,
    }),
    QueueUrl: queueUrl,
  };

  await sqs.sendMessage(params).promise();
};

/**
 * Add a new transaction or block, updating the proper tables.
 * @remarks This is a wrapper for _unsafeAddNewTx that adds automatic transaction and rollback on failure
 *
 * @param tx - The transaction or block
 * @param now - Current timestamp
 * @param blockRewardLock - The block reward lock
 */
export const addNewTx = async (logger: Logger, tx: Transaction, now: number, blockRewardLock: number) => {
  /* eslint-disable-next-line  @typescript-eslint/ban-types */
  const wrappedAddNewTx = await transactionDecorator(mysql, _unsafeAddNewTx);

  return wrappedAddNewTx(logger, tx, now, blockRewardLock);
};
