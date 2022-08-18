/* eslint-disable max-classes-per-file */

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface WalletBalanceEntry {
  walletId: string;
  tokenId: string;
  unlockedBalance: number;
  lockedBalance: number;
  unlockedAuthorities: number;
  lockedAuthorities: number;
  timelockExpires?: number;
  transactions: number;
}

export interface AddressTxHistoryTableEntry {
  address: string;
  txId: string;
  tokenId: string;
  balance: number;
  timestamp: number;
  voided?: boolean;
}

export interface AddressTableEntry {
  address: string;
  index: number;
  walletId?: string;
  transactions: number;
}

export interface TokenTableEntry {
  id: string;
  name: string;
  symbol: string;
  transactions: number;
}

export interface WalletTableEntry {
  id: string;
  xpubkey: string;
  authXpubkey: string;
  status: string;
  maxGap: number;
  highestUsedIndex?: number;
  createdAt: number;
  readyAt: number;
}
