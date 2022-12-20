/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import { unregisterPushDevice } from '@src/db';
import { getDbConnection } from '@src/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi, { ValidationError } from 'joi';
import { PushDelete } from '@src/types';

const mysql = getDbConnection();

class PushUpdateUnregisterValidator {
  static readonly bodySchema = Joi.object({
    deviceId: Joi.string().max(256).required(),
  });

  static validate(payload: unknown): { value: PushDelete, error: ValidationError } {
    return PushUpdateUnregisterValidator.bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    }) as { value: PushDelete, error: ValidationError };
  }
}

/*
 * Unregister a device to receive push notification.
 *
 * This lambda is called by API Gateway on DELETE /push/unregister
 */
export const unregister: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const { value: body, error } = PushUpdateUnregisterValidator.validate(event.pathParameters);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  await unregisterPushDevice(mysql, body.deviceId, walletId);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}))
  .use(cors());
