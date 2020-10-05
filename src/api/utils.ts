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
    statusCode: 200,
    body: JSON.stringify(body),
  };
};
