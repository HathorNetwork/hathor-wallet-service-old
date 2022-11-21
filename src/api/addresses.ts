/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import Joi from 'joi';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, warmupMiddleware } from '@src/api/utils';
import {
  getWallet,
  getWalletAddresses,
} from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';

const mysql = getDbConnection();

const querySchema = Joi.object({
  filterAddresses: Joi.array()
    .items(Joi.string().alphanum())
    .min(1)
    .optional(),
});

/*
 * Get the addresses of a wallet
 *
 * This lambda is called by API Gateway on GET /addresses
 */
export const get: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const status = await getWallet(mysql, walletId);
  const multiQueryString = event.multiValueQueryStringParameters || {};
  const filterAddresses = multiQueryString.filterAddresses;

  const { value, error } = querySchema.validate({
    filterAddresses,
  }, {
    abortEarly: false, // We want it to return all the errors not only the first
    convert: true, // We need to convert as parameters are sent on the QueryString
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const addresses = await getWalletAddresses(mysql, walletId, value.filterAddresses);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, addresses }),
  };
})).use(cors())
  .use(warmupMiddleware());
