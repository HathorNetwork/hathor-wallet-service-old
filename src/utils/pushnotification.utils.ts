import { Lambda } from 'aws-sdk';
import { SendNotificationToDevice } from '@src/types';
import createDefaultLogger from '@src/logger';

const logger = createDefaultLogger();

if (!process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT) {
  logger.error('[ALERT] env.SEND_NOTIFICATION_LAMBDA_ENDPOINT can not be null or undefined.');
}

if (!process.env.STAGE) {
  logger.error('[ALERT] env.STAGE can not be null or undefined.');
}

const SEND_NOTIFICATION_LAMBDA_ENDPOINT = process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT;
const STAGE = process.env.STAGE;
const SEND_NOTIFICATION_FUNCTION_NAME = `hathor-wallet-service-${STAGE}-sendNotificationToDevice`;

export enum PushNotificationError {
  INVALID_DEVICE_ID = 'invalid-device-id',
  UNKNOWN = 'unknown',
}

export class PushNotificationUtils {
  static sendToFcm(_notification: SendNotificationToDevice): Promise<{ success: boolean, errorMessage?: string }> {
    // NOTE: yet to be implemented
    return Promise.resolve({ success: true });
  }

  /**
   * Invokes this application's own intermediary lambda `PushSendNotificationToDevice`.
   */
  static async invokeSendNotificationHandlerLambda(notification: SendNotificationToDevice): Promise<void> {
    if (!SEND_NOTIFICATION_LAMBDA_ENDPOINT && !STAGE) {
      throw new Error('Environment variables SEND_NOTIFICATION_LAMBDA_ENDPOINT and STAGE are not set.');
    }

    const lambda = new Lambda({
      apiVersion: '2015-03-31',
      endpoint: SEND_NOTIFICATION_LAMBDA_ENDPOINT,
    });

    const params = {
      FunctionName: SEND_NOTIFICATION_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: JSON.stringify(notification),
    };

    const response = await lambda.invoke(params).promise();

    // Event InvocationType returns 202 for a successful invokation
    if (response.StatusCode !== 202) {
      throw new Error(`${SEND_NOTIFICATION_FUNCTION_NAME} lambda invoke failed for device: ${notification.deviceId}`);
    }
  }
}
