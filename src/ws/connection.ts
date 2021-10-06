/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  connectionInfoFromEvent,
  sendMessageToClient,
  DEFAULT_API_GATEWAY_RESPONSE,
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
): Promise<APIGatewayProxyResult> => {
  const redisClient = getRedisClient();
  const routeKey = event.requestContext.routeKey;
  // info needed to send response to client
  const connInfo = connectionInfoFromEvent(event);

  if (routeKey === '$connect') {
    await initWsConnection(redisClient, connInfo);
  }

  if (routeKey === '$disconnect') {
    await endWsConnection(redisClient, connInfo.id);
  }

  if (routeKey === 'ping') {
    await sendMessageToClient(redisClient, connInfo, { type: 'pong' });
  }

  await closeRedisClient(redisClient);
  await closeDbConnection(mysql);

  return DEFAULT_API_GATEWAY_RESPONSE;
};
