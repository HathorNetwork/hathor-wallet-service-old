const logger = {
  debug: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
};

// IMPORTANT First mock winston
jest.mock('winston', () => ({
  format: {
    colorize: jest.fn(),
    combine: jest.fn(),
    label: jest.fn(),
    timestamp: jest.fn(),
    printf: jest.fn(),
    json: jest.fn(),
  },
  createLogger: jest.fn().mockReturnValue(logger),
  transports: {
    Console: jest.fn(),
  },
}));

import {
  send,
} from '@src/api/pushSendNotificationToDevice';
import {
  PushNotificationUtils,
} from '@src/utils/pushnotification.utils';
import {
  register,
} from '@src/api/pushRegister';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToWalletTable,
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
} from '@tests/utils';
import { APIGatewayProxyResult, Context } from 'aws-lambda';

const mysql = getDbConnection();

const spyOnSendToFcm = jest.spyOn(PushNotificationUtils, 'sendToFcm');
const spyOnLoggerError = jest.spyOn(logger, 'error');

beforeEach(async () => {
  spyOnSendToFcm.mockClear();
  spyOnLoggerError.mockClear();
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('send push notification to the right provider', async () => {
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

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, {
    deviceId: 'device1',
    pushProvider: 'android',
    enablePush: true,
    enableShowAmounts: false,
  });
  await register(event, null, null) as APIGatewayProxyResult;

  const validPayload = {
    deviceId: 'device1',
    title: 'You have a new transaction',
    description: '5HTR was sent to my-wallet',
    metadata: {
      firstMetadata: 'firstMetadata',
    },
  };
  const sendEvent = { body: validPayload };
  const sendContext = { awsRequestId: '123' } as Context;

  const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

  expect(result.success).toStrictEqual(true);
  expect(spyOnSendToFcm).toHaveBeenCalledTimes(1);
});

test('should complete even without metadata', async () => {
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

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, {
    deviceId: 'device1',
    pushProvider: 'android',
    enablePush: true,
    enableShowAmounts: false,
  });
  await register(event, null, null) as APIGatewayProxyResult;

  const payloadWithoutMetadata = {
    deviceId: 'device1',
    title: 'You have a new transaction',
    description: '5HTR was sent to my-wallet',
  };
  const sendEvent = { body: payloadWithoutMetadata };
  const sendContext = { awsRequestId: '123' } as Context;

  const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

  expect(result.success).toStrictEqual(true);
  expect(spyOnSendToFcm).toHaveBeenCalledTimes(1);
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
        firstMetadata: 'firstMetadata',
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
        firstMetadata: 'firstMetadata',
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
        firstMetadata: 'firstMetadata',
      },
    };
    const sendEvent = { body: payloadWithoutDescription };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
  });
});

describe('alert', () => {
  it('should alert when push device not found', async () => {
    expect.hasAssertions();

    const validPayload = {
      deviceId: 'device1',
      title: 'You have a new transaction',
      description: '5HTR was sent to my-wallet',
      metadata: {
        firstMetadata: 'firstMetadata',
      },
    };
    const sendEvent = { body: validPayload };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
    expect(result.message).not.toBeNull();
    expect(spyOnLoggerError).toBeCalledWith('[ALERT] Device not found.', { deviceId: 'device1' });
  });

  it('should alert when provider not implemented', async () => {
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

    const event = makeGatewayEventWithAuthorizer('my-wallet', null, {
      deviceId: 'device1',
      pushProvider: 'ios',
      enablePush: true,
      enableShowAmounts: false,
    });
    await register(event, null, null) as APIGatewayProxyResult;

    const validPayload = {
      deviceId: 'device1',
      title: 'You have a new transaction',
      description: '5HTR was sent to my-wallet',
      metadata: {
        firstMetadata: 'firstMetadata',
      },
    };
    const sendEvent = { body: validPayload };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await send(sendEvent, sendContext, null) as { success: boolean, message?: string };

    expect(result.success).toStrictEqual(false);
    expect(result.message).not.toBeNull();
    expect(spyOnLoggerError).toBeCalledWith('[ALERT] Provider invalid.', { deviceId: 'device1', pushProvider: 'ios' });
  });
});
