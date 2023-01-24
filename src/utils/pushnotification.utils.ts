import { Lambda } from 'aws-sdk';
import { PushProvider, SendNotificationToDevice, StringMap, WalletBalanceValue } from '@src/types';
import fcmAdmin, { credential, messaging, ServiceAccount } from 'firebase-admin';
import { MulticastMessage } from 'firebase-admin/messaging';
import createDefaultLogger from '@src/logger';

const logger = createDefaultLogger();

if (!process.env.WALLET_SERVICE_LAMBDA_ENDPOINT) {
  logger.error('[ALERT] env.WALLET_SERVICE_LAMBDA_ENDPOINT can not be null or undefined.');
}

if (!process.env.STAGE) {
  logger.error('[ALERT] env.STAGE can not be null or undefined.');
}

if (!process.env.FIREBASE_PROJECT_ID) {
  logger.error('[ALERT] env.FIREBASE_PROJECT_ID can not be null or undefined.');
}

if (!process.env.FIREBASE_PRIVATE_KEY_ID) {
  logger.error('[ALERT] env.FIREBASE_PRIVATE_KEY_ID can not be null or undefined.');
}

if (!process.env.FIREBASE_PRIVATE_KEY) {
  logger.error('[ALERT] env.FIREBASE_PRIVATE_KEY can not be null or undefined.');
}

if (!process.env.FIREBASE_CLIENT_EMAIL) {
  logger.error('[ALERT] env.FIREBASE_CLIENT_EMAIL can not be null or undefined.');
}

if (!process.env.FIREBASE_CLIENT_ID) {
  logger.error('[ALERT] env.FIREBASE_CLIENT_ID can not be null or undefined.');
}

if (!process.env.FIREBASE_AUTH_URI) {
  logger.error('[ALERT] env.FIREBASE_AUTH_URI can not be null or undefined.');
}

if (!process.env.FIREBASE_TOKEN_URI) {
  logger.error('[ALERT] env.FIREBASE_TOKEN_URI can not be null or undefined.');
}

if (!process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL) {
  logger.error('[ALERT] env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL can not be null or undefined.');
}

if (!process.env.FIREBASE_CLIENT_X509_CERT_URL) {
  logger.error('[ALERT] env.FIREBASE_CLIENT_X509_CERT_URL can not be null or undefined.');
}

if (!process.env.PUSH_ALLOWED_PROVIDERS) {
  logger.error('[ALERT] env.PUSH_ALLOWED_PROVIDERS can not be null or undefined.');
}

export function buildFunctionName(functionName: string): string {
  return `hathor-wallet-service-${process.env.STAGE}-${functionName}`;
}

export enum FunctionName {
  SEND_NOTIFICATION_TO_DEVICE = 'sendNotificationToDevice',
  ON_TX_PUSH_NOTIFICATION_REQUESTED = 'txPushRequested',
}

const STAGE = process.env.STAGE;
const WALLET_SERVICE_LAMBDA_ENDPOINT = process.env.WALLET_SERVICE_LAMBDA_ENDPOINT;
const SEND_NOTIFICATION_FUNCTION_NAME = buildFunctionName(FunctionName.SEND_NOTIFICATION_TO_DEVICE);
const ON_TX_PUSH_NOTIFICATION_REQUESTED_FUNCTION_NAME = buildFunctionName(FunctionName.ON_TX_PUSH_NOTIFICATION_REQUESTED);
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY_ID = process.env.FIREBASE_PRIVATE_KEY_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_CLIENT_ID = process.env.FIREBASE_CLIENT_ID;
const FIREBASE_AUTH_URI = process.env.FIREBASE_AUTH_URI;
const FIREBASE_TOKEN_URI = process.env.FIREBASE_TOKEN_URI;
const FIREBASE_AUTH_PROVIDER_X509_CERT_URL = process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL;
const FIREBASE_CLIENT_X509_CERT_URL = process.env.FIREBASE_CLIENT_X509_CERT_URL;
/** Local feature toggle that disable the push notification by default */
const PUSH_NOTIFICATION_ENABLED = process.env.PUSH_NOTIFICATION_ENABLED;
const PUSH_ALLOWED_PROVIDERS = (() => {
  const providers = process.env.PUSH_ALLOWED_PROVIDERS;
  if (!providers) {
    // If no providers are set, we allow android by default, but alert the environment variable is empty
    logger.error('[ALERT] env.PUSH_ALLOWED_PROVIDERS is empty.');
    return [PushProvider.ANDROID];
  }
  return providers.split(',');
})();

export const isPushProviderAllowed = (provider: string): boolean => PUSH_ALLOWED_PROVIDERS.includes(provider);

export const isPushNotificationEnabled = (): boolean => PUSH_NOTIFICATION_ENABLED === 'true';

const serviceAccount = {
  type: 'service_account',
  project_id: FIREBASE_PROJECT_ID,
  private_key_id: FIREBASE_PRIVATE_KEY_ID,
  private_key: FIREBASE_PRIVATE_KEY,
  client_email: FIREBASE_CLIENT_EMAIL,
  client_id: FIREBASE_CLIENT_ID,
  auth_uri: FIREBASE_AUTH_URI,
  token_uri: FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: FIREBASE_CLIENT_X509_CERT_URL,
};

let isFirebaseInitialized = false;
if (isPushNotificationEnabled()) {
  try {
    fcmAdmin.initializeApp({
      credential: credential.cert(serviceAccount as ServiceAccount),
      projectId: FIREBASE_PROJECT_ID,
    });
    isFirebaseInitialized = true;
  } catch (error) {
    logger.error(`Error initializing Firebase Admin SDK. ErrorMessage: ${error.message}`, error);
  }
}

export enum PushNotificationError {
  UNKNOWN = 'unknown',
  INVALID_DEVICE_ID = 'invalid-device-id',
}

export class PushNotificationUtils {
  public static async sendToFcm(notification: SendNotificationToDevice): Promise<{ success: boolean, errorMessage?: string }> {
    if (!isFirebaseInitialized) {
      return { success: false, errorMessage: 'Firebase not initialized.' };
    }

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
    if (!WALLET_SERVICE_LAMBDA_ENDPOINT && !STAGE) {
      throw new Error('Environment variables WALLET_SERVICE_LAMBDA_ENDPOINT and STAGE are not set.');
    }

    const lambda = new Lambda({
      apiVersion: '2015-03-31',
      endpoint: WALLET_SERVICE_LAMBDA_ENDPOINT,
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
    if (!isPushNotificationEnabled()) {
      logger.debug('Push notification is disabled. Skipping invocation of OnTxPushNotificationRequestedLambda lambda.');
      return;
    }

    const lambda = new Lambda({
      apiVersion: '2015-03-31',
      endpoint: WALLET_SERVICE_LAMBDA_ENDPOINT,
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
