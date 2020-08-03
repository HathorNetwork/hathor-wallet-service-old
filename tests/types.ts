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

export interface AddressTableEntry {
  address: string;
  index: number;
  walletId?: string;
  transactions: number;
}
