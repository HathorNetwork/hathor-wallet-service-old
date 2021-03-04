/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import { getWalletBalances } from '@src/commons';
import {
  getWallet,
} from '@src/db';
import {
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
} from '@src/utils';
import Joi from 'joi';

const mysql = getDbConnection();

const paramsSchema = Joi.object({
  id: Joi.string()
    .required(),
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
export const get: APIGatewayProxyHandler = async (event) => {
  const params = event.queryStringParameters;

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

  const walletId = value.id;
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
};
