/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import {
  getLatestHeight,
  getWallet,
  getWalletBalances,
  getWalletUnlockedUtxos,
} from '@src/db';
import { unlockUtxos } from '@src/txProcessor';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';

const mysql = getDbConnection();

/*
 * Get the balances of a wallet
 *
 * This lambda is called by API Gateway on GET /balances
 */
export const get: APIGatewayProxyHandler = async (event) => {
  const params = event.queryStringParameters;
  let walletId: string;
  if (params && params.id) {
    walletId = params.id;
  } else {
    return closeDbAndGetError(mysql, ApiError.MISSING_PARAMETER, { parameter: 'id' });
  }

  const status = await getWallet(mysql, walletId);
  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  let tokenId: string = null;
  if (params && params.token_id) {
    tokenId = params.token_id;
    // TODO validate tokenId
  }

  let balances = await getWalletBalances(mysql, walletId, tokenId);

  // if any of the balances' timelock has expired, update the tables before returning
  const now = getUnixTimestamp();
  const refreshBalances = balances.some((tb) => {
    if (tb.balance.lockExpires && tb.balance.lockExpires <= now) {
      return true;
    }
    return false;
  });

  if (refreshBalances) {
    await updateBalances(mysql, walletId, now);
    balances = await getWalletBalances(mysql, walletId, tokenId);
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, balances }),
  };
};

/**
 * Unlocks utxos for the latest height for a given wallet
 *
 * @param mysql - Database connection
 * @param walletId - The wallet Id
 * @param now - Current timestamp
 */
const updateBalances = async (_mysql: ServerlessMysql, walletId: string, now: number) => {
  const currentHeight = await getLatestHeight(_mysql);
  const utxos = await getWalletUnlockedUtxos(_mysql, walletId, now, currentHeight);
  await unlockUtxos(_mysql, utxos, true);
};
