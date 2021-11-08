/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  getTotalSupply,
} from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';

const mysql = getDbConnection();

/*
 * Gets the calculated sum of utxos on the database, excluding the burned ones
 *
 * @remarks
 * This is a lambda function that should be invoked using the aws-sdk.
 */
export const onTotalSupplyRequest: APIGatewayProxyHandler = async () => {
  const totalSupply: number = await getTotalSupply(mysql);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      totalSupply,
    }),
  };
};
