/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable max-classes-per-file */
import { ServerlessMysql } from 'serverless-mysql';
import { getWalletId } from '@src/utils';
import {
  WalletStatus,
  Wallet,
  Tx,
  DbSelectResult,
  TokenBalanceMap,
  BalanceValue,
  WalletBalanceValue,
  StringMap,
  WalletBalance,
} from '@src/types';

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
    const tx: Tx = _mapTxRecord2Tx(result);

    transactions.push(tx);
  }

  return transactions;
};

/**
 * Receive a DbSelectResult with one record and transform it in a Tx
 *
 * @param results
 * @returns Tx converted from DbSelectResult
 */
export const getTxFromDBResult = (result: DbSelectResult): Tx => {
  const { 0: row } = result;
  return _mapTxRecord2Tx(row);
};

const _mapTxRecord2Tx = (record: Record<string, unknown>): Tx => (
  {
    txId: record.tx_id as string,
    timestamp: record.timestamp as number,
    version: record.version as number,
    voided: record.voided === 1,
    height: record.height as number,
    weight: record.weight as number,
  }
);

export class FromTokenBalanceMapToBalanceValueList {
  static convert(tokenBalanceMap: TokenBalanceMap): BalanceValue[] {
    const entryBalances = Object.entries(tokenBalanceMap.map);
    const balances = entryBalances.map((entry) => ({
      tokenId: entry[0],
      lockedAmount: entry[1].lockedAmount,
      lockedAuthorities: entry[1].lockedAuthorities.toJSON(),
      lockExpires: entry[1].lockExpires,
      unlockedAmount: entry[1].unlockedAmount,
      unlockedAuthorities: entry[1].unlockedAuthorities.toJSON(),
      totalAmountSent: entry[1].totalAmountSent,
      total: entry[1].total(),
    } as BalanceValue));
    return balances;
  }
}

export const sortBalanceValueByAbsTotal = (balanceA: BalanceValue, balanceB: BalanceValue): number => {
  if (Math.abs(balanceA.total) - Math.abs(balanceB.total) >= 0) return -1;
  return 0;
};

export class WalletBalanceMapConverter {
  static toValue(walletBalanceMap: StringMap<WalletBalance>): StringMap<WalletBalanceValue> {
    const walletBalanceEntries = Object.entries(walletBalanceMap);

    const walletBalanceValueMap: StringMap<WalletBalanceValue> = {};
    for (const [walletId, walletBalance] of walletBalanceEntries) {
      const sortedTokenBalanceList = FromTokenBalanceMapToBalanceValueList
        .convert(walletBalance.walletBalanceForTx)
        .sort(sortBalanceValueByAbsTotal);

      walletBalanceValueMap[walletId] = {
        addresses: walletBalance.addresses,
        txId: walletBalance.txId,
        walletId: walletBalance.walletId,
        walletBalanceForTx: sortedTokenBalanceList,
      };
    }

    return walletBalanceValueMap;
  }
}

export const stringMapIterator = (stringMap: StringMap<unknown>): [string, unknown][] => (Object.entries(stringMap));
