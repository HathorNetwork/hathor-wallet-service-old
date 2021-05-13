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
import {
  getWallet,
  getAddressesToUse,
} from '@src/db';
import Joi from 'joi';
import { closeDbConnection, getDbConnection } from '@src/utils';

const mysql = getDbConnection();

const paramsSchema = Joi.object({
  id: Joi.string()
    .required(),
});

/*
 * Get the addresses of a wallet to be used in new transactions
 * It returns the empty addresses after the last used one
 *
 * This lambda is called by API Gateway on GET /addressestouse
 */
export const get: APIGatewayProxyHandler = async (event) => {
  const params = event.queryStringParameters;

  const { value, error } = paramsSchema.validate(params, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const walletId: string = value.id;

  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const addresses = await getAddressesToUse(mysql, walletId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, addresses }),
  };
};
