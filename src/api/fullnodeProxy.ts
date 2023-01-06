/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import { walletIdProxyHandler } from '@src/commons';
import fullnode from '@src/fullnode';
import {
  closeDbConnection,
  getDbConnection,
} from '@src/utils';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi from 'joi';

const mysql = getDbConnection();

const txIdValidator = Joi.object({
  txId: Joi.string()
    .alphanum()
    .required(),
});

const graphvizValidator = Joi.object({
  txId: Joi.string()
    .alphanum()
    .required(),
  graphType: Joi.string()
    .alphanum()
    .required(),
  maxLevel: Joi.number()
    .required(),
});

/*
 * Get a transaction from the fullnode
 *
 * This lambda is called by API Gateway on GET /wallet/proxy/transactions/:id
 */
export const getTransactionById: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (_walletId: string, event) => {
  const params = event.pathParameters || {};

  const { value, error } = txIdValidator.validate(params, {
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

  const txId = value.txId;
  const transaction = await fullnode.downloadTx(txId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify(transaction),
  };
})).use(cors());

/*
 * Get confirmation data for a tx from the fullnode
 *
 * This lambda is called by API Gateway on GET /wallet/proxy/transactions/:id/confirmation_data
 */
export const getConfirmationData: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (_walletId: string, event) => {
  const params = event.pathParameters || {};

  const { value, error } = txIdValidator.validate(params, {
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

  const txId = value.txId;
  const confirmationData = await fullnode.getConfirmationData(txId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify(confirmationData),
  };
})).use(cors());

/*
 * Makes graphviz queries on the fullnode
 *
 * This lambda is called by API Gateway on GET /wallet/proxy/graphviz/neighbors
 */
export const queryGraphvizNeighbors: APIGatewayProxyHandler = middy(
  walletIdProxyHandler(async (_walletId: string, event) => {
    const params = event.queryStringParameters || {};

    const { value, error } = graphvizValidator.validate(params, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      const details = error.details.map((err) => ({
        message: err.message,
        path: err.path,
      }));

      return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
    }

    const { txId, graphType, maxLevel } = value;
    const graphVizData = await fullnode.queryGraphvizNeighbors(txId, graphType, maxLevel);

    await closeDbConnection(mysql);

    return {
      statusCode: 200,
      body: JSON.stringify(graphVizData),
    };
  }),
).use(cors());