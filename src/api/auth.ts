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
import {
  getWalletId,
} from '@src/utils';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import bitcore from 'bitcore-lib';
import { ApiError } from '@src/api/errors';
import hathorLib from '@hathor/wallet-lib';

const EXPIRATION_TIME_IN_SECONDS = 30 * 60;
const MAX_TIMESTAMP_SHIFT_IN_SECONDS = 30;

hathorLib.network.setNetwork(process.env.NETWORK);

const bodySchema = Joi.object({
  ts: Joi.number().positive().required(),
  xpub: Joi.string().required(),
  sign: Joi.string().required(),
});

function parseBody(body) {
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

/**
 * Verify a signature for a given timestamp and xpubkey
 *
 * @param signature - The signature done by the xpriv of the wallet
 * @param timestamp - Unix Timestamp of the signature
 * @param address - The address of the xpubkey used to create the walletId
 * @param walletId - The walletId, a sha512d of the xpubkey
 * @returns true if the signature matches the other params
 */
export const verifySignature = (
  signature: string,
  timestamp: number,
  address: bitcore.Address,
  walletId: string,
): boolean => {
  const message = String(timestamp).concat(walletId).concat(address);
  return new bitcore.Message(message).verify(address, signature);
};

export const tokenHandler: APIGatewayProxyHandler = async (event) => {
  const eventBody = parseBody(event.body);

  const { value, error } = bodySchema.validate(eventBody, {
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
        error: ApiError.INVALID_PAYLOAD,
        details,
      }),
    };
  }

  const signature = value.sign;
  const timestamp = value.ts;
  const xpubkeyStr = value.xpub;

  const timestampShiftInSeconds = Math.abs(
    Math.floor(Date.now() / 1000) - timestamp,
  );
  if (timestampShiftInSeconds >= MAX_TIMESTAMP_SHIFT_IN_SECONDS) {
    const details = [{
      message: `The timestamp is shifted ${timestampShiftInSeconds}(s). Limit is ${MAX_TIMESTAMP_SHIFT_IN_SECONDS}(s).`,
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

  const xpubkey = bitcore.HDPublicKey(xpubkeyStr);
  const address = xpubkey.publicKey.toAddress(hathorLib.network.getNetwork());
  const walletId = getWalletId(xpubkeyStr);

  if (!verifySignature(signature, timestamp, address, walletId.toString())) {
    const details = {
      message: `The signature ${signature} does not match with the xpubkey ${xpubkeyStr} and the timestamp ${timestamp}`,
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
};

/**
 * Generates a aws policy document to allow/deny access to the resource
 */
const _generatePolicy = (principalId: string, effect: string, resource: string) => {
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
  console.info('Generated policy:', authResponse);
  return authResponse;
};

export const bearerAuthorizer: APIGatewayTokenAuthorizerHandler = async (event) => {
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
      console.log('Error on bearerAuthorizer: ', e);
      throw e;
    }
  }
  // signature data
  const signature = data.sign;
  const timestamp = data.ts;
  const addr = data.addr;
  const walletId = data.wid;

  // header data
  const expirationTs = data.exp;

  const address = new bitcore.Address(addr, hathorLib.network.getNetwork());
  const verified = verifySignature(signature, timestamp, address, walletId);

  if (verified && Math.floor(Date.now() / 1000) <= expirationTs) {
    return _generatePolicy(walletId, 'Allow', event.methodArn);
  }

  return _generatePolicy(walletId, 'Deny', event.methodArn);
};
