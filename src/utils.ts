/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash, HexBase64Latin1Encoding } from 'crypto';

import serverlessMysql, { ServerlessMysql } from 'serverless-mysql';
import hathorLib from '@hathor/wallet-lib';
import fullnode from '@src/fullnode';

/* TODO: We should remove this as soon as the wallet-lib is refactored
*  (https://github.com/HathorNetwork/hathor-wallet-lib/issues/122)
*/
export class CustomStorage {
  store: unknown;

  constructor() {
    this.preStart();
  }

  getItem(key: string): string {
    return this.store[key];
  }

  setItem(key: string, value: string): string {
    this.store[key] = value;

    return value;
  }

  removeItem(key: string): string {
    delete this.store[key];

    return key;
  }

  clear(): void {
    this.store = {};
  }

  preStart(): void {
    this.store = {
      'wallet:server': process.env.DEFAULT_SERVER || hathorLib.constants.DEFAULT_SERVER,
      'wallet:defaultServer': process.env.DEFAULT_SERVER || hathorLib.constants.DEFAULT_SERVER,
    };
  }
}

hathorLib.network.setNetwork(process.env.NETWORK);
hathorLib.storage.setStore(new CustomStorage());

/**
 * Calculate the double sha256 hash of the data.
 *
 * @remarks
 * If encoding is provided a string will be returned; otherwise a Buffer is returned.
 *
 * @param data - Data to be hashed
 * @param encoding - The encoding of the returned object
 * @returns The sha256d hash of the data
 */
export const sha256d = (data: string, encoding: HexBase64Latin1Encoding): string => {
  const hash1 = createHash('sha256');
  hash1.update(data);
  const hash2 = createHash('sha256');
  hash2.update(hash1.digest());
  return hash2.digest(encoding);
};

/**
 * Get the wallet id given the xpubkey.
 *
 * @param xpubkey - The xpubkey
 * @returns The wallet id
 */
export const getWalletId = (xpubkey: string): string => (
  sha256d(xpubkey, 'hex')
);

/**
 * Get the current Unix timestamp, in seconds.
 *
 * @returns The current Unix timestamp in seconds
 */
export const getUnixTimestamp = (): number => (
  Math.round((new Date()).getTime() / 1000)
);

/**
 * Get a database connection.
 *
 * @returns The database connection
 */
export const getDbConnection = (): ServerlessMysql => (
  serverlessMysql({
    config: {
      host: process.env.DB_ENDPOINT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      port: parseInt(process.env.DB_PORT, 10),
      // TODO if not on local env, get IAM token
      // https://aws.amazon.com/blogs/database/iam-role-based-authentication-to-amazon-aurora-from-serverless-applications/
      password: process.env.DB_PASS,
    },
  })
);

export const closeDbConnection = async (mysql: ServerlessMysql): Promise<void> => {
  if (process.env.STAGE === 'local') {
    // mysql.end() leaves the function hanging in the local environment. Some issues:
    // https://github.com/jeremydaly/serverless-mysql/issues/61
    // https://github.com/jeremydaly/serverless-mysql/issues/79
    //
    // It seems that's the expected behavior for local environment:
    // https://github.com/serverless/serverless/issues/470#issuecomment-205372006
    await mysql.quit();
  } else {
    await mysql.end();
  }
};

export const isAuthority = (tokenData: number): boolean => (
  (tokenData & hathorLib.constants.TOKEN_AUTHORITY_MASK) > 0    // eslint-disable-line no-bitwise
);

/**
 * Shuffle an array in place.
 *
 * @remarks
 * Got it from https://stackoverflow.com/a/6274381.
 *
 * @param array - An array containing the items
 */
export const arrayShuffle = <T extends unknown>(array: T[]): T[] => {
  /* eslint-disable no-param-reassign */
  let j;
  let x;
  let i;
  for (i = array.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    x = array[i];
    array[i] = array[j];
    array[j] = x;
  }
  return array;
  /* eslint-enable no-param-reassign */
};

/**
 * Requests the fullnode for the requested transaction information and returns
 * if it is voided or not and the downloaded object
 *
 * @param txId - The transaction id
 *
 * @returns A tuple with the result and the downloaded transaction
 */
export const isTxVoided = async (txId: string): Promise<[boolean, any]> => {
  const transaction = await fullnode.downloadTx(txId);

  if (!transaction.meta.voided_by || transaction.meta.voided_by.length === 0) {
    return [false, transaction];
  }

  return [true, transaction];
};

/**
 * Requests the fullnode for a block and returns a tuple with the height and the
 * downloaded block
 *
 * @param txId - The transaction id
 *
 * @returns A tuple with the result and the downloaded transaction
 */
export const fetchBlockHeight = async (txId: string): Promise<[number, any]> => {
  const transaction = await fullnode.downloadTx(txId);

  if (!transaction.height) {
    throw new Error(`Block ${txId} has no height.`);
  }

  return [transaction.height, transaction];
};

/**
 * Creates default address path from address index
 *
 * @returns {string} The address path
 */
export const getAddressPath = (index: number): string => (
  `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/${index}`
);
