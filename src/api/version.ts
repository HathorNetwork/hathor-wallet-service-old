/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';

import {
  getVersionData,
} from '@src/db';
import {
  FullNodeVersionData,
} from '@src/types';
import {
  closeDbConnection,
  getDbConnection,
} from '@src/utils';
import { maybeRefreshWalletConstants } from '@src/commons';

const mysql = getDbConnection();

/*
 * Get version data from the stored data from the connected fullnode
 *
 * This lambda is called by API Gateway on GET /version
 */
export const get: APIGatewayProxyHandler = async () => {
  await maybeRefreshWalletConstants(mysql);

  const versionData: FullNodeVersionData = await getVersionData(mysql);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      data: versionData,
    }),
  };
};
