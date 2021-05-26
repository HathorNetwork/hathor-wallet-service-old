/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import { RedisClient } from 'redis';
import Joi from 'joi';

import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  connectionInfoFromEvent,
  sendMessageToClient,
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
): Promise<void> => {
  const redisClient = getRedisClient();
  const routeKey = event.requestContext.routeKey;
  const connInfo = connectionInfoFromEvent(event);

  if (routeKey === 'join') {
    await joinWallet(event, connInfo, mysql, redisClient);
  }

  await closeDbConnection(mysql);
  await closeRedisClient(redisClient);
};

const joinWallet = async (
  event: APIGatewayProxyEvent,
  connInfo: WsConnectionInfo,
  _mysql: ServerlessMysql,
  _client: RedisClient,
): Promise<void> => {
  // parse body and extract wallet
  const body = parseBody(event.body);
  const { value, error } = joinSchema.validate(body, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    await sendMessageToClient(_client, connInfo, {
      success: false,
      message: 'Invalid parameters',
    });
    return;
  }

  const walletId = value.id;

  // validate walletID
  // verify ownership of wallet
  const wallet = await getWallet(_mysql, walletId);
  if (wallet === null) {
    // wallet does not exist, but should we return an error?
    await sendMessageToClient(_client, connInfo, {
      success: false,
      message: 'Invalid parameters',
    });
    return;
  }

  await wsJoinWallet(_client, connInfo, walletId);
  await sendMessageToClient(_client, connInfo, {
    success: true,
    message: 'Listening',
    id: walletId,
  });
};
