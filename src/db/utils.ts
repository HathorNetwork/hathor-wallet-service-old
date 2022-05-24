/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ServerlessMysql } from 'serverless-mysql';
import { getWalletId } from '@src/utils';
import { WalletStatus, Wallet, Tx, DbSelectResult } from '@src/types';

/**
 * Begins a transaction on the current connection
 *
 * @param mysql - Database connection
 */
export const beginTransaction = async (
  mysql: ServerlessMysql,
): Promise<void> => {
  await mysql.query('START TRANSACTION');
};

/**
 * Commits the transaction opened on the current connection
 *
 * @param mysql - Database connection
 */
export const commitTransaction = async (
  mysql: ServerlessMysql,
): Promise<void> => {
  await mysql.query('COMMIT');
};

/**
 * Rollback the transaction opened on the current connection
 *
 * @param mysql - Database connection
 */
export const rollbackTransaction = async (
  mysql: ServerlessMysql,
): Promise<void> => {
  await mysql.query('ROLLBACK');
};

/* eslint-disable-next-line  @typescript-eslint/ban-types */
export async function transactionDecorator(_mysql: ServerlessMysql, wrapped: Function): Promise<Function> {
  return async function wrapper(...args) {
    try {
      await beginTransaction(_mysql);
      await wrapped.apply(this, args);
      await commitTransaction(_mysql);
    } catch (e) {
      await rollbackTransaction(_mysql);

      // propagate the error
      throw e;
    }
  };
}

/**
 * Returns a Wallet object from a db result row
 *
 * @param result - The result row to map to a Wallet object
 */
export const getWalletFromDbEntry = (entry: Record<string, unknown>): Wallet => ({
  walletId: getWalletId(entry.xpubkey as string),
  xpubkey: entry.xpubkey as string,
  authXpubkey: entry.auth_xpubkey as string,
  status: entry.status as WalletStatus,
  retryCount: entry.retry_count as number,
  maxGap: entry.max_gap as number,
  createdAt: entry.created_at as number,
  readyAt: entry.ready_at as number,
});

/**
 * Receive a DbSelectResult with multiple records and transform it in an array of Tx
 *
 * @param results
 * @returns Txs converted from DbSelectResult
 */
export const getTxsFromDBResult = (results: DbSelectResult): Tx[] => {
  const transactions = [];

  for (const result of results) {
    const tx: Tx = {
      txId: result.tx_id as string,
      timestamp: result.timestamp as number,
      version: result.version as number,
      voided: result.voided === 1,
      height: result.height as number,
      weight: result.weight as number,
    };

    transactions.push(tx);
  }

  return transactions;
};
