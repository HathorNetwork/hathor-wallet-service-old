/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
// import { APIGatewayProxyHandler } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import { RedisClient } from 'redis';
import Joi from 'joi';

import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  connectionInfoFromEvent,
  sendAndReturn,
} from '@src/ws/utils';
import {
  getRedisClient,
  closeRedisClient,
  wsJoinWallet,
  wsJoinChannel,
} from '@src/redis';
import { WsConnectionInfo } from '@src/types';
import { getWallet } from '@src/db';

const mysql = getDbConnection();

const joinWalletSchema = Joi.object({
  action: Joi.string()
    .required(),
  wallet: Joi.string()
    .required(),
});

const joinSchema = Joi.object({
  action: Joi.string()
    .required(),
  channel: Joi.string()
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
): Promise<{statusCode: number}> => {
  const redisClient = getRedisClient();
  const routeKey = event.requestContext.routeKey;
  const connInfo = connectionInfoFromEvent(event);

  if (routeKey === 'join') {
    await closeDbConnection(mysql);
    return joinChannel(event, connInfo, redisClient);
  }

  if (routeKey === 'joinWallet') {
    return joinWallet(event, connInfo, mysql, redisClient);
  }

  await closeDbConnection(mysql);
  await closeRedisClient(redisClient);
  return { statusCode: 200 };
};

const joinWallet = async (
  event: APIGatewayProxyEvent,
  connInfo: WsConnectionInfo,
  _mysql: ServerlessMysql,
  _client: RedisClient,
): Promise<{statusCode: number}> => {
  // parse body and extract wallet
  const body = parseBody(event.body);
  const { value, error } = joinWalletSchema.validate(body, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    // extract better error msg?
    return sendAndReturn(connInfo, 400, {
      error: true,
      message: 'Invalid parameters',
    }, _client, _mysql);
  }

  const walletId = value.wallet;

  // validate walletID
  // verify ownership of wallet
  const wallet = getWallet(_mysql, walletId);
  if (wallet === null) {
    // wallet does not exist, but should we return an error?
    return sendAndReturn(connInfo, 400, {
      error: true,
      message: 'Invalid parameters',
    }, _client, _mysql);
  }

  await wsJoinWallet(_client, connInfo, walletId);
  return sendAndReturn(connInfo, 200, {
    message: `listening on events for ${walletId}`,
  }, _client, _mysql);
};

const joinChannel = async (
  event: APIGatewayProxyEvent,
  connInfo: WsConnectionInfo,
  _client: RedisClient,
): Promise<{statusCode: number}> => {
  const body = parseBody(event.body);
  const { value, error } = joinSchema.validate(body, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    // extract better error msg?
    return sendAndReturn(connInfo, 400, {
      error: true,
      message: 'Invalid parameters',
    }, _client);
  }

  const channel = value.channel;

  // TODO: validate channel
  // Protected prefixes: 'wallet-'
  const protectedPrefixes = ['wallet-'];
  for (const prefix of protectedPrefixes) {
    if (channel.startsWith(prefix)) {
      return sendAndReturn(connInfo, 400, {
        error: true,
        message: 'Protected prefix',
      }, _client);
    }
  }

  await wsJoinChannel(_client, connInfo, body.channel);
  return sendAndReturn(connInfo, 200, {
    message: `joined channel ${body.channel}`,
  }, _client);
};
