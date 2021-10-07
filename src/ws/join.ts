/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import { RedisClient } from 'redis';
import Joi from 'joi';

import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  connectionInfoFromEvent,
  sendMessageToClient,
  DEFAULT_API_GATEWAY_RESPONSE,
} from '@src/ws/utils';
import {
  getRedisClient,
  closeRedisClient,
  wsJoinWallet,
} from '@src/redis';
import { WsConnectionInfo } from '@src/types';
import { getWallet } from '@src/db';

const mysql = getDbConnection();

const joinSchema = Joi.object({
  action: Joi.string()
    .required(),
  id: Joi.string()
    .required(),
});

const parseBody = (body: string) => {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
};

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const redisClient = getRedisClient();
  const connInfo = connectionInfoFromEvent(event);

  await joinWallet(event, connInfo, mysql, redisClient);
  await closeDbConnection(mysql);
  await closeRedisClient(redisClient);

  // Since this is served by ApiGateway, we need to return a APIGatewayProxyResult
  return DEFAULT_API_GATEWAY_RESPONSE;
};

const joinWallet = async (
  event: APIGatewayProxyEvent,
  connInfo: WsConnectionInfo,
  _mysql: ServerlessMysql,
  _client: RedisClient,
): Promise<APIGatewayProxyResult> => {
  // parse body and extract wallet
  const body = parseBody(event.body);
  const { value, error } = joinSchema.validate(body, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    await sendMessageToClient(_client, connInfo, {
      type: 'error',
      message: 'Invalid parameters',
    });
    return DEFAULT_API_GATEWAY_RESPONSE;
  }

  // TODO: Verify ownership of the wallet upon subscription.
  // How: Do not pass walletId directly, use jwt token (same as the api bearer token)
  // and validate the token, then use the walletId inside the token.
  const walletId = value.id;

  const wallet = await getWallet(_mysql, walletId);
  if (wallet === null) {
    // wallet does not exist, but should we return an error?
    await sendMessageToClient(_client, connInfo, {
      type: 'error',
      message: 'Invalid parameters',
    });
    return DEFAULT_API_GATEWAY_RESPONSE;
  }

  await wsJoinWallet(_client, connInfo, walletId);
  await sendMessageToClient(_client, connInfo, {
    type: 'join-success',
    message: 'Listening',
    id: walletId,
  });

  return DEFAULT_API_GATEWAY_RESPONSE;
};
