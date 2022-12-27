/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, warmupMiddleware, pushProviderRegexPattern } from '@src/api/utils';
import { removeAllPushDevicesByDeviceId, registerPushDevice, existsWallet } from '@src/db';
import { getDbConnection } from '@src/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi, { ValidationError } from 'joi';
import { PushRegister } from '@src/types';

const mysql = getDbConnection();

class PushRegisterInputValidator {
  static readonly bodySchema = Joi.object({
    pushProvider: Joi.string().pattern(pushProviderRegexPattern()).required(),
    deviceId: Joi.string().max(256).required(),
    enablePush: Joi.boolean().default(false).optional(),
    enableShowAmounts: Joi.boolean().default(false).optional(),
  });

  static validate(payload: unknown): { value: PushRegister, error: ValidationError } {
    return PushRegisterInputValidator.bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    }) as { value: PushRegister, error: ValidationError };
  }
}

/*
 * Register a device to receive push notification.
 *
 * This lambda is called by API Gateway on POST /push/register
 */
export const register: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const eventBody = (function parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }(event.body));

  const { value: body, error } = PushRegisterInputValidator.validate(eventBody);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const walletExists = await existsWallet(mysql, walletId);
  if (!walletExists) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  await removeAllPushDevicesByDeviceId(mysql, body.deviceId);

  await registerPushDevice(mysql, {
    walletId,
    deviceId: body.deviceId,
    pushProvider: body.pushProvider,
    enablePush: body.enablePush,
    enableShowAmounts: body.enableShowAmounts,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}))
  .use(cors())
  .use(warmupMiddleware());
