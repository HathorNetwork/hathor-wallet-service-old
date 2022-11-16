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
import Joi from 'joi';
import { TxById } from '@src/types';

const mysql = getDbConnection();

class TxByIdInputValidator {
  static #bodySchema = Joi.object({
    txId: Joi.string().required(),
  });

  static validate(payload): Joi.ValidationResult<TxById> {
    return TxByIdInputValidator.#bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    });
  }
}

/*
 * Get a transaction by its ID.
 *
 * This lambda is called by API Gateway on GET /wallet/getTxById
 */
export const get: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const { value: body, error } = TxByIdInputValidator.validate(event.body);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const tx = await getTransactionById(mysql, body.txId);
  if (!tx) {
    return closeDbAndGetError(mysql, ApiError.TX_NOT_FOUND);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, tx }),
  };
}))
  .use(cors())
  .use(warmupMiddleware());
