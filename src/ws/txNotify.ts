/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { RedisClient } from 'redis';
import Joi from 'joi';

import { sendMessageToClient } from '@src/ws/utils';
import {
  wsGetWalletConnections,
  getRedisClient,
  closeRedisClient,
} from '@src/redis';

const newTxbodySchema = Joi.object({
  wallets: Joi.array()
    .items(Joi.string())
    .min(1)
    .required(),
  tx: Joi.object().required(),
});

const updateTxbodySchema = Joi.object({
  wallets: Joi.array()
    .items(Joi.string())
    .min(1)
    .required(),
  update: Joi.object({
    tx_id: Joi.string().required(),
    is_voided: Joi.boolean(),
  })
    .required(),
});

// const parseBody = (body: string) => {
//   try {
//     return JSON.parse(body);
//   } catch (e) {
//     return null;
//   }
// };

export const onNewTx = async (
  event: SQSEvent,
): Promise<APIGatewayProxyResult> => {
  // const eventBody = parseBody(event.body);
  const redisClient = getRedisClient();

  for (const evt of event.Records) {
    const { value, error } = newTxbodySchema.validate(evt.body, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      // extract error message
      await closeRedisClient(redisClient);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: true, message: 'error' }),
      };
    }

    const wallets = value.wallets;
    const tx = value.tx;
    await Promise.all(wallets.map((wallet) => notifyWallet(redisClient, wallet, tx)));
  }

  await closeRedisClient(redisClient);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Sent notifications' }),
  };
};

export const onUpdateTx = async (
  event: SQSEvent,
): Promise<APIGatewayProxyResult> => {
  // const eventBody = parseBody(event.body);
  const redisClient = getRedisClient();

  for (const evt of event.Records) {
    const { value, error } = updateTxbodySchema.validate(evt.body, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      // extract error message
      await closeRedisClient(redisClient);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: true, message: 'error' }),
      };
    }

    const wallets = value.wallets;
    const updateBody = value.update;
    await Promise.all(wallets.map((wallet) => notifyWallet(redisClient, wallet, updateBody)));
  }
  await closeRedisClient(redisClient);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Sent notifications' }),
  };
};

const notifyWallet = async (
  client: RedisClient,
  walletID: string,
  payload: any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const connections = await wsGetWalletConnections(client, walletID);
  const proms = [];
  connections.forEach((connInfo) => {
    proms.push(sendMessageToClient(connInfo, payload));
  });
  return Promise.all(proms);
};
