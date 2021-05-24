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
): Promise<void> => {
  const redisClient = getRedisClient();
  const routeKey = event.requestContext.routeKey;
  const connInfo = connectionInfoFromEvent(event);

  if (routeKey === 'join') {
    await joinChannel(event, connInfo, redisClient);
  }

  if (routeKey === 'joinWallet') {
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
  const { value, error } = joinWalletSchema.validate(body, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    await sendMessageToClient(connInfo, _client, {
      error: true,
      message: 'Invalid parameters',
    });
    return;
  }

  const walletId = value.wallet;

  // validate walletID
  // verify ownership of wallet
  const wallet = getWallet(_mysql, walletId);
  if (wallet === null) {
    // wallet does not exist, but should we return an error?
    await sendMessageToClient(connInfo, _client, {
      error: true,
      message: 'Invalid parameters',
    });
    return;
  }

  await wsJoinWallet(_client, connInfo, walletId);
  await sendMessageToClient(connInfo, _client, {
    message: `listening on events for ${walletId}`,
  });
};

const joinChannel = async (
  event: APIGatewayProxyEvent,
  connInfo: WsConnectionInfo,
  _client: RedisClient,
): Promise<void> => {
  const body = parseBody(event.body);
  const { value, error } = joinSchema.validate(body, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    // extract better error msg?
    await sendMessageToClient(connInfo, _client, {
      error: true,
      message: 'Invalid parameters',
    });
    return;
  }

  const channel = value.channel;

  // TODO: validate channel
  // Protected prefixes: 'wallet-'
  const protectedPrefixes = ['wallet-'];
  for (const prefix of protectedPrefixes) {
    if (channel.startsWith(prefix)) {
      await sendMessageToClient(connInfo, _client, {
        error: true,
        message: 'Invalid parameters',
      });
      return;
    }
  }

  await wsJoinChannel(_client, connInfo, body.channel);
  await sendMessageToClient(connInfo, _client, {
    message: `joined channel ${body.channel}`,
  });
};
