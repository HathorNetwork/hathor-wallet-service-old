/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-shadow */
/* eslint-disable @typescript-eslint/naming-convention */
// mocks should be imported first
import { fcmConfigMock } from '@tests/utils/fcm.config.json.mock';
import { sendMulticastMock, messaging } from '@tests/utils/firebase-admin.mock';
import { invokeMock, promiseMock } from '@tests/utils/aws-sdk.mock';
import { logger } from '@tests/winston.mock';
import { PushNotificationUtils, PushNotificationError, buildFunctionName, FunctionName } from '@src/utils/pushnotification.utils';
import { SendNotificationToDevice } from '@src/types';
import { Lambda } from 'aws-sdk';
import { buildWalletBalanceValueMap } from '@tests/utils';

describe('PushNotificationUtils', () => {
  const initEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...initEnv,
      SEND_NOTIFICATION_LAMBDA_ENDPOINT: 'endpoint',
      STAGE: 'stage',
      FIREBASE_PROJECT_ID: 'projectId',
      ON_TX_PUSH_NOTIFICATION_REQUESTED_LAMBDA_ENDPOINT: 'endpoint',
    };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = initEnv;
  });

  describe('fcm.config.json', () => {
    it('file not loaded', () => {
      expect.hasAssertions();

      // make json resolve to undefined
      fcmConfigMock.mockReturnValue(undefined);

      // reload json module
      const serviceAccount = require('@src/utils/fcm.config.json');
      // reload push notification utils
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      // make fcm.config.json file to resolve to undefined
      fcmConfigMock.mockImplementation(() => undefined);

      // reload pushnotification module
      require('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenCalledWith('[ALERT] serviceAccount was not loaded. Make sure the file src/utils/fcm.config.json is included in the build output.');
    });
  });

  describe('process.env', () => {
    it('SEND_NOTIFICATION_LAMBDA_ENDPOINT', () => {
      expect.hasAssertions();

      // load local env
      process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT = '';

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] env.SEND_NOTIFICATION_LAMBDA_ENDPOINT can not be null or undefined.');
    });

    it('STAGE', () => {
      expect.hasAssertions();

      // load local env
      process.env.STAGE = '';

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] env.STAGE can not be null or undefined.');
    });

    it('FIREBASE_PROJECT_ID', () => {
      expect.hasAssertions();

      // load local env
      process.env.FIREBASE_PROJECT_ID = '';

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] env.FIREBASE_PROJECT_ID can not be null or undefined.');
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

    it('should return success true when succeed', async () => {
      expect.hasAssertions();

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
      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] Error while calling sendMulticast(message) of Firebase Cloud Message.', { error: { code: 'any-other-code' } });
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
      process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = 'test';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

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
      process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = 'test';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

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
      process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = '';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      const notification = {
        deviceId: 'device1',
        title: 'New transaction',
        description: 'You recieved 1 HTR.',
        metadata: {
          txId: 'tx1',
        },
      } as SendNotificationToDevice;

      await expect(PushNotificationUtils.invokeSendNotificationHandlerLambda(notification))
        .rejects.toThrow('Environment variables SEND_NOTIFICATION_LAMBDA_ENDPOINT and STAGE are not set.');
    });
  });

  describe('invokeOnTxPushNotificationRequestedLambda(walletBalanceValueMap)', () => {
    it('should succeed', async () => {
      expect.hasAssertions();

      // clear counts
      jest.clearAllMocks();
      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

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

    it('should throw an error when invoke fails', async () => {
      expect.hasAssertions();

      const not202Code = 500;
      // simulate a failing lambda invokation
      promiseMock.mockReturnValue({
        StatusCode: not202Code,
      });

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      const walletMap = buildWalletBalanceValueMap();
      await expect(
        PushNotificationUtils.invokeOnTxPushNotificationRequestedLambda(
          walletMap,
        ),
      ).rejects.toMatchInlineSnapshot(
        '[Error: hathor-wallet-service-stage-onTxPushNotificationRequested lambda invoke failed for wallets: wallet1]',
      );
    });
  });
});
