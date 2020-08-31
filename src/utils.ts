/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Address, HDPublicKey, Networks } from 'bitcore-lib';
import { createHash, HexBase64Latin1Encoding } from 'crypto';
// eslint-disable-next-line
import { StringMap } from '@src/types';

import serverlessMysql, { ServerlessMysql } from 'serverless-mysql';
import hathorLib from '@hathor/wallet-lib';

// TODO get from hathor-lib or maybe env?
const mainnet = Networks.add({
  name: 'mainnet',
  alias: 'production',
  pubkeyhash: 0x28,
  privatekey: 0x80,
  scripthash: 0x64,
  xpubkey: 0x0488b21e,
  xprivkey: 0x0488ade4,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: [],
});

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
 * Get Hathor addresses in bulk, passing the start index and quantity of addresses to be generated
 *
 * @example
 * ```
 * getHathorAddresses('myxpub', 2, 3) => {
 *   'address2': 2,
 *   'address3': 3,
 *   'address4': 4,
 * }
 * ```
 *
 * @param xpubkey - The xpubkey
 * @param startIndex - Generate addresses starting from this index
 * @param quantity - Amount of addresses to generate
 * @returns A list with the generated addresses and corresponding index
 */
export const getHathorAddresses = (xpubkey: string, startIndex: number, quantity: number): StringMap<number> => {
  const addrMap: StringMap<number> = {};
  const xpub = HDPublicKey(xpubkey);
  for (let index = startIndex; index < startIndex + quantity; index++) {
    const key = xpub.derive(index);
    const address = Address(key.publicKey, mainnet);
    addrMap[address.toString()] = index;
  }
  return addrMap;
};
