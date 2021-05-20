/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// import AWS from 'aws-sdk';

import { APIGatewayProxyHandler } from 'aws-lambda';
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
  // addresses: Joi.array()
  //   .items(Joi.string()),
  wallets: Joi.array()
    .items(Joi.string())
    .required(),
  payload: Joi.object().required(),
});

const disconnectSchema = Joi.object({
  // addresses: Joi.array()
  //   .items(Joi.string()),
  wallets: Joi.array()
    .items(Joi.string())
    .required(),
});

const validateAdminToken = (authHeader: string): boolean => {
  const sanitizedToken = authHeader.replace(/Bearer /gi, '');
  return sanitizedToken === process.env.ADMINTOKEN;
};

export const broadcast: APIGatewayProxyHandler = async (event) => {
  if (process.env.IS_OFFLINE) {
    console.log(event); // eslint-disable-line no-console
  }

  const authHeader = event.headers && event.headers.Authorization;
  if (!(authHeader && validateAdminToken(authHeader))) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        success: false,
        error: ApiError.FORBIDDEN,
      }),
    };
  }

  const payload = parseBody(event.body);
  if (!payload) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_BODY,
      }),
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
  return { statusCode: 200, body: JSON.stringify({ message: 'ok' }) };
};

export const multicast: APIGatewayProxyHandler = async (event) => {
  const authHeader = event.headers && event.headers.Authorization;
  if (!(authHeader && validateAdminToken(authHeader))) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        success: false,
        error: ApiError.FORBIDDEN,
      }),
    };
  }

  const body = parseBody(event.body);
  const { value, error } = multicastSchema.validate(body, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_BODY,
        details,
      }),
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

  // maybe Promise.all().then(() => return)?
  await Promise.all(proms);
  await closeRedisClient(redisClient);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'sent' }),
  };
};

// maybe allow disconnecting a single connection by id and not all wallet connections
export const disconnect: APIGatewayProxyHandler = async (event) => {
  const authHeader = event.headers && event.headers.Authorization;
  if (!(authHeader && validateAdminToken(authHeader))) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        success: false,
        error: ApiError.FORBIDDEN,
      }),
    };
  }

  const body = parseBody(event.body);
  const { value, error } = disconnectSchema.validate(body, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_BODY,
        details,
      }),
    };
  }

  const wallets = value.wallets;

  // for each wallet, get connections and send payload to each connection of each wallet
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

  // maybe Promise.all().then(() => return)?
  await Promise.all(proms);
  await closeRedisClient(redisClient);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'sent' }),
  };
};
