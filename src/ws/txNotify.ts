/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { SQSHandler } from 'aws-lambda';
import { RedisClient } from 'redis';
import Joi from 'joi';

import { sendMessageToClient } from '@src/ws/utils';
import {
  wsGetWalletConnections,
  getRedisClient,
  closeRedisClient,
} from '@src/redis';

const parseBody = (body: string) => {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
};

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

export const onNewTx: SQSHandler = async (event) => {
  const redisClient = getRedisClient();
  const promises = [];

  for (const evt of event.Records) {
    const body = parseBody(evt.body);
    const { value, error } = newTxbodySchema.validate(body, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      // invalid event bodies will noop
      // maybe log errors
      continue;
    }

    const wallets = value.wallets;
    const tx = value.tx;
    promises.push(Promise.all(wallets.map((wallet) => notifyWallet(redisClient, wallet, tx))));
  }
  await Promise.all(promises);
  await closeRedisClient(redisClient);
};

export const onUpdateTx: SQSHandler = async (event) => {
  const redisClient = getRedisClient();
  const promises = [];

  for (const evt of event.Records) {
    const body = parseBody(evt.body);
    const { value, error } = updateTxbodySchema.validate(body, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      // invalid event bodies will noop
      // maybe log errors
      continue;
    }

    const wallets = value.wallets;
    const updateBody = value.update;
    promises.push(Promise.all(wallets.map((wallet) => notifyWallet(redisClient, wallet, updateBody))));
  }
  // await all messages from all events to be sent
  await Promise.all(promises);
  await closeRedisClient(redisClient);
};

const notifyWallet = async (
  client: RedisClient,
  walletID: string,
  payload: any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<void[]> => {
  const connections = await wsGetWalletConnections(client, walletID);
  const proms = [];
  connections.forEach((connInfo) => {
    proms.push(sendMessageToClient(connInfo, client, payload));
  });
  return Promise.all(proms);
};
