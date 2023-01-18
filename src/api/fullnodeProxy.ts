/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import { APIGatewayProxyHandler } from 'aws-lambda';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi from 'joi';

import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, validateParams } from '@src/api/utils';
import { walletIdProxyHandler } from '@src/commons';
import fullnode from '@src/fullnode';
import {
  closeDbConnection,
  getDbConnection,
} from '@src/utils';
import {
  GraphvizParams,
  GetConfirmationDataParams,
  GetTxByIdParams,
  ParamValidationResult,
} from '@src/types';

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
  const validationResult: ParamValidationResult<GetTxByIdParams> = validateParams(txIdValidator, params);

  if (validationResult.error) {
    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, {
      details: validationResult.details,
    });
  }

  const { txId } = validationResult.value;
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
  const validationResult: ParamValidationResult<GetConfirmationDataParams> = validateParams(txIdValidator, params);

  if (validationResult.error) {
    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, {
      details: validationResult.details,
    });
  }

  const { txId } = validationResult.value;
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
 * This lambda is called by API Gateway on GET /wallet/proxy/graphviz/neighbours
 */
export const queryGraphvizNeighbours: APIGatewayProxyHandler = middy(
  walletIdProxyHandler(async (_walletId: string, event) => {
    const params = event.queryStringParameters || {};
    const validationResult: ParamValidationResult<GraphvizParams> = validateParams<GraphvizParams>(graphvizValidator, params, {
      abortEarly: false,
      // Since we receive params as queryString,
      // we want Joi to convert maxLevel from string to number
      convert: true,
    });

    if (validationResult.error) {
      return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, {
        details: validationResult.details,
      });
    }

    const {
      txId,
      graphType,
      maxLevel,
    } = validationResult.value;

    const graphVizData = await fullnode.queryGraphvizNeighbours(txId, graphType, maxLevel);

    await closeDbConnection(mysql);

    return {
      statusCode: 200,
      body: JSON.stringify(graphVizData),
    };
  }),
).use(cors());
