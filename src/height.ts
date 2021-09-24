/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';

import { getLatestHeight, getBlockByHeight } from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';

const mysql = getDbConnection();

/*
 * Get the service's current best block
 *
 * This lambda is called by API Gateway on GET /best_block
 */
export const getLatestBlock: APIGatewayProxyHandler = async () => {
  const height = await getLatestHeight(mysql);
  const block = await getBlockByHeight(mysql, height);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      block,
    }),
  };
};
