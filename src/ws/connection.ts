/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  connectionInfoFromEvent,
  sendMessageToClient,
} from '@src/ws/utils';
import {
  getRedisClient,
  closeRedisClient,
  initWsConnection,
  endWsConnection,
} from '@src/redis';
import { closeDbConnection, getDbConnection } from '@src/utils';

const mysql = getDbConnection();

export const connect = async (
  event: APIGatewayProxyEvent,
): Promise<void> => {
  if (process.env.IS_OFFLINE === 'true') {
    console.log(event); // eslint-disable-line no-console
  }
  const redisClient = getRedisClient();
  const routeKey = event.requestContext.routeKey;
  // info needed to send response to client
  const connInfo = connectionInfoFromEvent(event);

  if (routeKey === '$connect') {
    await initWsConnection(redisClient, connInfo);
  }

  if (routeKey === '$disconnect') {
    // remove connection from connPool
    await endWsConnection(redisClient, connInfo.id);
  }

  if (routeKey === 'ping') {
    await sendMessageToClient(redisClient, connInfo, { message: 'PONG' });
  }

  await closeRedisClient(redisClient);
  await closeDbConnection(mysql);
};
