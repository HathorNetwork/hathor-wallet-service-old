import { Lambda } from 'aws-sdk';
import { SendNotificationToDevice } from '@src/types';
import { credential, initializeApp, messaging, ServiceAccount } from 'firebase-admin';
import { MulticastMessage } from 'firebase-admin/messaging';
import serviceAccount from '@src/utils/fcm.config.json';

const SEND_NOTIFICATION_LAMBDA_ENDPOINT = process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT;
const SEND_NOTIFICATION_FUNCTION_NAME = `hathor-wallet-service-${process.env.STAGE}-sendNotificationToDevice`;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

initializeApp({
  credential: credential.cert(serviceAccount as ServiceAccount),
  projectId: FIREBASE_PROJECT_ID,
});

export enum PushNotificationError {
  INVALID_DEVICE_ID = 'invalid-device-id',
  UNKNOWN = 'unknown',
}

export class PushNotificationUtils {
  public static async sendToFcm(notification: SendNotificationToDevice): Promise<{ success: boolean, errorMessage?: string }> {
    const message: MulticastMessage = {
      tokens: [notification.deviceId],
      notification: {
        title: notification.title,
        body: notification.description,
      },
      data: notification.metadata,
    };
    const multicastResult = await messaging().sendMulticast(message);

    if (multicastResult.failureCount === 0) {
      return { success: true };
    }

    const { 0: { error } } = multicastResult.responses;
    if (/token-not-registered/.test(error?.code || '')) {
      return { success: false, errorMessage: PushNotificationError.INVALID_DEVICE_ID };
    }

    return { success: false, errorMessage: PushNotificationError.UNKNOWN };
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
