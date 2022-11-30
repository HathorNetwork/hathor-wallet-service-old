/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-shadow */
/* eslint-disable @typescript-eslint/naming-convention */
// mocks should be imported first
import { invokeMock, promiseMock } from '@tests/utils/aws-sdk.mock';
import { logger } from '@tests/winston.mock';
import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { SendNotificationToDevice } from '@src/types';
import { Lambda } from 'aws-sdk';

const spyOnLoggerError = jest.spyOn(logger, 'error');

describe('PushNotificationUtils', () => {
  const initEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    process.env = initEnv;
  });

  describe('process.env', () => {
    it('SEND_NOTIFICATION_LAMBDA_ENDPOINT', () => {
      expect.hasAssertions();

      // load local env
      const fakeEndpoint = '';
      process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = 'test';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] env.SEND_NOTIFICATION_LAMBDA_ENDPOINT can not be null or undefined.');
    });

    it('STAGE', () => {
      expect.hasAssertions();

      // load local env
      const fakeEndpoint = 'endpoint';
      process.env.SEND_NOTIFICATION_LAMBDA_ENDPOINT = fakeEndpoint;
      const fakeStage = '';
      process.env.STAGE = fakeStage;

      // reload module
      const { PushNotificationUtils } = require('@src/utils/pushnotification.utils');

      expect(logger.error).toHaveBeenLastCalledWith('[ALERT] env.STAGE can not be null or undefined.');
    });
  });

  it('sendToFcm(notification)', async () => {
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
});
