/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';
import { getMempoolTransactionsBeforeDate } from '@src/db';
import { Tx } from '@src/types';
import { handleVoided } from '@src/commons';
import {
  isTxVoided,
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
} from '@src/utils';

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
export const onHandleOldVoidedTxs = async () => {
  const VOIDED_TX_OFFSET: number = parseInt(process.env.VOIDED_TX_OFFSET || `${20 * 60}`, 10); // 20 minutes default
  const now: number = getUnixTimestamp();
  const date: number = now - VOIDED_TX_OFFSET;

  // fetch voided transactions that are older than 20m
  const voidedTransactions: Tx[] = await getMempoolTransactionsBeforeDate(mysql, date);
  console.log(`Found ${voidedTransactions.length} voided transactions older than 20m`);

  // confirm that all of them are actually voided on the fullnode
  for (const tx of voidedTransactions) {
    const isVoided = await isTxVoided(tx.txId);

    /* We could fetch the height from the first_block and confirm it on our database, but this probably is telling us that
     * there is a problem with the sync mechanism, so I think we should throw here and let it crash
     *
     * TODO: [ALERT] should be replaced with the correct string to get alerted on CloudWatch/Slack
     */
    if (!isVoided) {
      console.error(`[ALERT] Transaction ${tx.txId} is not yet confirmed on our database but it is not voided on the fullnode.`);
      await closeDbConnection(mysql);

      throw new Error(`Transaction ${tx.txId} not voided`);
    }

    await handleVoided(mysql, tx);
  }

  await closeDbConnection(mysql);
};
