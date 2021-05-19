/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// import AWS from 'aws-sdk';

import { APIGatewayProxyEvent } from 'aws-lambda';
// import { APIGatewayProxyHandler } from 'aws-lambda';

import {
  connectionInfoFromEvent,
  sendAndReturn,
} from '@src/ws/utils';
import {
  getRedisClient,
  closeRedisClient,
  initWsConnection,
  endWsConnection,
} from '@src/redis';

export const connect = async (
  event: APIGatewayProxyEvent,
): Promise<{statusCode: number}> => {
  if (process.env.IS_OFFLINE === 'true') {
    console.log(event); // eslint-disable-line no-console
  }
  const redisClient = getRedisClient();
  const routeKey = event.requestContext.routeKey;
  // info needed to send response to client
  const connInfo = connectionInfoFromEvent(event);

  if (routeKey === '$connect') {
    // disconnect client if trying to connect to no wallet
    // if ((!event.queryStringParameters) || (!event.queryStringParameters.wallet)) {
    //   await disconnectClient(url, connectionId);
    //   return { statusCode: 401 };
    // }
    // const walletID = event.queryStringParameters.wallet
    // await initWsConnection(connectionId, url).then(() => wsJoinWallet(walletID, connectionId));
    await initWsConnection(redisClient, connInfo);
    await closeRedisClient(redisClient);
    return { statusCode: 200 };
  }

  if (routeKey === '$disconnect') {
    // remove connection from connPool
    await endWsConnection(redisClient, connInfo.id);
    await closeRedisClient(redisClient);
    return { statusCode: 200 };
  }

  if (routeKey === 'ping') {
    return sendAndReturn(connInfo, 200, { message: 'PONG' }, redisClient);
  }

  // if (routeKey === '$default') {
  //   // echo event back to client for dev
  //   return sendAndReturn(connInfo, 200, event, redisClient);
  // }

  return { statusCode: 200 };
};
