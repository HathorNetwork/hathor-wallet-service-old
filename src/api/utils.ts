/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import middy from '@middy/core';
import Joi, {
  Schema,
  ValidationOptions,
  ValidationResult,
} from 'joi';

import { ApiError } from '@src/api/errors';
import {
  PushProvider,
  StringMap,
  ParamValidationResult,
} from '@src/types';
import { closeDbConnection } from '@src/utils';

export const STATUS_CODE_TABLE = {
  [ApiError.MISSING_PARAMETER]: 400,
  [ApiError.INVALID_BODY]: 400,
  [ApiError.INVALID_TX_WEIGHT]: 400,
  [ApiError.INVALID_SELECTION_ALGORITHM]: 400,
  [ApiError.UNKNOWN_ERROR]: 500,
  [ApiError.INPUTS_NOT_FOUND]: 400,
  [ApiError.INPUTS_ALREADY_USED]: 400,
  [ApiError.INSUFFICIENT_FUNDS]: 400,
  [ApiError.INSUFFICIENT_INPUTS]: 400,
  [ApiError.INVALID_PARAMETER]: 400,
  [ApiError.AUTH_INVALID_SIGNATURE]: 400,
  [ApiError.INVALID_PAYLOAD]: 400,
  [ApiError.TOO_MANY_INPUTS]: 400,
  [ApiError.TOO_MANY_OUTPUTS]: 400,
  [ApiError.TX_PROPOSAL_NOT_FOUND]: 404,
  [ApiError.TX_PROPOSAL_NOT_OPEN]: 400,
  [ApiError.TX_PROPOSAL_SEND_ERROR]: 400,
  [ApiError.TX_PROPOSAL_NO_MATCH]: 400,
  [ApiError.WALLET_NOT_FOUND]: 404,
  [ApiError.WALLET_NOT_READY]: 400,
  [ApiError.WALLET_ALREADY_LOADED]: 400,
  [ApiError.FORBIDDEN]: 403,
  [ApiError.UNAUTHORIZED]: 401,
  [ApiError.INPUTS_NOT_IN_WALLET]: 400,
  [ApiError.TX_OUTPUT_NOT_IN_WALLET]: 403,
  [ApiError.ADDRESS_NOT_IN_WALLET]: 400,
  [ApiError.WALLET_MAX_RETRIES]: 400,
  [ApiError.TOKEN_NOT_FOUND]: 404,
  [ApiError.DEVICE_NOT_FOUND]: 404,
  [ApiError.TX_NOT_FOUND]: 404,
  [ApiError.ADDRESS_NOT_FOUND]: 404,
};

/**
 * Close database connection and get error object.
 *
 * @param mysql - The database connection
 * @param error - ApiError return code
 * @param extra - Extra data to be sent on the body of the error object
 * @returns The error object
 */
export const closeDbAndGetError = async (
  mysql: ServerlessMysql,
  error: ApiError,
  extra?: StringMap<unknown>,
): Promise<APIGatewayProxyResult> => {
  await closeDbConnection(mysql);
  const body = { success: false, error, ...extra };
  return {
    statusCode: STATUS_CODE_TABLE[error],
    body: JSON.stringify(body),
  };
};

/**
 * Will return early if the request is a wake-up call from serverless-plugin-warmup
 */
export const warmupMiddleware = (): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> => {
  const warmupBefore = (request: middy.Request): APIGatewayProxyResult | undefined => {
    if (request.event.source === 'serverless-plugin-warmup') {
      return {
        statusCode: 200,
        body: 'OK',
      };
    }

    return undefined;
  };

  return {
    before: warmupBefore,
  };
};

export const pushProviderRegexPattern = (): RegExp => {
  const entries = Object.values(PushProvider);
  const options = entries.join('|');
  return new RegExp(`^(?:${options})$`);
};

export const validateParams = <ResultType>(
  validator: Schema,
  params: unknown,
  validatorOptions: ValidationOptions = {
    abortEarly: false,
    convert: false,
  },
): ParamValidationResult<ResultType> => {
  const result: ValidationResult = validator.validate(params, validatorOptions);

  const { error, value } = result;

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return {
      error: true,
      details,
    };
  }

  return {
    error: false,
    value,
  };
};

/**
 * This should be used inside a Joi validator object
 */
export const txIdJoiValidator = Joi.string().alphanum().min(64).max(64);
