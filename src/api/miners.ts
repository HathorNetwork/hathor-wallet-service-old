/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  getMinersList,
} from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';
import { Miner } from '@src/types';
import middy from '@middy/core';
import cors from '@middy/http-cors';

const mysql = getDbConnection();

/*
 * Gets a list of all miners on the database. We consider a miner an address
 * that has received at least one mining transaction
 *
 * @remarks
 * This is a lambda function that should be invoked using the aws-sdk.
 */
export const onMinersListRequest: APIGatewayProxyHandler = middy(async () => {
  const minersList: Miner[] = await getMinersList(mysql);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      miners: minersList,
    }),
  };
}).use(cors());
