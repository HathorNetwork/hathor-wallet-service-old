import { Lambda } from 'aws-sdk';
import { SendNotificationToDevice } from '@src/types';
import { initializeApp, messaging } from 'firebase-admin';
import { MulticastMessage } from 'firebase-admin/messaging';

const SEND_NOTIFICATION_LAMBDA_ENDPOINT = process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT;
const SEND_NOTIFICATION_FUNCTION_NAME = `hathor-wallet-service-${process.env.STAGE}-sendNotificationToDevice`;

initializeApp();

export class PushNotificationUtils {
  public static async sendToFcm(_notification: SendNotificationToDevice): Promise<{ success: boolean, errorMessage?: string }> {
    const message: MulticastMessage = {
      tokens: [_notification.deviceId],
      notification: {
        title: _notification.title,
        body: _notification.description,
      },
      data: _notification.metadata,
    };
    const multicastResult = await messaging().sendMulticast(message);

    if (multicastResult.failureCount === 0) {
      return { success: true };
    }

    const { 0: { error } } = multicastResult.responses;
    if (/unregistered/.test(error?.code || '')) {
      return { success: false, errorMessage: 'invalid-device-id' };
    }

    return { success: false, errorMessage: 'unknown' };
  }

  /**
   * Invokes this application's own intermediary lambda `PushSendNotificationToDevice`.
   */
  static async invokeSendNotificationHandlerLambda(notification: SendNotificationToDevice): Promise<void> {
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
