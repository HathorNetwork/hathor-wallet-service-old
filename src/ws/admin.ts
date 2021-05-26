/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Handler } from 'aws-lambda';
import Joi from 'joi';

import { ApiError } from '@src/api/errors';
import {
  sendMessageToClient,
  disconnectClient,
} from '@src/ws/utils';

import {
  getRedisClient,
  closeRedisClient,
  wsGetConnection,
  wsGetAllConnections,
  wsGetWalletConnections,
} from '@src/redis';

const parseBody = (body: string) => {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
};

const multicastSchema = Joi.object({
  wallets: Joi.array()
    .items(Joi.string())
    .required(),
  payload: Joi.object().required(),
});

const disconnectSchema = Joi.object({
  connections: Joi.array()
    .items(Joi.string())
    .required(),
});

export const broadcast: Handler = async (event) => {
  const payload = parseBody(event.body);
  if (!payload) {
    return {
      success: false,
      message: ApiError.INVALID_BODY,
    };
  }

  const redisClient = getRedisClient();
  const connections = await wsGetAllConnections(redisClient);
  await Promise.all(connections.map((connInfo) => (
    sendMessageToClient(redisClient, connInfo, payload)
  )));
  await closeRedisClient(redisClient);
  return {
    success: true,
    message: 'ok',
  };
};

export const multicast: Handler = async (event) => {
  const body = parseBody(event.body);
  const { value, error } = multicastSchema.validate(body, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    return {
      success: false,
      message: ApiError.INVALID_BODY,
    };
  }

  const wallets = value.wallets;
  const payload = value.payload;

  const redisClient = getRedisClient();

  // for each wallet, get connections and send payload to each connection of each wallet
  await Promise.all(wallets.map((walletId) => (
    wsGetWalletConnections(redisClient, walletId).then((connections) => (
      Promise.all(connections.map((connInfo) => (
        sendMessageToClient(redisClient, connInfo, payload)
      )))
    ))
  )));
  await closeRedisClient(redisClient);
  return {
    success: true,
    message: 'ok',
  };
};

export const disconnect: Handler = async (event) => {
  const { value, error } = disconnectSchema.validate(event, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    return {
      success: false,
      message: ApiError.INVALID_BODY,
    };
  }

  const connectionIds = value.connections;

  const redisClient = getRedisClient();
  await Promise.all(connectionIds.map((connId) => (
    wsGetConnection(redisClient, connId).then((connURL) => disconnectClient(redisClient, { id: connId, url: connURL }))
  )));
  await closeRedisClient(redisClient);
  return {
    success: true,
    message: 'ok',
  };
};
