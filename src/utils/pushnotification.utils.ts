import { Lambda } from 'aws-sdk';
import { SendNotificationToDevice } from '@src/types';

const SEND_NOTIFICATION_LAMBDA_ENDPOINT = process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT;
const SEND_NOTIFICATION_FUNCTION_NAME = `hathor-wallet-service-${process.env.STAGE}-sendNotificationToDevice`;

export class PushNotificationUtils {
  static sendToFcm(_notification: SendNotificationToDevice): Promise<void> {
    return Promise.race([]);
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
