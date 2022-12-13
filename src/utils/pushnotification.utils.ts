import { Lambda } from 'aws-sdk';
import { SendNotificationToDevice, StringMap, WalletBalanceValue } from '@src/types';
import { credential, initializeApp, messaging, ServiceAccount } from 'firebase-admin';
import { MulticastMessage } from 'firebase-admin/messaging';
import createDefaultLogger from '@src/logger';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const serviceAccount = require('@src/utils/fcm.config.json');

const logger = createDefaultLogger();

if (!serviceAccount) {
  logger.error('[ALERT] serviceAccount was not loaded. Make sure the file src/utils/fcm.config.json is included in the build output.');
}

if (!process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT) {
  logger.error('[ALERT] env.SEND_NOTIFICATION_LAMBDA_ENDPOINT can not be null or undefined.');
}

if (!process.env.STAGE) {
  logger.error('[ALERT] env.STAGE can not be null or undefined.');
}

if (!process.env.FIREBASE_PROJECT_ID) {
  logger.error('[ALERT] env.FIREBASE_PROJECT_ID can not be null or undefined.');
}

export function buildFunctionName(functionName: string): string {
  return `hathor-wallet-service-${process.env.STAGE}-${functionName}`;
}

export enum FunctionName {
  SEND_NOTIFICATION_TO_DEVICE = 'sendNotificationToDevice',
  ON_TX_PUSH_NOTIFICATION_REQUESTED = 'onTxPushNotificationRequested',
}

const STAGE = process.env.STAGE;
const SEND_NOTIFICATION_LAMBDA_ENDPOINT = process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const ON_TX_PUSH_NOTIFICATION_REQUESTED_LAMBDA_ENDPOINT = process.env.ON_TX_PUSH_NOTIFICATION_REQUESTED_LAMBDA_ENDPOINT;
const SEND_NOTIFICATION_FUNCTION_NAME = buildFunctionName(FunctionName.SEND_NOTIFICATION_TO_DEVICE);
const ON_TX_PUSH_NOTIFICATION_REQUESTED_FUNCTION_NAME = buildFunctionName(FunctionName.ON_TX_PUSH_NOTIFICATION_REQUESTED);

initializeApp({
  credential: credential.cert(serviceAccount as ServiceAccount),
  projectId: FIREBASE_PROJECT_ID,
});

export enum PushNotificationError {
  UNKNOWN = 'unknown',
  INVALID_DEVICE_ID = 'invalid-device-id',
}

export class PushNotificationUtils {
  public static async sendToFcm(notification: SendNotificationToDevice): Promise<{ success: boolean, errorMessage?: string }> {
    const message: MulticastMessage = {
      tokens: [notification.deviceId],
      data: notification.metadata,
      android: {
        /**
         * When the application is in background the OS treat data messages as low priority by default.
         * We can change priority to 'high' to attempt deliver the message as soon as possible,
         * however FCM can adapt the delivery of the message over time in response to user engagement.
         *
         * @remarks
         * On iOS we can change the priority with the following code.
         *
         * @code
         * {
         *    ...android,
         *    apns: {
         *      payload: { aps: { contentAvailable: true } },
         *    },
         * }
         */
        priority: 'high',
      },
    };
    const multicastResult = await messaging().sendMulticast(message);

    if (multicastResult.failureCount === 0) {
      return { success: true };
    }

    const { 0: { error } } = multicastResult.responses;
    if (/token-not-registered/.test(error?.code || '')) {
      return { success: false, errorMessage: PushNotificationError.INVALID_DEVICE_ID };
    }

    logger.error('[ALERT] Error while calling sendMulticast(message) of Firebase Cloud Message.', { error });
    return { success: false, errorMessage: PushNotificationError.UNKNOWN };
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

  /**
   * Invokes this application's own intermediary lambda `OnTxPushNotificationRequestedLambda`.
   * @param walletBalanceValueMap - a map of walletId linked to its wallet balance data.
   */
  static async invokeOnTxPushNotificationRequestedLambda(walletBalanceValueMap: StringMap<WalletBalanceValue>): Promise<void> {
    const lambda = new Lambda({
      apiVersion: '2015-03-31',
      endpoint: ON_TX_PUSH_NOTIFICATION_REQUESTED_LAMBDA_ENDPOINT,
    });

    const params = {
      FunctionName: ON_TX_PUSH_NOTIFICATION_REQUESTED_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: JSON.stringify(walletBalanceValueMap),
    };

    const response = await lambda.invoke(params).promise();

    // Event InvocationType returns 202 for a successful invokation
    const walletIdList = Object.keys(walletBalanceValueMap);
    if (response.StatusCode !== 202) {
      throw new Error(`${ON_TX_PUSH_NOTIFICATION_REQUESTED_FUNCTION_NAME} lambda invoke failed for wallets: ${walletIdList}`);
    }
  }
}
