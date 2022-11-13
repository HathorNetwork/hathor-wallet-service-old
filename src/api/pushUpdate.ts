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
import Joi from 'joi';
import { PushUpdate } from '@src/types';

const mysql = getDbConnection();

const bodySchema = Joi.object({
  deviceId: Joi.string().max(256).required(),
  enablePush: Joi.boolean().optional(),
  enableShowAmounts: Joi.boolean().optional(),
});

/*
 * Update a device to receive push notification.
 *
 * This lambda is called by API Gateway on POST /push/register
 */
export const update: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  const { value, error } = bodySchema.validate(event.body, {
    abortEarly: false, // We want it to return all the errors not only the first
    convert: true, // We need to convert as parameters are sent on the QueryString
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const body: PushUpdate = value;

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
  .use(cors())
  .use(warmupMiddleware());
