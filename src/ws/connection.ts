/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  connectionInfoFromEvent,
  disconnectClient,
  sendMessageToClient,
} from '@src/ws/utils';
import {
  getRedisClient,
  closeRedisClient,
  initWsConnection,
  endWsConnection,
  wsJoinWallet,
} from '@src/redis';

// Route: @connect
export const connect = async (
  event: APIGatewayProxyEvent,
): Promise<void> => {
  const redisClient = getRedisClient();
  const connInfo = connectionInfoFromEvent(event);

  let walletId: string;
  try {
    if (!process.env.IS_OFFLINE) {
      walletId = event.requestContext.authorizer.principalId;
    } else {
      // serverless offline does not support websocket authorizers
      // https://github.com/dherault/serverless-offline/issues/951
      // For offline testing purposes get walletId from env
      walletId = process.env.DEV_WALLET_ID;
    }
  } catch (e) {
    console.log('WebSocket Connection Error:', e);
    // Does not have a walletId, forcefull disconnect
    // This shouldn't happen with the authorizer
    await disconnectClient(redisClient, connInfo);
    await closeRedisClient(redisClient);
    return;
  }

  // Init connection
  await initWsConnection(redisClient, connInfo);
  try {
    // attempt to join wallet
    await wsJoinWallet(redisClient, connInfo, walletId);
  } catch (ex) {
    // wallet limit exceeded, disconnect user
    await disconnectClient(redisClient, connInfo);
  } finally {
    await closeRedisClient(redisClient);
  }
};

// Route: $disconnect
export const disconnect = async (
  event: APIGatewayProxyEvent,
): Promise<void> => {
  const redisClient = getRedisClient();
  const connInfo = connectionInfoFromEvent(event);
  await endWsConnection(redisClient, connInfo.id);

  await closeRedisClient(redisClient);
};

// Route: ping
export const ping = async (
  event: APIGatewayProxyEvent,
): Promise<void> => {
  const redisClient = getRedisClient();
  const connInfo = connectionInfoFromEvent(event);
  await sendMessageToClient(redisClient, connInfo, { message: 'PONG' });

  await closeRedisClient(redisClient);
};
