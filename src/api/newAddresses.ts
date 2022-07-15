/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, warmupMiddleware } from '@src/api/utils';
import {
  getWallet,
  getNewAddresses,
} from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';

import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';

const mysql = getDbConnection();

/*
 * Get the addresses of a wallet to be used in new transactions
 * It returns the empty addresses after the last used one
 *
 * This lambda is called by API Gateway on GET /addresses/new
 */
export const get: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId) => {
  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const addresses = await getNewAddresses(mysql, walletId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, addresses }),
  };
})).use(cors())
  .use(warmupMiddleware());
