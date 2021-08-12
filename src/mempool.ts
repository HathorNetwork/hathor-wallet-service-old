/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';
import {
  getMempoolTransactionsBeforeDate,
  updateTx,
} from '@src/db';
import { Tx } from '@src/types';
import { handleVoided } from '@src/commons';
import {
  isTxVoided,
  fetchBlockHeight,
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
} from '@src/utils';

const mysql = getDbConnection();

/**
 * Function called to void unconfirmed transactions on the database
 *
 * @remarks
 * This is a lambda function that should be triggered by an scheduled event. This will run by default on every
 * 20 minutes (configurable on serverless.yml) and will query for transactions older than 20 minutes that are not
 * confirmed by a block and are not voided.
 */
export const onHandleOldVoidedTxs = async () => {
  const VOIDED_TX_OFFSET: number = parseInt(process.env.VOIDED_TX_OFFSET, 10) * 60; // env is in minutes
  const now: number = getUnixTimestamp();
  const date: number = now - VOIDED_TX_OFFSET;

  // Fetch voided transactions that are older than 20m
  const voidedTransactions: Tx[] = await getMempoolTransactionsBeforeDate(mysql, date);
  console.log(`Found ${voidedTransactions.length} voided transactions older than ${process.env.VOIDED_TX_OFFSET}m`);

  /* This loop will check if all transactions are in fact voided on the fullnode and try to fix it (by updating the height) if
   * they are not.
   */
  for (const tx of voidedTransactions) {
    const [isVoided, transaction] = await isTxVoided(tx.txId);

    /* This will alarm (using the ALERT string) if the transaction is not yet confirmed on our database and is not voided since
     * this indicates an issue with our sync mechanism.
     *
     * It will also try to correct it by fetching the height that confirms it and updating the transaction on our database.
     */
    if (!isVoided) {
      console.error(`[ALERT] Transaction ${tx.txId} is not yet confirmed on our database but it is not voided on the fullnode.`);
      // Check if it is confirmed by a block
      if (transaction.meta.first_block) {
        /* Here we are sure that we really did lose the confirmation. We should fetch the height that confirmed it and update
         * the transaction.
         *
         * This might fail as it will do a http request to the fullnode, we will catch the error, log and continue as it will
         * automatically try again on the next schedule run.
         */
        try {
          // This will also throw if the height was not found on the requested block
          const [height] = await fetchBlockHeight(transaction.meta.first_block);

          // Balances have already been calculated as this transaction was on the mempool, we are safe to just update the height
          await updateTx(mysql, tx.txId, height, tx.timestamp, tx.version);
        } catch (e) {
          console.error(`Error confirming transaction ${tx.txId} height`);
          console.error(e);
        }
      }
    } else {
      await handleVoided(mysql, tx);
    }
  }

  await closeDbConnection(mysql);
};
