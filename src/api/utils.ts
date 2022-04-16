/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';

import { ApiError } from '@src/api/errors';
import { StringMap } from '@src/types';
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
  [ApiError.TX_OUTPUT_NOT_FOUND]: 400,
  [ApiError.TX_OUTPUT_NOT_IN_WALLET]: 403,
  [ApiError.ADDRESS_NOT_IN_WALLET]: 400,
  [ApiError.WALLET_MAX_RETRIES]: 400,
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
