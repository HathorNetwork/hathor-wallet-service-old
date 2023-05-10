import { Lambda } from 'aws-sdk';
import { PushProvider, Severity, SendNotificationToDevice, StringMap, WalletBalanceValue } from '@src/types';
import fcmAdmin, { credential, messaging, ServiceAccount } from 'firebase-admin';
import { MulticastMessage } from 'firebase-admin/messaging';
import createDefaultLogger from '@src/logger';
import { assertEnvVariablesExistence } from '@src/utils';
import { addAlert } from '@src/utils/alerting.utils';

const logger = createDefaultLogger();

try {
  assertEnvVariablesExistence([
    'WALLET_SERVICE_LAMBDA_ENDPOINT',
    'STAGE',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_CLIENT_ID',
    'FIREBASE_AUTH_URI',
    'FIREBASE_TOKEN_URI',
    'FIREBASE_AUTH_PROVIDER_X509_CERT_URL',
    'FIREBASE_CLIENT_X509_CERT_URL',
  ]);
} catch (e) {
  logger.error(e);

  addAlert(
    'Lambda missing env variables',
    e.message, // This should contain the list of env variables that are missing
    Severity.MINOR,
  );
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
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_CLIENT_ID = process.env.FIREBASE_CLIENT_ID;
const FIREBASE_AUTH_URI = process.env.FIREBASE_AUTH_URI;
const FIREBASE_TOKEN_URI = process.env.FIREBASE_TOKEN_URI;
const FIREBASE_AUTH_PROVIDER_X509_CERT_URL = process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL;
const FIREBASE_CLIENT_X509_CERT_URL = process.env.FIREBASE_CLIENT_X509_CERT_URL;
const FIREBASE_PRIVATE_KEY = (() => {
  try {
    /**
     * To fix the error 'Error: Invalid PEM formatted message.',
     * when initializing the firebase admin app, we need to replace
     * the escaped line break with an unescaped line break.
     * https://github.com/gladly-team/next-firebase-auth/discussions/95#discussioncomment-2891225
     */
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    return privateKey
      ? privateKey.replace(/\\n/gm, '\n')
      : null;
  } catch (error) {
    logger.error('[ALERT] Error while parsing the env.FIREBASE_PRIVATE_KEY.');
    return null;
  }
})();

/** Local feature toggle that disable the push notification by default */
const PUSH_NOTIFICATION_ENABLED = process.env.PUSH_NOTIFICATION_ENABLED;
/**
 * Controls which providers are allowed to send notification when it is enabled
 * @example
 * PUSH_ALLOWED_PROVIDERS=android,ios
 * @remarks
 * In the test this constant works like the environment variable constants.
 * It needs to be reloaded after changing the underlying environment variable
 * `process.env.PUSH_ALLOWED_PROVIDERS`.
 *
 * @example Reload the constant by reloading the module:
 * ```ts
 // reload module
 const { PushNotificationUtils } = await import('@src/utils/pushnotification.utils');
 * ```
 * */
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

let firebaseInitialized = false;
if (isPushNotificationEnabled()) {
  try {
    fcmAdmin.initializeApp({
      credential: credential.cert(serviceAccount as ServiceAccount),
      projectId: FIREBASE_PROJECT_ID,
    });
    firebaseInitialized = true;
  } catch (error) {
    logger.error(`Error initializing Firebase Admin SDK. ErrorMessage: ${error.message}`, error);
  }
}

export const isFirebaseInitialized = (): boolean => firebaseInitialized;

export enum PushNotificationError {
  UNKNOWN = 'unknown',
  INVALID_DEVICE_ID = 'invalid-device-id',
}

export class PushNotificationUtils {
  public static async sendToFcm(notification: SendNotificationToDevice): Promise<{ success: boolean, errorMessage?: string }> {
    if (!isFirebaseInitialized()) {
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
      apns: {
        headers: {
          /**
           * FCM requires priority 5 for data message, other priority is reject with error.
           * See https://firebase.google.com/docs/cloud-messaging/concept-options#setting-the-priority-of-a-message
           *
           */
          'apns-priority': '5',
        },
        payload: {
          /**
           * Background notification flag.
           * It is labeled as low priority and may not be delivered by the platform.
           * It is subject to severe throttling.
           *
           * See Push Background:
           * https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server/pushing_background_updates_to_your_app#overview
           *
           * See Payload key reference:
           * https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server/generating_a_remote_notification#2943360
           */
          aps: {
            'content-available': 1,
          },
        },
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

    await addAlert(
      'Error on PushNotificationUtils',
      'Error while calling sendMulticast(message) of Firebase Cloud Message.',
      Severity.MAJOR,
      { error },
    );
    logger.error('Error while calling sendMulticast(message) of Firebase Cloud Message.', { error });
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
      await addAlert(
        'Error on PushNotificationUtils',
        `${SEND_NOTIFICATION_FUNCTION_NAME} lambda invoke failed for device: ${notification.deviceId}`,
        Severity.MINOR,
        { DeviceId: notification.deviceId },
      );
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
      await addAlert(
        'Error on PushNotificationUtils',
        `${ON_TX_PUSH_NOTIFICATION_REQUESTED_FUNCTION_NAME} lambda invoke failed for wallets`,
        Severity.MINOR,
        { Wallets: walletIdList },
      );
      throw new Error(`${ON_TX_PUSH_NOTIFICATION_REQUESTED_FUNCTION_NAME} lambda invoke failed for wallets: ${walletIdList}`);
    }
  }
}
