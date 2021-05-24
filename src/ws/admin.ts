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
  wallets: Joi.array()
    .items(Joi.string())
    .required(),
});

export const broadcast: Handler = async (event) => {
  if (process.env.IS_OFFLINE) {
    console.log(event); // eslint-disable-line no-console
  }

  const payload = parseBody(event.body);
  if (!payload) {
    return {
      success: false,
      message: ApiError.INVALID_BODY,
    };
  }

  const redisClient = getRedisClient();
  const connections = await wsGetAllConnections(redisClient);
  const proms = [];
  connections.forEach((connInfo) => {
    proms.push(sendMessageToClient(connInfo, redisClient, payload));
  });
  await Promise.all(proms);
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

  // for each wallet, get connections and send payload to each connection of each wallet
  const redisClient = getRedisClient();
  const proms = [];
  for (const walletId of wallets) {
    proms.push(wsGetWalletConnections(redisClient, walletId).then((connections) => {
      const p = [];
      connections.forEach((connInfo) => {
        p.push(sendMessageToClient(connInfo, redisClient, payload));
      });
      return Promise.all(p);
    }));
  }

  await Promise.all(proms);
  await closeRedisClient(redisClient);
  return {
    success: true,
    message: 'ok',
  };
};

// maybe allow disconnecting a single connection by id and not all wallet connections
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

  const wallets = value.wallets;

  // for each wallet, get connections and disconnect each one
  const redisClient = getRedisClient();
  const proms = [];
  for (const walletId of wallets) {
    proms.push(wsGetWalletConnections(redisClient, walletId).then((connections) => {
      const p = [];
      connections.forEach((connInfo) => {
        p.push(disconnectClient(connInfo, redisClient));
      });
      return Promise.all(p);
    }));
  }
  await Promise.all(proms);
  await closeRedisClient(redisClient);
  return {
    success: true,
    message: 'ok',
  };
};
