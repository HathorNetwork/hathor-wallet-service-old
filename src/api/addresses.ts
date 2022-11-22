/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import Joi from 'joi';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, warmupMiddleware } from '@src/api/utils';
import {
  getWallet,
  getWalletAddresses,
} from '@src/db';
import { AddressInfo } from '@src/types';
import { closeDbConnection, getDbConnection } from '@src/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';

const mysql = getDbConnection();

const checkMineBodySchema = Joi.object({
  addresses: Joi.array()
    .items(Joi.string().regex(/^[A-HJ-NP-Za-km-z1-9]*$/).min(34).max(34))
    .min(1)
    .max(512) // max number of addresses in a tx (256 outputs and 256 inputs)
    .required(),
});

/*
 * Check if a list of addresses belong to the caller wallet
 *
 * This lambda is called by API Gateway on POST /addresses/check_mine
 */
export const checkMine: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const status = await getWallet(mysql, walletId);

  // If the wallet is not started or ready, we can skip the query on the address table
  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const eventBody = (function parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }(event.body));

  const { value, error } = checkMineBodySchema.validate(eventBody, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const sentAddresses = value.addresses;
  const dbWalletAddresses: AddressInfo[] = await getWalletAddresses(mysql, walletId, sentAddresses);
  const walletAddresses: Set<string> = dbWalletAddresses.reduce((acc, { address }) => acc.add(address), new Set([]));

  await closeDbConnection(mysql);

  const addressBelongMap = sentAddresses.reduce((acc: {string: boolean}, address: string) => {
    acc[address] = walletAddresses.has(address);

    return acc;
  }, {});

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      addresses: addressBelongMap,
    }),
  };
})).use(cors());

/*
 * Get the addresses of a wallet
 *
 * This lambda is called by API Gateway on GET /addresses
 */
export const get: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId) => {
  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const addresses = await getWalletAddresses(mysql, walletId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, addresses }),
  };
})).use(cors())
  .use(warmupMiddleware());
