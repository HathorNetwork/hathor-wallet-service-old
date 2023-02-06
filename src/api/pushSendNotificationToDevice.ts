/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Handler } from 'aws-lambda';
import { closeDbConnection, getDbConnection } from '@src/utils';
import Joi, { ValidationError } from 'joi';
import { Severity, SendNotificationToDevice } from '@src/types';
import { getPushDevice, unregisterPushDevice } from '@src/db';
import createDefaultLogger from '@src/logger';
import { isPushProviderAllowed, PushNotificationUtils, PushNotificationError } from '@src/utils/pushnotification.utils';
import { addAlert } from '@src/utils/alerting.utils';

const mysql = getDbConnection();

class PushSendNotificationToDeviceInputValidator {
  static readonly bodySchema = Joi.object({
    deviceId: Joi.string().max(256).required(),
    metadata: Joi.object({
      txId: Joi.string().required(),
      titleLocKey: Joi.string().required(),
      bodyLocKey: Joi.string().required(),
      bodyLocArgs: Joi.string().optional(),
    }).required(),
  }).required();

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
export const send: Handler<unknown, { success: boolean, message?: string, details?: unknown }> = async (event, context) => {
  const logger = createDefaultLogger();
  // Logs the request id on every line, so we can see all logs from a request
  logger.defaultMeta = {
    requestId: context.awsRequestId,
  };

  const { value: body, error } = PushSendNotificationToDeviceInputValidator.validate(event);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    closeDbConnection(mysql);
    logger.error('Invalid payload.', { details });
    return { success: false, message: 'Failed due to invalid payload, see details.', details };
  }

  const pushDevice = await getPushDevice(mysql, body.deviceId);

  if (!pushDevice) {
    closeDbConnection(mysql);
    await addAlert(
      'Device not found while trying to send notification',
      '-',
      Severity.MINOR,
      { deviceId: body.deviceId },
    );
    logger.error('Device not found.', {
      deviceId: body.deviceId,
    });
    return { success: false, message: 'Failed due to device not found.' };
  }

  if (!isPushProviderAllowed(pushDevice.pushProvider)) {
    closeDbConnection(mysql);
    await addAlert(
      'Invalid provider error while sending push notification',
      '-',
      Severity.MINOR,
      { deviceId: body.deviceId, pushProvider: pushDevice.pushProvider },
    );
    logger.error('Provider invalid.', {
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
