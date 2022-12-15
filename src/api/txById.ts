/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, warmupMiddleware } from '@src/api/utils';
import { getTransactionById } from '@src/db';
import { getDbConnection } from '@src/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi, { ValidationError } from 'joi';
import { TxByIdRequest } from '@src/types';

const mysql = getDbConnection();

class TxByIdValidator {
  static readonly bodySchema = Joi.object({
    txId: Joi.string().min(64).max(64).required(),
  });

  static validate(payload): { value: TxByIdRequest, error: ValidationError } {
    return TxByIdValidator.bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    }) as { value: TxByIdRequest, error: ValidationError };
  }
}

/*
 * Get a transaction by its ID.
 *
 * This lambda is called by API Gateway on GET /wallet/transactions/:txId
 */
export const get: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const { value: body, error } = TxByIdValidator.validate(event.pathParameters);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const txTokens = await getTransactionById(mysql, body.txId, walletId);
  if (!txTokens.length) {
    return closeDbAndGetError(mysql, ApiError.TX_NOT_FOUND);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, txTokens }),
  };
}))
  .use(cors())
  .use(warmupMiddleware());
