/* eslint-disable global-require */
import { mockedAddAlert } from '@tests/utils/alerting.utils.mock';
import { logger } from '@tests/winston.mock'; // most be the first to import
import { initFirebaseAdminMock } from '@tests/utils/firebase-admin.mock';

import {
  send,
} from '@src/api/pushSendNotificationToDevice';
import {
  PushNotificationUtils,
  PushNotificationError,
} from '@src/utils/pushnotification.utils';
import {
  register,
} from '@src/api/pushRegister';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToWalletTable,
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
  checkPushDevicesTable,
} from '@tests/utils';
import { APIGatewayProxyResult, Context } from 'aws-lambda';
import { Severity } from '@src/types';

const mysql = getDbConnection();

initFirebaseAdminMock();
const spyOnSendToFcm = jest.spyOn(PushNotificationUtils, 'sendToFcm');
const spyOnLoggerError = jest.spyOn(logger, 'error');

const initEnv = process.env;

beforeEach(async () => {
  process.env = {
    ...initEnv,
    PUSH_ALLOWED_PROVIDERS: 'android,ios',
  };
  spyOnSendToFcm.mockClear();
  spyOnLoggerError.mockClear();
  jest.resetModules(); // Needed for the AWS.SQS mock, as it is getting cached
  await cleanDatabase(mysql);
  jest.resetModules();
});

afterAll(async () => {
  process.env = initEnv;
  await closeDbConnection(mysql);
});

const buildEventPayload = (options?) => ({
  deviceId: 'device1',
  metadata: {
    titleLocKey: 'new_transaction_received_title',
    bodyLocKey: 'new_transaction_received_description_without_tokens',
    txId: '00e2597222154cf99bfef171e27374e7f35aa7448afae10c15e9f049b95a3e67',
    ...options,
  },
});

test('send push notification to the right provider', async () => {
  expect.hasAssertions();
  spyOnSendToFcm.mockImplementation(() => Promise.resolve({
    success: true,
  }));

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({
    deviceId: 'device1',
    pushProvider: 'android',
    enablePush: true,
    enableShowAmounts: false,
  }));
  await register(event, null, null) as APIGatewayProxyResult;

  const validPayload = buildEventPayload();
  const sendContext = { awsRequestId: '123' } as Context;

  const result = await send(validPayload, sendContext, null) as { success: boolean, message?: string };

  expect(result.success).toStrictEqual(true);
  expect(spyOnSendToFcm).toHaveBeenCalledTimes(1);
});

test('should unregister device when invalid device id', async () => {
  expect.hasAssertions();
  spyOnSendToFcm.mockImplementation(() => Promise.resolve({
    success: false,
    errorMessage: PushNotificationError.INVALID_DEVICE_ID,
  }));

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({
    deviceId: 'device1',
    pushProvider: 'android',
    enablePush: true,
    enableShowAmounts: false,
  }));
  await register(event, null, null) as APIGatewayProxyResult;
  await expect(
    checkPushDevicesTable(mysql, 1),
  ).resolves.toBe(true);

  const validPayload = buildEventPayload();
  const sendContext = { awsRequestId: '123' } as Context;

  const result = await send(validPayload, sendContext, null) as { success: boolean, message?: string };

  expect(result.success).toStrictEqual(false);
  expect(result.message).toStrictEqual('Failed due to invalid device id.');
  expect(spyOnSendToFcm).toHaveBeenCalledTimes(1);
  await expect(
    checkPushDevicesTable(mysql, 0),
  ).resolves.toBe(true);
});

describe('validation', () => {
  it('should validate deviceId', async () => {
    expect.hasAssertions();
    const deviceId = (new Array(257)).fill('x').join('');

    const payloadWithInvalidDeviceId = {
      deviceId,
      title: 'You have a new transaction',
      description: '5HTR was sent to my-wallet',
      metadata: {
        txId: '00e2597222154cf99bfef171e27374e7f35aa7448afae10c15e9f049b95a3e67',
      },
    };
    const sendEvent = { body: payloadWithInvalidDeviceId };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
  });

  it('should validate title', async () => {
    expect.hasAssertions();

    const payloadWithoutTitle = {
      deviceId: 'device1',
      description: '5HTR was sent to my-wallet',
      metadata: {
        txId: '00e2597222154cf99bfef171e27374e7f35aa7448afae10c15e9f049b95a3e67',
      },
    };
    const sendEvent = { body: payloadWithoutTitle };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
  });

  it('should validate description', async () => {
    expect.hasAssertions();

    const payloadWithoutDescription = {
      deviceId: 'device1',
      title: 'You have a new transaction',
      metadata: {
        txId: '00e2597222154cf99bfef171e27374e7f35aa7448afae10c15e9f049b95a3e67',
      },
    };
    const sendEvent = { body: payloadWithoutDescription };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
  });

  it('should validate metadata', async () => {
    expect.hasAssertions();

    await addToWalletTable(mysql, [{
      id: 'my-wallet',
      xpubkey: 'xpubkey',
      authXpubkey: 'auth_xpubkey',
      status: 'ready',
      maxGap: 5,
      createdAt: 10000,
      readyAt: 10001,
    }]);

    const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({
      deviceId: 'device1',
      pushProvider: 'android',
      enablePush: true,
      enableShowAmounts: false,
    }));
    await register(event, null, null) as APIGatewayProxyResult;

    const payloadWithoutMetadata = {
      deviceId: 'device1',
      title: 'You have a new transaction',
      description: '5HTR was sent to my-wallet',
    };
    const sendEvent = { body: payloadWithoutMetadata };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
  });
});

describe('alert', () => {
  it('should alert when push device not found', async () => {
    expect.hasAssertions();

    // skip device registration

    const validPayload = buildEventPayload();
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(validPayload, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
    expect(result.message).not.toBeNull();
    expect(spyOnLoggerError).toHaveBeenCalledWith('Device not found.', { deviceId: 'device1' });
    expect(mockedAddAlert).toHaveBeenCalledWith(
      'Device not found while trying to send notification',
      '-',
      Severity.MINOR,
      { deviceId: 'device1' },
    );
  });

  it('should alert when provider not implemented', async () => {
    expect.hasAssertions();

    // allow android and desktop, while test for ios provider
    process.env.PUSH_ALLOWED_PROVIDERS = 'android,desktop';
    await import('@src/api/pushSendNotificationToDevice');

    await addToWalletTable(mysql, [{
      id: 'my-wallet',
      xpubkey: 'xpubkey',
      authXpubkey: 'auth_xpubkey',
      status: 'ready',
      maxGap: 5,
      createdAt: 10000,
      readyAt: 10001,
    }]);

    const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({
      deviceId: 'device1',
      pushProvider: 'ios',
      enablePush: true,
      enableShowAmounts: false,
    }));
    await register(event, null, null) as APIGatewayProxyResult;

    const validPayload = buildEventPayload();
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(validPayload, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
    expect(result.message).not.toBeNull();
    expect(spyOnLoggerError).toHaveBeenCalledWith('Provider invalid.', { deviceId: 'device1', pushProvider: 'ios' });
    expect(mockedAddAlert).toHaveBeenCalledWith(
      'Invalid provider error while sending push notification',
      '-',
      Severity.MINOR,
      { deviceId: 'device1', pushProvider: 'ios' },
    );
  });
});
