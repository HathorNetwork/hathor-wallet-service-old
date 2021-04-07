/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  APIGatewayProxyHandler,
  APIGatewayTokenAuthorizerHandler,
} from "aws-lambda";
import Joi from "joi";
import jwt from "jsonwebtoken";
import bitcoreLib from "bitcore-lib";
import Message from "bitcore-message";
import { getDbConnection } from "@src/utils";
import { closeDbAndGetError } from "@src/api/utils";
import { ApiError } from "@src/api/errors";

const EXPIRATION_TIME_IN_SECONDS = 15 * 60; // 15 minutes
const MAX_TIMESTAMP_SHIFT_IN_SECONDS = 30; // timestamp should not be out of this range

const mysql = getDbConnection();

const bodySchema = Joi.object({
  timestamp: Joi.number().required(),
  xpubkey: Joi.string().required(),
  signature: Joi.string().required(),
});

/**
 * Verify a signature for a given timestamp and xpubkey
 *
 * @param sginature - The signature done by the xpriv derivated on the path m/1/1
 * @param xpubkey - The xpubkey
 * @param timestamp - Unix Timestamp of the signature
 * @returns true if the timestamp, the xpubkey and signature matches
 */
export const verifySignature = (
  signature: string,
  xpubkey: string,
  timestamp: number
): boolean => {
  const message = String(timestamp).concat(xpubkey);
  const derivedXpubkey = new bitcoreLib.HDPublicKey(xpubkey).derive("m/1/1");
  const address = derivedXpubkey.publicKey.toAddress().toString();
  return new Message(message).verify(address, signature);
};

export const login: APIGatewayProxyHandler = async (event) => {
  const eventBody = (function parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  })(event.body);

  const { value, error } = bodySchema.validate(eventBody, {
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

  const { signature, timestamp, xpubkey } = value;

  const timestampShiftInSeconds = Math.abs(
    Math.floor(Date.now() / 1000) - timestamp
  );
  if (timestampShiftInSeconds >= MAX_TIMESTAMP_SHIFT_IN_SECONDS) {
    const details = {
      message: `The timestamp is shifted ${timestampShiftInSeconds} seconds from now. It should not be shifted more than ${MAX_TIMESTAMP_SHIFT_IN_SECONDS} seconds.`,
    };

    return closeDbAndGetError(mysql, ApiError.INVALID_SIGNATURE, { details });
  }

  if (!verifySignature(signature, xpubkey, timestamp)) {
    const details = {
      message: `The signature ${signature} does not match with the xpubkey ${xpubkey} and the timestamp ${timestamp}`,
    };

    return closeDbAndGetError(mysql, ApiError.INVALID_SIGNATURE, { details });
  }

  const token = jwt.sign(
    {
      xpubkey,
      timestamp,
      signature,
    },
    process.env.AUTH_SECRET,
    { expiresIn: EXPIRATION_TIME_IN_SECONDS }
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, token }),
  };
};

const generatePolicy = (event, effect) => ({
  principalId: "user",
  policyDocument: {
    Version: "2012-10-17",
    Statement: [
      {
        Action: "execute-api:Invoke",
        Effect: effect,
        Resource: event.methodArn,
      },
    ],
  },
});

export const authorizer: APIGatewayTokenAuthorizerHandler = async (event) => {
  const { authorizationToken } = event;
  const sanitizedToken = authorizationToken.replace(/Bearer /gi, "");
  const { signature, xpubkey, timestamp } = jwt.verify(
    sanitizedToken,
    process.env.AUTH_SECRET
  ) as any;

  const verified = verifySignature(signature, xpubkey, timestamp);
  const secondsPassed = Math.floor(Date.now() / 1000) - timestamp;

  if (verified && secondsPassed <= EXPIRATION_TIME_IN_SECONDS) {
    return generatePolicy(event, "Allow");
  }

  return generatePolicy(event, "Deny");
};
