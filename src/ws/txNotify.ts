/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { SQSHandler } from 'aws-lambda';
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

    const payload = {
      type: 'new-tx',
      data: tx,
    };

    // This will create a promise that for each walletId on wallets it will search for all open connections
    // and for each connection send the payload (the JSON representation of the tx) using sendMessageToClient
    promises.push(
      Promise.all(wallets.map((walletId) => (
        wsGetWalletConnections(redisClient, walletId).then((connections) => (
          Promise.all(connections.map((connInfo) => (
            sendMessageToClient(redisClient, connInfo, payload)
          )))
        ))
      ))),
    );
  }
  // Wait all messages from all events to be sent
  await Promise.all(promises);
  // And close the redisClient
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
    const payload = {
      type: 'update-tx',
      data: updateBody,
    };

    // Same logic as onNewTx, but sending `updateBody` as payload
    promises.push(
      Promise.all(wallets.map((walletId) => (
        wsGetWalletConnections(redisClient, walletId).then((connections) => (
          Promise.all(connections.map((connInfo) => (
            sendMessageToClient(redisClient, connInfo, payload)
          )))
        ))
      ))),
    );
  }
  // Wait all messages from all events to be sent
  await Promise.all(promises);
  await closeRedisClient(redisClient);
};
