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
  initWsConnection,
  endWsConnection,
  wsJoinWallet,
  wsJoinChannel,
} from '@src/redis';
import { WsConnectionInfo } from '@src/types';

const parseBody = (body: string) => {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
};

export const connect = async (
  event: APIGatewayProxyEvent,
): Promise<{statusCode: number}> => {
  if (process.env.IS_OFFLINE === 'true') {
    console.log(event); // eslint-disable-line no-console
  }
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
    await initWsConnection(connInfo);
    return { statusCode: 200 };
  }

  if (routeKey === '$disconnect') {
    // remove connection from connPool
    await endWsConnection(connInfo.id);
    return { statusCode: 200 };
  }

  if (routeKey === 'ping') {
    return sendAndReturn(connInfo, 200, { message: 'PONG' });
  }

  if (routeKey === 'join') {
    return joinChannel(event, connInfo);
  }

  if (routeKey === 'joinWallet') {
    return joinWallet(event, connInfo);
  }

  if (routeKey === '$default') {
    // echo event back to client for dev
    return sendAndReturn(connInfo, 200, event);
  }

  return { statusCode: 200 };
};

const joinChannel = async (
  event: APIGatewayProxyEvent,
  connInfo: WsConnectionInfo,
): Promise<{statusCode: number}> => {
  // parse body and extract channel
  const body = parseBody(event.body);
  if (!body.channel) {
    return sendAndReturn(connInfo, 400, {
      error: true,
      message: 'No channel to connect',
    });
  }

  // validate channel
  if (body.channel.startsWith('wallet-')) {
    return sendAndReturn(connInfo, 400, {
      error: true,
      message: 'Invalid channel',
    });
  }

  await wsJoinChannel(body.channel, connInfo.id);
  return { statusCode: 200 };
};

const joinWallet = async (
  event: APIGatewayProxyEvent,
  connInfo: WsConnectionInfo,
): Promise<{statusCode: number}> => {
  // parse body and extract wallet
  const body = parseBody(event.body);
  if (!body.wallet) {
    return sendAndReturn(connInfo, 400, {
      error: true,
      message: 'No wallet to join',
    });
  }

  // validate walletID
  // verify ownership of wallet

  await wsJoinWallet(body.wallet, connInfo.id);
  return { statusCode: 200 };
};
