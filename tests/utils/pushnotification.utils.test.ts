/* eslint-disable no-shadow */
/* eslint-disable @typescript-eslint/naming-convention */
// mocks should be imported first
import { mockedAddAlert } from '@tests/utils/alerting.utils.mock';
import { sendMulticastMock, messaging, initFirebaseAdminMock } from '@tests/utils/firebase-admin.mock';
import { invokeMock, promiseMock } from '@tests/utils/aws-sdk.mock';
import { logger } from '@tests/winston.mock';
import { PushNotificationUtils, PushNotificationError, buildFunctionName, FunctionName } from '@src/utils/pushnotification.utils';
import * as pushnotificationUtils from '@src/utils/pushnotification.utils';
import { SendNotificationToDevice, Severity } from '@src/types';
import { Lambda } from 'aws-sdk';
import { buildWalletBalanceValueMap } from '@tests/utils';

const isFirebaseInitializedMock = jest.spyOn(pushnotificationUtils, 'isFirebaseInitialized');

describe('PushNotificationUtils', () => {
  const initEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...initEnv,
      WALLET_SERVICE_LAMBDA_ENDPOINT: 'endpoint',
      STAGE: 'stage',
      ON_TX_PUSH_NOTIFICATION_REQUESTED_LAMBDA_ENDPOINT: 'endpoint',
      FIREBASE_PROJECT_ID: 'projectId',
      FIREBASE_PRIVATE_KEY_ID: 'private-key-id',
      FIREBASE_PRIVATE_KEY: 'private-key',
      FIREBASE_CLIENT_EMAIL: 'client-email',
      FIREBASE_CLIENT_ID: 'client-id',
      FIREBASE_AUTH_URI: 'https://accounts.google.com/o/oauth2/auth',
      FIREBASE_TOKEN_URI: 'https://oauth2.googleapis.com/token',
      FIREBASE_AUTH_PROVIDER_X509_CERT_URL: 'https://www.googleapis.com/oauth2/v1/certs',
      FIREBASE_CLIENT_X509_CERT_URL: 'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk.iam.gserviceaccount.com',
      PUSH_ALLOWED_PROVIDERS: 'android,ios',
    };
    initFirebaseAdminMock.mockReset();
    isFirebaseInitializedMock.mockReset();
    mockedAddAlert.mockReset();
    jest.resetModules();
  });

  afterEach(() => {
    process.env = initEnv;
  });

  // test firebase initialization error
  it('firebase initialization error', async () => {
    expect.hasAssertions();

    // load local env
    process.env.PUSH_NOTIFICATION_ENABLED = 'true';
    logger.error.mockReset();
    initFirebaseAdminMock.mockImplementation(() => {
      throw new Error('Failed to parse private key: Error: Invalid PEM formatted message.');
    });

    // reload module
    await import('@src/utils/pushnotification.utils');

    const resultMessageOfLastCallToLoggerError = logger.error.mock.calls[0][0];
    expect(resultMessageOfLastCallToLoggerError).toMatchInlineSnapshot('"Error initializing Firebase Admin SDK. ErrorMessage: Failed to parse private key: Error: Invalid PEM formatted message."');
  });

  describe('process.env', () => {
    it('WALLET_SERVICE_LAMBDA_ENDPOINT', async () => {
      expect.hasAssertions();

      // load local env
      process.env.WALLET_SERVICE_LAMBDA_ENDPOINT = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables WALLET_SERVICE_LAMBDA_ENDPOINT',
        Severity.MINOR,
      );
    });

    it('STAGE', async () => {
      expect.hasAssertions();

      // load local env
      process.env.STAGE = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables STAGE',
        Severity.MINOR,
      );
    });

    it('FIREBASE_PROJECT_ID', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_PROJECT_ID = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_PROJECT_ID',
        Severity.MINOR,
      );
    });

    it('FIREBASE_PRIVATE_KEY_ID', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_PRIVATE_KEY_ID = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_PRIVATE_KEY_ID',
        Severity.MINOR,
      );
    });

    it('FIREBASE_PRIVATE_KEY', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_PRIVATE_KEY = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_PRIVATE_KEY',
        Severity.MINOR,
      );
    });

    // generate test for every comment below
    it('FIREBASE_CLIENT_EMAIL', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_CLIENT_EMAIL = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_CLIENT_EMAIL',
        Severity.MINOR,
      );
    });

    // FIREBASE_CLIENT_ID: 'client-id',
    it('FIREBASE_CLIENT_ID', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_CLIENT_ID = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_CLIENT_ID',
        Severity.MINOR,
      );
    });

    // FIREBASE_AUTH_URI: 'https://accounts.google.com/o/oauth2/auth',
    it('FIREBASE_AUTH_URI', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_AUTH_URI = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_AUTH_URI',
        Severity.MINOR,
      );
    });

    // FIREBASE_TOKEN_URI: 'https://oauth2.googleapis.com/token',
    it('FIREBASE_TOKEN_URI', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_TOKEN_URI = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_TOKEN_URI',
        Severity.MINOR,
      );
    });

    // FIREBASE_AUTH_PROVIDER_X509_CERT_URL: 'https://www.googleapis.com/oauth2/v1/certs',
    it('FIREBASE_AUTH_PROVIDER_X509_CERT_URL', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_AUTH_PROVIDER_X509_CERT_URL',
        Severity.MINOR,
      );
    });

    // FIREBASE_CLIENT_X509_CERT_URL: 'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk.iam.gserviceaccount.com',
    it('FIREBASE_CLIENT_X509_CERT_URL', async () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_CLIENT_X509_CERT_URL = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Lambda missing env variables',
        'Env missing the following variables FIREBASE_CLIENT_X509_CERT_URL',
        Severity.MINOR,
      );
    });

    it('FIREBASE_PRIVATE_KEY-IIFE', async () => {
      expect.hasAssertions();

      // load local env
      // env variables are of type string, by assigning a boolean value we can test the error handling
      process.env.FIREBASE_PRIVATE_KEY = true as unknown as string;

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] Error while parsing the env.FIREBASE_PRIVATE_KEY.');
    });

    it('PUSH_ALLOWED_PROVIDERS', async () => {
      expect.hasAssertions();

      // load local env
      process.env.PUSH_ALLOWED_PROVIDERS = '';

      // reload module
      await import('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] env.PUSH_ALLOWED_PROVIDERS is empty.');
    });
  });

  describe('sendToFcm(notification)', () => {
    beforeEach(() => {
      sendMulticastMock.mockReset();
      messaging.mockImplementation(() => ({
        sendMulticast: sendMulticastMock.mockReturnValue({
          failureCount: 0,
        }),
      }));
    });

    it('should return success false when firebase is not initialized', async () => {
      expect.hasAssertions();

      isFirebaseInitializedMock.mockReturnValue(false);
      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;
      const result = await PushNotificationUtils.sendToFcm(notification);

      expect(result).toStrictEqual({ success: false, errorMessage: 'Firebase not initialized.' });
    });

    it('should return success true when succeed', async () => {
      expect.hasAssertions();

      isFirebaseInitializedMock.mockReturnValue(true);
      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;
      const result = await PushNotificationUtils.sendToFcm(notification);

      expect(result).toStrictEqual({ success: true });
    });

    it('should return success false when deviceId is invalid', async () => {
      expect.hasAssertions();

      isFirebaseInitializedMock.mockReturnValue(true);
      messaging.mockImplementation(() => ({
        sendMulticast: sendMulticastMock.mockReturnValue({
          responses: [
            {
              error: {
                code: 'token-not-registered',
              },
            },
          ],
          failureCount: 1,
        }),
      }));

      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;
      const result = await PushNotificationUtils.sendToFcm(notification);

      expect(result).toStrictEqual({ success: false, errorMessage: PushNotificationError.INVALID_DEVICE_ID });
    });

    it('should return success false with unknown error when failure is not treated', async () => {
      expect.hasAssertions();

      isFirebaseInitializedMock.mockReturnValue(true);
      messaging.mockImplementation(() => ({
        sendMulticast: sendMulticastMock.mockReturnValue({
          responses: [
            {
              error: {
                code: 'any-other-code',
              },
            },
          ],
          failureCount: 1,
        }),
      }));

      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;
      const result = await PushNotificationUtils.sendToFcm(notification);

      expect(result).toStrictEqual({ success: false, errorMessage: PushNotificationError.UNKNOWN });
      expect(logger.error).toHaveBeenLastCalledWith('Error while calling sendMulticast(message) of Firebase Cloud Message.', { error: { code: 'any-other-code' } });

      expect(mockedAddAlert).toHaveBeenLastCalledWith(
        'Error on PushNotificationUtils',
        'Error while calling sendMulticast(message) of Firebase Cloud Message.',
        Severity.MAJOR,
        { error: { code: 'any-other-code' } },
      );
    });
  });

  describe('invokeSendNotificationHandlerLambda(notification)', () => {
    beforeEach(() => {
      promiseMock.mockReset();
      // default mock return value
      promiseMock.mockReturnValue({
        StatusCode: 202,
      });
    });

    it('should call lambda with success', async () => {
      expect.hasAssertions();

      // load local env
      const fakeEndpoint = 'endpoint';
      process.env.WALLET_SERVICE_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = 'test';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = await import('@src/utils/pushnotification.utils');

      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;

      const result = await PushNotificationUtils.invokeSendNotificationHandlerLambda(notification);

      // a void method returns undefined
      expect(result).toBeUndefined();

      // assert Lambda constructor call
      expect(Lambda).toHaveBeenCalledTimes(1);
      expect(Lambda).toHaveBeenCalledWith({
        apiVersion: '2015-03-31',
        endpoint: fakeEndpoint,
      });

      // assert lambda invoke call
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith({
        FunctionName: `hathor-wallet-service-${fakeStage}-sendNotificationToDevice`,
        InvocationType: 'Event',
        Payload: JSON.stringify(notification),
      });
    });

    it('should throw error when lambda invokation fails', async () => {
      expect.hasAssertions();

      // load local env
      const fakeEndpoint = 'endpoint';
      process.env.WALLET_SERVICE_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = 'test';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = await import('@src/utils/pushnotification.utils');

      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;

      // simulate a failing lambda invokation
      promiseMock.mockReturnValue({
        StatusCode: 500,
      });

      await expect(PushNotificationUtils.invokeSendNotificationHandlerLambda(notification))
        .rejects.toThrow(`hathor-wallet-service-${fakeStage}-sendNotificationToDevice lambda invoke failed for device: ${notification.deviceId}`);
    });

    it('should throw error when env variables are not set', async () => {
      expect.hasAssertions();

      // load local env
      const fakeEndpoint = '';
      process.env.WALLET_SERVICE_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = '';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = await import('@src/utils/pushnotification.utils');

      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;

      await expect(PushNotificationUtils.invokeSendNotificationHandlerLambda(notification))
        .rejects.toThrow('Environment variables WALLET_SERVICE_LAMBDA_ENDPOINT and STAGE are not set.');
    });
  });

  describe('invokeOnTxPushNotificationRequestedLambda(walletBalanceValueMap)', () => {
    it('should succeed', async () => {
      expect.hasAssertions();

      // clear counts
      jest.clearAllMocks();
      // reload module
      process.env.PUSH_NOTIFICATION_ENABLED = 'true';
      const { PushNotificationUtils } = await import('@src/utils/pushnotification.utils');

      const walletMap = buildWalletBalanceValueMap();
      const result = await PushNotificationUtils.invokeOnTxPushNotificationRequestedLambda(walletMap);

      // void method returns undefined
      expect(result).toBeUndefined();

      // assert Lambda constructor call
      expect(Lambda).toHaveBeenCalledTimes(1);
      expect(Lambda).toHaveBeenCalledWith({
        apiVersion: '2015-03-31',
        endpoint: process.env.ON_TX_PUSH_NOTIFICATION_REQUESTED_LAMBDA_ENDPOINT,
      });

      // assert lambda invoke call
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith({
        FunctionName: buildFunctionName(FunctionName.ON_TX_PUSH_NOTIFICATION_REQUESTED),
        InvocationType: 'Event',
        Payload: JSON.stringify(walletMap),
      });
    });

    // it should not call lambda when push notification is disabled
    it('should not call lambda when push notification is disabled', async () => {
      expect.hasAssertions();

      // clear counts
      jest.clearAllMocks();
      // reload module
      process.env.PUSH_NOTIFICATION_ENABLED = 'false';
      const { PushNotificationUtils } = await import('@src/utils/pushnotification.utils');

      const walletMap = buildWalletBalanceValueMap();
      const result = await PushNotificationUtils.invokeOnTxPushNotificationRequestedLambda(walletMap);

      // void method returns undefined
      expect(result).toBeUndefined();

      // assert Lambda constructor call
      expect(Lambda).toHaveBeenCalledTimes(0);

      // assert lambda invoke call
      expect(invokeMock).toHaveBeenCalledTimes(0);

      // assert log message
      expect(logger.debug).toHaveBeenCalledWith('Push notification is disabled. Skipping invocation of OnTxPushNotificationRequestedLambda lambda.');
    });

    it('should throw an error when invoke fails', async () => {
      expect.hasAssertions();

      const not202Code = 500;
      // simulate a failing lambda invokation
      promiseMock.mockReturnValue({
        StatusCode: not202Code,
      });

      // reload module
      process.env.PUSH_NOTIFICATION_ENABLED = 'true';
      const { PushNotificationUtils } = await import('@src/utils/pushnotification.utils');

      const walletMap = buildWalletBalanceValueMap();
      await expect(PushNotificationUtils.invokeOnTxPushNotificationRequestedLambda(walletMap)).rejects.toMatchInlineSnapshot('[Error: hathor-wallet-service-stage-txPushRequested lambda invoke failed for wallets: wallet1]');
    });
  });
});
