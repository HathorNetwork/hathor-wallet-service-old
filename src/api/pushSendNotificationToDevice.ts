/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError, warmupMiddleware } from '@src/api/utils';
import { getDbConnection } from '@src/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi, { ValidationError } from 'joi';
import { SendNotificationToDevice } from '@src/types';

const mysql = getDbConnection();

class PushSendNotificationToDeviceInputValidator {
  static readonly bodySchema = Joi.object({
    deviceId: Joi.string().max(256).required(),
    title: Joi.string().required(),
    description: Joi.string().required(),
    metadata: Joi.object().optional(),
  });

  static validate(payload: unknown): { value: SendNotificationToDevice, error: ValidationError } {
    return PushSendNotificationToDeviceInputValidator.bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    });
  }
}

/*
 * Send a notification to the registered device given a wallet.
 *
 * This lambda is called by API Gateway on POST /push/register
 */
export const send: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const { value: body, error } = PushSendNotificationToDeviceInputValidator.validate(event.body);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  // TODO: get provider from push_devices

  // TODO: call sendToFCM

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}))
  .use(cors())
  .use(warmupMiddleware());
