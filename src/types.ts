/* eslint-disable max-classes-per-file */

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface StringMap<T> {
  [x: string]: T;
}

export type AddressIndexMap = StringMap<number>;

export interface GenerateAddresses {
  addresses: string[];
  existingAddresses: StringMap<number>;
  newAddresses: StringMap<number>;
}

export enum WalletStatus {
  CREATING = 'creating',
  READY = 'ready',
  ERROR = 'error',
}

export interface Wallet {
  walletId: string;
  xpubkey: string;
  maxGap: number;
  status?: WalletStatus;
  createdAt?: number;
  readyAt?: number;
}

export interface AddressInfo {
  address: string;
  index: number;
  transactions: number;
}

export interface TokenBalance {
  tokenId: string;
  balance: Balance;
  transactions: number;
}

export interface Utxo {
  txId: string;
  index: number;
  tokenId: string;
  address: string;
  value: number;
  authorities: number;
  timelock: number | null;
  heightlock: number | null;
  locked: boolean;
}

export class TokenInfo {
  id: string;

  name: string;

  symbol: string;

  constructor(id: string, name: string, symbol: string) {
    this.id = id;
    this.name = name;
    this.symbol = symbol;
    // TODO get HTR info from lib
    // XXX should we force HTR info for token '00'?
    if (this.id === '00') {
      this.name = 'Hathor';
      this.symbol = 'HTR';
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      symbol: this.symbol,
    };
  }
}

export class Authorities {
  /**
   * Supporting up to 8 authorities (but we only have mint and melt at the moment)
   */
  static LENGTH = 8;

  array: number[];

  constructor(authorities?: number | number[]) {
    let tmp = [];
    if (authorities instanceof Array) {
      tmp = authorities;
    } else if (authorities != null) {
      tmp = Authorities.intToArray(authorities);
    }

    this.array = new Array(Authorities.LENGTH - tmp.length).fill(0).concat(tmp);
  }

  /**
   * Get the integer representation of this authority.
   *
   * @remarks
   * Uses the array to calculate the final number. Examples:
   * [0, 0, 0, 0, 1, 1, 0, 1] = 0b00001101 = 13
   * [0, 0, 1, 0, 0, 0, 0, 1] = 0b00100001 = 33
   *
   * @returns The integer representation
   */
  toInteger(): number {
    let n = 0;
    for (let i = 0; i < this.array.length; i++) {
      n += this.array[i] * (2 ** (this.array.length - i - 1));
    }
    return n;
  }

  clone(): Authorities {
    return new Authorities(this.array);
  }

  /**
   * Return a new object inverting each authority value sign.
   *
   * @remarks
   * If value is set to 1, it becomes -1 and vice versa. Value 0 remains unchanged.
   *
   * @returns A new Authority object with the values inverted
   */
  toNegative(): Authorities {
    const finalAuthorities = this.array.map((value) => {
      if (value === 0) return 0;
      return (-1) * value;
    });
    return new Authorities(finalAuthorities);
  }

  /**
   * Return if any of the authorities has a negative value.
   *
   * @remarks
   * Negative values for an authority only make sense when dealing with balances of a
   * transaction. So if we consume an authority in the inputs but do not create the same
   * one in the output, it will have value -1.
   *
   * @returns `true` if any authority is less than 0; `false` otherwise
   */
  hasNegativeValue(): boolean {
    return this.array.some((authority) => authority < 0);
  }

  /**
   * Transform an integer into an array, considering 1 array element per bit.
   *
   * @returns The array given an integer
   */
  static intToArray(authorities: number): number[] {
    const ret = [];
    for (const c of authorities.toString(2)) {
      ret.push(parseInt(c, 10));
    }
    return ret;
  }

  /**
   * Merge two authorities.
   *
   * @remarks
   * The process is done individualy for each authority value. Each a1[n] and a2[n] are compared.
   * If both values are the same, the final value is the same. If one is 1 and the other -1, final
   * value is 0.
   *
   * @returns A new object with the merged values
   */
  static merge(a1: Authorities, a2: Authorities): Authorities {
    return new Authorities(a1.array.map((value, index) => Math.sign(value + a2.array[index])));
  }

  toJSON(): Record<string, unknown> {
    const authorities = this.toInteger();
    return {
      // TODO get from lib
      mint: (authorities & 0b00000001) > 0,   // eslint-disable-line no-bitwise
      melt: (authorities & 0b00000010) > 0,   // eslint-disable-line no-bitwise
    };
  }
}

export class Balance {
  lockedAmount: number;

  unlockedAmount: number;

  lockedAuthorities: Authorities;

  unlockedAuthorities: Authorities;

  lockExpires: number | null;

  constructor(unlockedAmount = 0, lockedAmount = 0, lockExpires = null, unlockedAuthorities = null, lockedAuthorities = null) {
    this.unlockedAmount = unlockedAmount;
    this.lockedAmount = lockedAmount;
    this.lockExpires = lockExpires;
    this.unlockedAuthorities = unlockedAuthorities || new Authorities();
    this.lockedAuthorities = lockedAuthorities || new Authorities();
  }

  /**
   * Get the total balance, sum of unlocked and locked amounts.
   *
   * @returns The total balance
   */
  total(): number {
    return this.unlockedAmount + this.lockedAmount;
  }

  /**
   * Get all authorities, combination of unlocked and locked.
   *
   * @returns The combined authorities
   */
  authorities(): Authorities {
    return Authorities.merge(this.unlockedAuthorities, this.lockedAuthorities);
  }

  /**
   * Clone this Balance object.
   *
   * @returns A new Balance object with the same information
   */
  clone(): Balance {
    return new Balance(this.unlockedAmount, this.lockedAmount, this.lockExpires, this.unlockedAuthorities.clone(), this.lockedAuthorities.clone());
  }

  /**
   * Merge two balances.
   *
   * @remarks
   * In case lockExpires is set, it returns the lowest one.
   *
   * @param b1 - First balance
   * @param b2 - Second balance
   * @returns The sum of both balances and authorities
   */
  static merge(b1: Balance, b2: Balance): Balance {
    let lockExpires = null;
    if (b1.lockExpires === null) {
      lockExpires = b2.lockExpires;
    } else if (b2.lockExpires === null) {
      lockExpires = b1.lockExpires;
    } else {
      lockExpires = Math.min(b1.lockExpires, b2.lockExpires);
    }
    return new Balance(
      b1.unlockedAmount + b2.unlockedAmount,
      b1.lockedAmount + b2.lockedAmount,
      lockExpires,
      Authorities.merge(b1.unlockedAuthorities, b2.unlockedAuthorities),
      Authorities.merge(b1.lockedAuthorities, b2.lockedAuthorities),
    );
  }
}

export class WalletTokenBalance {
  token: TokenInfo;

  balance: Balance;

  transactions: number;

  constructor(token: TokenInfo, balance: Balance, transactions: number) {
    this.token = token;
    this.balance = balance;
    this.transactions = transactions;
  }

  toJSON(): Record<string, unknown> {
    return {
      token: this.token,
      transactions: this.transactions,
      balance: {
        unlocked: this.balance.unlockedAmount,
        locked: this.balance.lockedAmount,
      },
      tokenAuthorities: {
        unlocked: this.balance.unlockedAuthorities,
        locked: this.balance.lockedAuthorities,
      },
      lockExpires: this.balance.lockExpires,
    };
  }
}

export interface TxTokenBalance {
  txId: string;
  timestamp: number;
  balance: Balance;
}

export class TokenBalanceMap {
  map: StringMap<Balance>;

  constructor() {
    this.map = {};
  }

  get(tokenId: string): Balance {
    // if the token is not present, return 0 instead of undefined
    return this.map[tokenId] || new Balance(0, 0);
  }

  set(tokenId: string, balance: Balance): void {
    this.map[tokenId] = balance;
  }

  iterator(): [string, Balance][] {
    return Object.entries(this.map);
  }

  clone(): TokenBalanceMap {
    const cloned = new TokenBalanceMap();
    for (const [token, balance] of this.iterator()) {
      cloned.set(token, balance.clone());
    }
    return cloned;
  }

  /**
   * Return a TokenBalanceMap from js object.
   *
   * @remarks
   * Js object is expected to have the format:
   * ```
   * {
   *   token1: {unlocked: n, locked: m},
   *   token2: {unlocked: a, locked: b, lockExpires: c},
   *   token3: {unlocked: x, locked: y, unlockedAuthorities: z, lockedAuthorities: w},
   * }
   * ```
   *
   * @param tokenBalanceMap - The js object to convert to a TokenBalanceMap
   * @returns - The new TokenBalanceMap object
   */
  static fromStringMap(tokenBalanceMap: StringMap<StringMap<number | Authorities>>): TokenBalanceMap {
    const obj = new TokenBalanceMap();
    for (const [tokenId, balance] of Object.entries(tokenBalanceMap)) {
      obj.set(tokenId, new Balance(balance.unlocked as number, balance.locked as number, balance.lockExpires || null,
        balance.unlockedAuthorities, balance.lockedAuthorities));
    }
    return obj;
  }

  /**
   * Merge two TokenBalanceMap objects, merging the balances for each token.
   *
   * @param balanceMap1 - First TokenBalanceMap
   * @param balanceMap2 - Second TokenBalanceMap
   * @returns The merged TokenBalanceMap
   */
  static merge(balanceMap1: TokenBalanceMap, balanceMap2: TokenBalanceMap): TokenBalanceMap {
    if (!balanceMap1) return balanceMap2.clone();
    if (!balanceMap2) return balanceMap1.clone();
    const mergedMap = balanceMap1.clone();
    for (const [token, balance] of balanceMap2.iterator()) {
      const finalBalance = Balance.merge(mergedMap.get(token), balance);
      mergedMap.set(token, finalBalance);
    }
    return mergedMap;
  }

  /**
   * Create a TokenBalanceMap from a TxOutput.
   *
   * @param output - The transaction output
   * @returns The TokenBalanceMap object
   */
  static fromTxOutput(output: TxOutput): TokenBalanceMap {
    // TODO check if output.decoded exists, else return null
    const token = output.token;
    const value = output.value;
    const isAuthority = (output.token_data & 0b10000000) > 0;   // eslint-disable-line no-bitwise

    const obj = new TokenBalanceMap();
    if (output.locked) {
      if (isAuthority) obj.set(token, new Balance(0, 0, output.decoded.timelock, 0, new Authorities(output.value)));
      else obj.set(token, new Balance(0, value, output.decoded.timelock, 0, 0));
    } else if (isAuthority) {
      obj.set(token, new Balance(0, 0, null, new Authorities(output.value), 0));
    } else {
      obj.set(token, new Balance(value, 0, null));
    }
    return obj;
  }

  /**
   * Create a TokenBalanceMap from a TxInput.
   *
   * @remarks
   * It will have only one token entry and balance will be negative.
   *
   * @param input - The transaction input
   * @returns The TokenBalanceMap object
   */
  static fromTxInput(input: TxInput): TokenBalanceMap {
    const token = input.token;
    const obj = new TokenBalanceMap();

    // TODO get token mask from lib constants
    if ((input.token_data & 0b10000000) > 0) {    // eslint-disable-line no-bitwise
      // for inputs, the authorities will have a value of -1 when set
      const authorities = new Authorities(input.value);
      obj.set(token, new Balance(0, 0, null, authorities.toNegative(), new Authorities(0)));
    } else {
      obj.set(token, new Balance(-input.value, 0, null));
    }
    return obj;
  }
}

/**
 * Return type from ServerlessMysql#query after performing a SQL SELECT
 * (Array of objects containing the requested table fields.)
 */
export type DbSelectResult = Array<Record<string, unknown>>;

/**
 * Hathor types
 */

export interface DecodedOutput {
  type: string;
  address: string;
  timelock: number | null;
}

export interface TxOutput {
  value: number;
  script: string;
  token: string;
  decoded: DecodedOutput;
  // eslint-disable-next-line camelcase
  spent_by: string | null;
  // eslint-disable-next-line camelcase
  token_data: number;
  locked?: boolean;
}

export interface TxInput {
  // eslint-disable-next-line camelcase
  tx_id: string;
  index: number;
  value: number;
  // eslint-disable-next-line camelcase
  token_data: number;
  script: string;
  token: string;
  decoded: DecodedOutput;
}

export interface Transaction {
  // eslint-disable-next-line camelcase
  tx_id: string;
  nonce: number;
  timestamp: number;
  version: number;
  weight: number;
  parents: string[];
  inputs: TxInput[];
  outputs: TxOutput[];
  height?: number;
  // eslint-disable-next-line camelcase
  token_name?: string;
  // eslint-disable-next-line camelcase
  token_symbol?: string;
}
