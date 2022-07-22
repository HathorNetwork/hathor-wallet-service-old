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
import { getWalletBalances, walletIdProxyHandler } from '@src/commons';
import {
  getWallet,
} from '@src/db';
import {
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
} from '@src/utils';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi from 'joi';

const mysql = getDbConnection();

const paramsSchema = Joi.object({
  token_id: Joi.string()
    .alphanum()
    .optional(),
});

/*
 * Get the balances of a wallet
 *
 * This lambda is called by API Gateway on GET /balances
 *
 * XXX: If token_id is not sent as a filter, we return all token balances
 * Maybe we should limit the amount of tokens to query the balance to prevent an user
 * with a lot of different tokens in his wallet from doing an expensive query
 */
export const get: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const params = event.queryStringParameters || {};

  const { value, error } = paramsSchema.validate(params, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const tokenIds: string[] = [];
  if (value.token_id) {
    const tokenId = value.token_id;
    tokenIds.push(tokenId);
  }

  const balances = await getWalletBalances(mysql, getUnixTimestamp(), walletId, tokenIds);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, balances }),
  };
})).use(cors())
  .use(warmupMiddleware());
