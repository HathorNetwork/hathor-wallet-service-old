/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import promClient from 'prom-client';
import 'source-map-support/register';

import { getLatestHeight } from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';

const mysql = getDbConnection();

// Default labels
const defaultLabels = {
  network: process.env.NETWORK,
  environment: process.env.STAGE,
};
promClient.register.setDefaultLabels(defaultLabels);

// Best block height metric
new promClient.Gauge({  // eslint-disable-line no-new
  name: 'wallet_service:best_block_height',
  help: 'The height of the latest block received',
  async collect() {
    const height = await getLatestHeight(mysql);
    this.set(height);
  },
});

/*
 * Returns all registered metrics in Prometheus format
 *
 * This lambda is called by API Gateway on GET /metrics
 */
export const getMetrics: APIGatewayProxyHandler = async () => {
  const body = await promClient.register.metrics();
  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body,
  };
};
