/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import {
  getWallet,
  getNewAddresses,
} from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';

import { walletIdProxyHandler } from '@src/commons';

const mysql = getDbConnection();

/*
 * Get the addresses of a wallet to be used in new transactions
 * It returns the empty addresses after the last used one
 *
 * This lambda is called by API Gateway on GET /addresses/new
 */
export const get: APIGatewayProxyHandler = walletIdProxyHandler(async (walletId) => {
  console.time('Get wallet');
  const status = await getWallet(mysql, walletId);
  console.timeEnd('Get wallet');

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  console.time('getNewAddresses');
  const addresses = await getNewAddresses(mysql, walletId);
  console.timeEnd('getNewAddresses');

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, addresses }),
  };
});
