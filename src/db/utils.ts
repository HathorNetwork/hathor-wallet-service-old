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
  TokenBalanceValue,
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
  /**
   * Convert the map of token balance instance into a map of token balance value.
   * It also hydrate each token balance value with token symbol.
   *
   * @param tokenBalanceMap - Map of token balance instance
   * @param tokenSymbolsMap - Map token's id to its symbol
   * @returns a map of token balance value
   */
  static convert(tokenBalanceMap: TokenBalanceMap, tokenSymbolsMap: StringMap<string>): TokenBalanceValue[] {
    const entryBalances = Object.entries(tokenBalanceMap.map);
    const balances = entryBalances.map(([tokenId, balance]) => ({
      tokenId,
      tokenSymbol: tokenSymbolsMap[tokenId],
      lockedAmount: balance.lockedAmount,
      lockedAuthorities: balance.lockedAuthorities.toJSON(),
      lockExpires: balance.lockExpires,
      unlockedAmount: balance.unlockedAmount,
      unlockedAuthorities: balance.unlockedAuthorities.toJSON(),
      totalAmountSent: balance.totalAmountSent,
      total: balance.total(),
    } as TokenBalanceValue));
    return balances;
  }
}

export const sortBalanceValueByAbsTotal = (balanceA: TokenBalanceValue, balanceB: TokenBalanceValue): number => {
  if (Math.abs(balanceA.total) - Math.abs(balanceB.total) >= 0) return -1;
  return 0;
};

export class WalletBalanceMapConverter {
  /**
   * Convert the map of wallet balance instance into a map of wallet balance value.
   *
   * @param walletBalanceMap - Map wallet's id to its balance
   * @param tokenSymbolsMap - Map token's id to its symbol
   * @returns a map of wallet id to its balance value
   */
  static toValue(walletBalanceMap: StringMap<WalletBalance>, tokenSymbolsMap: StringMap<string>): StringMap<WalletBalanceValue> {
    const walletBalanceEntries = Object.entries(walletBalanceMap);

    const walletBalanceValueMap: StringMap<WalletBalanceValue> = {};
    for (const [walletId, walletBalance] of walletBalanceEntries) {
      const sortedTokenBalanceList = FromTokenBalanceMapToBalanceValueList
        // hydrate token balance value with token symbol while convert to value
        .convert(walletBalance.walletBalanceForTx, tokenSymbolsMap)
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
