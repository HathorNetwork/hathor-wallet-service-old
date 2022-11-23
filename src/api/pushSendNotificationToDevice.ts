/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Handler } from 'aws-lambda';
import { closeDbConnection, getDbConnection } from '@src/utils';
import Joi, { ValidationError } from 'joi';
import { SendNotificationToDevice, PushProvider } from '@src/types';
import { getPushDevice } from '@src/db';
import createDefaultLogger from '@src/logger';
import { PushNotificationUtils, PushNotificationError } from '@src/utils/pushnotification.utils';
import { unregisterPushDevice } from '@src/db';

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
    }) as { value: SendNotificationToDevice, error: ValidationError };
  }
}

/*
 * Send a notification to the registered device given a wallet.
 *
 * This lambda is called by API Gateway on POST /push/register
 */
export const send: Handler<{ body: unknown }, { success: boolean, message?: string }> = async (event, context) => {
  const logger = createDefaultLogger();
  // Logs the request id on every line, so we can see all logs from a request
  logger.defaultMeta = {
    requestId: context.awsRequestId,
  };

  const { value: body, error } = PushSendNotificationToDeviceInputValidator.validate(event.body);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    closeDbConnection(mysql);
    logger.error('Invalid payload.', { details });
    return { success: false, message: `Failed due to invalid payload. See details: ${details}.` };
  }

  const pushDevice = await getPushDevice(mysql, body.deviceId);

  if (!pushDevice) {
    closeDbConnection(mysql);
    logger.error('[ALERT] Device not found.', {
      deviceId: body.deviceId,
    });
    return { success: false, message: 'Failed due to device not found.' };
  }

  if (pushDevice.pushProvider !== PushProvider.ANDROID) {
    closeDbConnection(mysql);
    logger.error('[ALERT] Provider invalid.', {
      deviceId: body.deviceId,
      pushProvider: pushDevice.pushProvider,
    });
    return { success: false, message: 'Failed due to invalid provider.' };
  }

  const result = await PushNotificationUtils.sendToFcm(body);
  if (result.errorMessage === PushNotificationError.INVALID_DEVICE_ID) {
    await unregisterPushDevice(mysql, body.deviceId);
    return { success: false, message: 'Failed due to invalid device id.' };
  }

  return {
    success: true,
  };
};
