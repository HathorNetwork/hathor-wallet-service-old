/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import {
  getTotalSupply,
} from '@src/db';
import { closeDbAndGetError } from '@src/api/utils';
import { closeDbConnection, getDbConnection } from '@src/utils';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import hathorLib from '@hathor/wallet-lib';
import Joi from 'joi';

const htrToken = hathorLib.constants.HATHOR_TOKEN_CONFIG.uid;
const mysql = getDbConnection();
const paramsSchema = Joi.object({
  tokenId: Joi.string()
    .alphanum()
    .default(htrToken)
    .optional(),
});

/*
 * Gets the calculated sum of utxos on the database, excluding the burned ones
 *
 * @remarks
 * This is a lambda function that should be invoked using the aws-sdk.
 */
export const onTotalSupplyRequest: APIGatewayProxyHandler = middy(async (event) => {
  const { value, error } = paramsSchema.validate(event.body, {
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

  const tokenId = value.tokenId;
  const totalSupply: number = await getTotalSupply(mysql, tokenId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      totalSupply,
    }),
  };
}).use(cors());
