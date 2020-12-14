/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash, HexBase64Latin1Encoding } from 'crypto';
import serverlessMysql, { ServerlessMysql } from 'serverless-mysql';
import hathorLib from '@hathor/wallet-lib';
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
