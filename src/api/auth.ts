/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  APIGatewayProxyHandler,
  APIGatewayTokenAuthorizerHandler,
  CustomAuthorizerResult,
  PolicyDocument,
  Statement,
} from 'aws-lambda';
import { v4 as uuid4 } from 'uuid';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { ApiError } from '@src/api/errors';
import { Wallet } from '@src/types';
import { getWallet } from '@src/db';
import {
  verifySignature,
  getAddressFromXpub,
  closeDbConnection,
  getDbConnection,
  validateAuthTimestamp,
  AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS,
} from '@src/utils';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import createDefaultLogger from '@src/logger';
import { Logger } from 'winston';

const EXPIRATION_TIME_IN_SECONDS = 1800;

const bodySchema = Joi.object({
  ts: Joi.number().positive().required(),
  xpub: Joi.string().required(),
  sign: Joi.string().required(),
  walletId: Joi.string().required(),
});

function parseBody(body) {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

const mysql = getDbConnection();

export const tokenHandler: APIGatewayProxyHandler = middy(async (event) => {
  const eventBody = parseBody(event.body);

  const { value, error } = bodySchema.validate(eventBody, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    await closeDbConnection(mysql);

    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_PAYLOAD,
        details,
      }),
    };
  }

  const signature = value.sign;
  const timestamp = value.ts;
  const authXpubStr = value.xpub;
  const wallet: Wallet = await getWallet(mysql, value.walletId);

  const [validTimestamp, timestampShift] = validateAuthTimestamp(timestamp, Date.now() / 1000);

  if (!validTimestamp) {
    const details = [{
      message: `The timestamp is shifted ${timestampShift}(s). Limit is ${AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS}(s).`,
    }];

    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.AUTH_INVALID_SIGNATURE,
        details,
      }),
    };
  }

  if (wallet.authXpubkey !== authXpubStr) {
    const details = [{
      message: 'Provided auth_xpubkey does not match the stored auth_xpubkey',
    }];

    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_PAYLOAD,
        details,
      }),
    };
  }

  const address = getAddressFromXpub(authXpubStr);
  const walletId = wallet.walletId;

  if (!verifySignature(signature, timestamp, address, walletId)) {
    await closeDbConnection(mysql);

    const details = {
      message: `The signature ${signature} does not match with the auth xpubkey ${authXpubStr} and the timestamp ${timestamp}`,
    };

    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.AUTH_INVALID_SIGNATURE,
        details,
      }),
    };
  }

  // To understand the other options to the sign method: https://github.com/auth0/node-jsonwebtoken#readme
  const token = jwt.sign(
    {
      sign: signature,
      ts: timestamp,
      addr: address.toString(),
      wid: walletId,
    },
    process.env.AUTH_SECRET,
    {
      expiresIn: EXPIRATION_TIME_IN_SECONDS,
      jwtid: uuid4(),
    },
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, token }),
  };
}).use(cors());

/**
 * Generates a aws policy document to allow/deny access to the resource
 */
const _generatePolicy = (principalId: string, effect: string, resource: string, logger: Logger) => {
  const resourcePrefix = `${resource.split('/').slice(0, 2).join('/')}/*`;
  const policyDocument: PolicyDocument = {
    Version: '2012-10-17',
    Statement: [],
  };

  const statementOne: Statement = {
    Action: 'execute-api:Invoke',
    Effect: effect,
    Resource: [
      `${resourcePrefix}/wallet/*`,
      `${resourcePrefix}/tx/*`,
    ],
  };

  policyDocument.Statement[0] = statementOne;

  const authResponse: CustomAuthorizerResult = {
    policyDocument,
    principalId,
  };

  const context = { walletId: principalId };
  authResponse.context = context;

  // XXX: to get the resulting policy on the logs, since we can't check the cached policy
  logger.info('Generated policy:', authResponse);
  return authResponse;
};

export const bearerAuthorizer: APIGatewayTokenAuthorizerHandler = middy(async (event) => {
  const logger = createDefaultLogger();
  const { authorizationToken } = event;
  if (!authorizationToken) {
    throw new Error('Unauthorized'); // returns a 401
  }
  const sanitizedToken = authorizationToken.replace(/Bearer /gi, '');
  let data;

  try {
    data = jwt.verify(
      sanitizedToken,
      process.env.AUTH_SECRET,
    );
  } catch (e) {
    // XXX: find a way to return specific error to frontend or make all errors Unauthorized?
    //
    // Identify exception from jsonwebtoken by the name property
    // https://github.com/auth0/node-jsonwebtoken/blob/master/lib/TokenExpiredError.js#L5
    if (e.name === 'JsonWebTokenError') {
      throw new Error('Unauthorized');
    } else if (e.name === 'TokenExpiredError') {
      throw new Error('Unauthorized');
    } else {
      logger.warn('Error on bearerAuthorizer: ', e);
      throw e;
    }
  }

  // signature data
  const signature = data.sign;
  const timestamp = data.ts;
  const address = data.addr;
  const walletId = data.wid;

  // header data
  const expirationTs = data.exp;
  const verified = verifySignature(signature, timestamp, address, walletId);

  if (verified && Math.floor(Date.now() / 1000) <= expirationTs) {
    return _generatePolicy(walletId, 'Allow', event.methodArn, logger);
  }

  return _generatePolicy(walletId, 'Deny', event.methodArn, logger);
}).use(cors());
