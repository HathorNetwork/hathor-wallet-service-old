/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, warmupMiddleware } from '@src/api/utils';
import { existsPushDevice, updatePushDevice } from '@src/db';
import { getDbConnection } from '@src/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi, { ValidationError } from 'joi';
import { PushUpdate } from '@src/types';

const mysql = getDbConnection();

class PushUpdateInputValidator {
  static readonly bodySchema = Joi.object({
    deviceId: Joi.string().max(256).required(),
    enablePush: Joi.boolean().optional(),
    enableShowAmounts: Joi.boolean().optional(),
  });

  static validate(payload: unknown): { value: PushUpdate, error: ValidationError } {
    const { value, error } = PushUpdateInputValidator.bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    });
    return { value: { enablePush: false, enableShowAmounts: false, ...value }, error };
  }
}

/*
 * Update a device to receive push notification.
 *
 * This lambda is called by API Gateway on POST /push/register
 */
export const update: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const { value: body, error } = PushUpdateInputValidator.validate(event.body);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const deviceExists = await existsPushDevice(mysql, body.deviceId, walletId);
  if (!deviceExists) {
    return closeDbAndGetError(mysql, ApiError.DEVICE_NOT_FOUND);
  }

  await updatePushDevice(mysql, {
    walletId,
    deviceId: body.deviceId,
    enablePush: body.enablePush,
    enableShowAmounts: body.enableShowAmounts,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}))
  .use(cors());
