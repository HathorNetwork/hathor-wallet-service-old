/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// import AWS from 'aws-sdk';

import { APIGatewayProxyEvent } from 'aws-lambda';
// import { APIGatewayProxyHandler } from 'aws-lambda';
import { connectionUrlFromEvent, sendMessageToClient } from '@src/ws/utils';
import {
  initWsConnection,
  endWsConnection,
} from '@src/redis';

export const connect = async (
  event: APIGatewayProxyEvent,
): Promise<{statusCode: number}> => {
  const routeKey = event.requestContext.routeKey;
  // info needed to send response to client
  const connectionId = event.requestContext.connectionId;
  const url = connectionUrlFromEvent(connectionId, event);
  initWsConnection(connectionId, url);

  if (routeKey === '$connect') {
    // wsJoinWallet
    // join wallet separate from initWsConnection?
  }

  if (routeKey === '$disconnect') {
    // remove connection from connPool
    await endWsConnection(connectionId);
  }

  if (routeKey === 'ping') {
    await sendMessageToClient(url, connectionId, { message: 'PONG' });
  }

  if (routeKey === '$default') {
    // echo event back to client for dev
    await sendMessageToClient(url, connectionId, event);
  }

  return { statusCode: 200 };
};
