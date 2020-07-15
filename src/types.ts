/* eslint-disable max-classes-per-file */
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

export class Balance {
  locked: number;

  unlocked: number;

  lockExpires: number | null;

  constructor(unlocked = 0, locked = 0, lockExpires = null) {
    this.unlocked = unlocked;
    this.locked = locked;
    this.lockExpires = lockExpires;
  }

  /**
   * Get the total balance, sum of unlocked and locked
   *
   * @returns The total balance
   */
  total(): number {
    return this.unlocked + this.locked;
  }

  /**
   * Clone this Balance object.
   *
   * @returns A new Balance object with the same balances (unlocked and locked)
   */
  clone(): Balance {
    return new Balance(this.unlocked, this.locked, this.lockExpires);
  }

  /**
   * Merge two balances.
   *
   * @remarks
   * In case lockExpires is set, it returns the lowest one.
   *
   * @param b1 - First balance
   * @param b2 - Second balance
   * @returns The sum of both balances
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
    return new Balance(b1.unlocked + b2.unlocked, b1.locked + b2.locked, lockExpires);
  }
}

export interface Utxo {
  txId: string;
  index: number;
  tokenId: string;
  address: string;
  value: number;
  timelock: number | null;
  heightlock: number | null;
  locked: boolean;
}

export interface TokenBalance {
  tokenId: string;
  balance: Balance;
  transactions: number;
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
   * }
   * ```
   *
   * @param tokenBalanceMap - The js object to convert to a TokenBalanceMap
   * @returns - The new TokenBalanceMap object
   */
  static fromStringMap(tokenBalanceMap: StringMap<StringMap<number>>): TokenBalanceMap {
    const obj = new TokenBalanceMap();
    for (const [tokenId, balance] of Object.entries(tokenBalanceMap)) {
      obj.set(tokenId, new Balance(balance.unlocked, balance.locked, balance.lockExpires || null));
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
    // TODO handle authority
    // TODO check if output.decoded exists, else return null
    const token = output.token;
    const value = output.value;

    const obj = new TokenBalanceMap();
    if (output.locked) {
      obj.set(token, new Balance(0, value, output.decoded.timelock));
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
    // TODO handle authority
    // TODO check if output.decoded exists, else return null
    const token = input.token;
    const value = -input.value;

    const obj = new TokenBalanceMap();
    obj.set(token, new Balance(value, 0, null));
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
  value: number;
  // eslint-disable-next-line camelcase
  token_data?: number;
}

export interface TxOutput {
  value: number;
  script: string;
  token: string;
  decoded: DecodedOutput;
  // eslint-disable-next-line camelcase
  spent_by: string | null;
  // eslint-disable-next-line camelcase
  token_data?: number;
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
}
