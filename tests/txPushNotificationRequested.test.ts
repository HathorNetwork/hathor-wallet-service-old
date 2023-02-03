import { logger } from '@tests/winston.mock';
import { initFirebaseAdminMock } from '@tests/utils/firebase-admin.mock';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToWalletTable,
  cleanDatabase,
  buildWallet,
} from '@tests/utils';
import { handleRequest, pushNotificationMessage } from '@src/api/txPushNotificationRequested';
import { StringMap, WalletBalanceValue, PushProvider, SendNotificationToDevice } from '@src/types';
import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { registerPushDevice, storeTokenInformation } from '@src/db';
import { Context } from 'aws-lambda';

const mysql = getDbConnection();

initFirebaseAdminMock();
const spyOnInvokeSendNotification = jest.spyOn(PushNotificationUtils, 'invokeSendNotificationHandlerLambda');

const buildEvent = (walletId, txId, walletBalanceForTx?): StringMap<WalletBalanceValue> => ({
  [walletId]: {
    walletId,
    addresses: [
      'addr2',
    ],
    txId,
    walletBalanceForTx: walletBalanceForTx || [
      {
        tokenId: 'token2',
        tokenSymbol: 'T2',
        lockExpires: null,
        lockedAmount: 0,
        lockedAuthorities: {
          melt: false,
          mint: false,
        },
        total: 10,
        totalAmountSent: 10,
        unlockedAmount: 10,
        unlockedAuthorities: {
          melt: false,
          mint: false,
        },
      },
      {
        tokenId: 'token1',
        tokenSymbol: 'T1',
        lockExpires: null,
        lockedAmount: 0,
        lockedAuthorities: {
          melt: false,
          mint: false,
        },
        totalAmountSent: 5,
        unlockedAmount: 5,
        unlockedAuthorities: {
          melt: false,
          mint: false,
        },
        total: 5,
      },
    ],
  },
});

beforeEach(async () => {
  initFirebaseAdminMock.mockReset();
  spyOnInvokeSendNotification.mockReset();
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

describe('success', () => {
  it('should alert when invoke send notification fails', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    await addToWalletTable(mysql, [buildWallet({ id: walletId })]);

    const deviceId = 'device1';
    const pushDevice = {
      deviceId,
      walletId,
      pushProvider: PushProvider.ANDROID,
      enablePush: true,
      enableShowAmounts: false,
    };

    await storeTokenInformation(mysql, 'token1', 'token1', 'T1');

    await registerPushDevice(mysql, pushDevice);

    const txId = 'txId1';

    const sendEvent = buildEvent(walletId, txId, [
      {
        tokenId: 'token2',
        tokenSymbol: 'T2',
        lockExpires: null,
        lockedAmount: 0,
        lockedAuthorities: {
          melt: false,
          mint: false,
        },
        total: 10,
        totalAmountSent: 10,
        unlockedAmount: 10,
        unlockedAuthorities: {
          melt: false,
          mint: false,
        },
      },
    ]);
    const sendContext = { awsRequestId: '123' } as Context;

    spyOnInvokeSendNotification.mockRejectedValue(new Error('Error sending push notification'));
    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(1);
    const lastErrorCall = logger.error.mock.calls[logger.error.mock.calls.length - 1][0];
    expect(lastErrorCall).toMatchInlineSnapshot('"Unexpected failure while calling invokeSendNotificationHandlerLambda."');
  });

  it('should invoke send notification with generic message', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    await addToWalletTable(mysql, [buildWallet({ id: walletId })]);

    // device with disabled enableShowAmounts, resulting in a generic notification
    const deviceId = 'device1';
    const pushDevice = {
      deviceId,
      walletId,
      pushProvider: PushProvider.ANDROID,
      enablePush: true,
      enableShowAmounts: false,
    };

    await storeTokenInformation(mysql, 'token1', 'token1', 'T1');
    await storeTokenInformation(mysql, 'token2', 'token2', 'T2');

    await registerPushDevice(mysql, pushDevice);

    const txId = 'txId1';

    const sendEvent = buildEvent(walletId, txId, [
      {
        tokenId: 'token2',
        tokenSymbol: 'T2',
        lockExpires: null,
        lockedAmount: 0,
        lockedAuthorities: {
          melt: false,
          mint: false,
        },
        total: 10,
        totalAmountSent: 10,
        unlockedAmount: 10,
        unlockedAuthorities: {
          melt: false,
          mint: false,
        },
      },
      {
        tokenId: 'token1',
        tokenSymbol: 'T1',
        lockExpires: null,
        lockedAmount: 0,
        lockedAuthorities: {
          melt: false,
          mint: false,
        },
        totalAmountSent: 5,
        unlockedAmount: 5,
        unlockedAuthorities: {
          melt: false,
          mint: false,
        },
        total: 5,
      },
    ]);
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(1);

    const expectedNotification = {
      deviceId,
      metadata: {
        txId,
        bodyLocKey: 'new_transaction_received_description_without_tokens',
        titleLocKey: 'new_transaction_received_title',
      },
    } as SendNotificationToDevice;
    expect(spyOnInvokeSendNotification).toHaveBeenLastCalledWith(expectedNotification);
  });

  it('should succeed wihout invoke notification when device settings found has push notification disabled', async () => {
    expect.hasAssertions();
    const walletId = 'wallet1';
    const deviceId = 'device1';
    const txId = 'txId1';

    await addToWalletTable(mysql, [{
      id: walletId,
      xpubkey: 'xpubkey',
      authXpubkey: 'auth_xpubkey',
      status: 'ready',
      maxGap: 5,
      createdAt: 10000,
      readyAt: 10001,
    }]);

    // device with disabled enableShowAmounts, resulting in no notification
    const pushDevice = {
      deviceId,
      walletId,
      pushProvider: PushProvider.ANDROID,
      enablePush: false,
      enableShowAmounts: false,
    };
    await registerPushDevice(mysql, pushDevice);

    await storeTokenInformation(mysql, 'token2', 'token2', 'T2');

    const sendEvent = buildEvent(walletId, txId, [
      {
        tokenId: 'token2',
        tokenSymbol: 'T2',
        lockExpires: null,
        lockedAmount: 0,
        lockedAuthorities: {
          melt: false,
          mint: false,
        },
        total: 10,
        totalAmountSent: 10,
        unlockedAmount: 10,
        unlockedAuthorities: {
          melt: false,
          mint: false,
        },
      },
    ]);
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });

  describe('should invoke send notification with specific message', () => {
    const walletId = 'wallet1';
    const deviceId = 'device1';
    const txId = 'txId1';

    beforeEach(async () => {
      await addToWalletTable(mysql, [buildWallet({ id: walletId })]);

      // device with enabled enableShowAmounts, resulting in an specific notification
      const pushDevice = {
        deviceId,
        walletId,
        pushProvider: PushProvider.ANDROID,
        enablePush: true,
        enableShowAmounts: true,
      };
      await registerPushDevice(mysql, pushDevice);
      await storeTokenInformation(mysql, 'token1', 'token1', 'T1');
      await storeTokenInformation(mysql, 'token2', 'token2', 'T2');
      await storeTokenInformation(mysql, 'token3', 'token3', 'T3');
      await storeTokenInformation(mysql, 'token4', 'token4', 'T4');
    });

    it('token balance with 1 token', async () => {
      expect.hasAssertions();

      const sendEvent = buildEvent(walletId, txId, [
        {
          tokenId: 'token2',
          tokenSymbol: 'T2',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 10,
          totalAmountSent: 10,
          unlockedAmount: 10,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
        },
      ]);
      const sendContext = { awsRequestId: '123' } as Context;

      const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

      expect(result.success).toStrictEqual(true);
      expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(1);

      // first argument of the first call
      const notificationSentOnSpy = spyOnInvokeSendNotification.mock.calls[0][0];
      expect(notificationSentOnSpy).toMatchInlineSnapshot(`
Object {
  "deviceId": "device1",
  "metadata": Object {
    "bodyLocArgs": "[\\"10 T2\\"]",
    "bodyLocKey": "new_transaction_received_description_with_tokens",
    "titleLocKey": "new_transaction_received_title",
    "txId": "txId1",
  },
}
`);
    });

    it('token balance with 2 token', async () => {
      expect.hasAssertions();

      const sendEvent = buildEvent(walletId, txId, [
        {
          tokenId: 'token2',
          tokenSymbol: 'T2',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 10,
          totalAmountSent: 10,
          unlockedAmount: 10,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
        },
        {
          tokenId: 'token1',
          tokenSymbol: 'T1',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          totalAmountSent: 5,
          unlockedAmount: 5,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 5,
        },
      ]);
      const sendContext = { awsRequestId: '123' } as Context;

      const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

      expect(result.success).toStrictEqual(true);
      expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(1);

      // first argument of the first call
      const notificationSentOnSpy = spyOnInvokeSendNotification.mock.calls[0][0];
      expect(notificationSentOnSpy).toMatchInlineSnapshot(`
Object {
  "deviceId": "device1",
  "metadata": Object {
    "bodyLocArgs": "[\\"10 T2\\",\\"5 T1\\"]",
    "bodyLocKey": "new_transaction_received_description_with_tokens",
    "titleLocKey": "new_transaction_received_title",
    "txId": "txId1",
  },
}
`);
    });

    it('token balance with 3 tokens', async () => {
      expect.hasAssertions();

      const sendEvent = buildEvent(walletId, txId, [
        {
          tokenId: 'token2',
          tokenSymbol: 'T2',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 10,
          totalAmountSent: 10,
          unlockedAmount: 10,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
        },
        {
          tokenId: 'token1',
          tokenSymbol: 'T1',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          totalAmountSent: 5,
          unlockedAmount: 5,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 5,
        },
        {
          tokenId: 'token3',
          tokenSymbol: 'T3',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          totalAmountSent: 1,
          unlockedAmount: 1,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 1,
        },
      ]);
      const sendContext = { awsRequestId: '123' } as Context;

      const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

      expect(result.success).toStrictEqual(true);
      expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(1);

      // first argument of the first call
      const notificationSentOnSpy = spyOnInvokeSendNotification.mock.calls[0][0];
      expect(notificationSentOnSpy).toMatchInlineSnapshot(`
Object {
  "deviceId": "device1",
  "metadata": Object {
    "bodyLocArgs": "[\\"10 T2\\",\\"5 T1\\",\\"1\\"]",
    "bodyLocKey": "new_transaction_received_description_with_tokens",
    "titleLocKey": "new_transaction_received_title",
    "txId": "txId1",
  },
}
`);
    });

    it('token balance with more than 3 tokens', async () => {
      expect.hasAssertions();

      const sendEvent = buildEvent(walletId, txId, [
        {
          tokenId: 'token2',
          tokenSymbol: 'T2',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 10,
          totalAmountSent: 10,
          unlockedAmount: 10,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
        },
        {
          tokenId: 'token1',
          tokenSymbol: 'T1',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          totalAmountSent: 5,
          unlockedAmount: 5,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 5,
        },
        {
          tokenId: 'token3',
          tokenSymbol: 'T3',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          totalAmountSent: 1,
          unlockedAmount: 1,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 1,
        },
        {
          tokenId: 'token4',
          tokenSymbol: 'T4',
          lockExpires: null,
          lockedAmount: 0,
          lockedAuthorities: {
            melt: false,
            mint: false,
          },
          totalAmountSent: 1,
          unlockedAmount: 1,
          unlockedAuthorities: {
            melt: false,
            mint: false,
          },
          total: 1,
        },
      ]);
      const sendContext = { awsRequestId: '123' } as Context;

      const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

      expect(result.success).toStrictEqual(true);
      expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(1);

      // first argument of the first call
      const notificationSentOnSpy = spyOnInvokeSendNotification.mock.calls[0][0];
      expect(notificationSentOnSpy).toMatchInlineSnapshot(`
Object {
  "deviceId": "device1",
  "metadata": Object {
    "bodyLocArgs": "[\\"10 T2\\",\\"5 T1\\",\\"2\\"]",
    "bodyLocKey": "new_transaction_received_description_with_tokens",
    "titleLocKey": "new_transaction_received_title",
    "txId": "txId1",
  },
}
`);
    });
  });
});

describe('failure', () => {
  it('should fails when no device settings is found', async () => {
    expect.hasAssertions();
    const walletId = 'wallet1';
    const txId = 'txId1';

    const sendEvent = buildEvent(walletId, txId, [
      {
        tokenId: 'token2',
        tokenSymbol: 'T2',
        lockExpires: null,
        lockedAmount: 0,
        lockedAuthorities: {
          melt: false,
          mint: false,
        },
        total: 10,
        totalAmountSent: 10,
        unlockedAmount: 10,
        unlockedAuthorities: {
          melt: false,
          mint: false,
        },
      },
    ]);
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.deviceSettingsNotFound);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });
});

describe('validation StringMap<WalletBalanceValue>', () => {
  it('should validate map format', async () => {
    expect.hasAssertions();

    const sendEvent = [] as unknown as StringMap<WalletBalanceValue>;
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.invalidPayload);
    expect(/must be of type object/.test(result.details[0].message)).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });

  it('should validate map key type', async () => {
    expect.hasAssertions();

    const sendEvent = {} as unknown as StringMap<WalletBalanceValue>;
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.invalidPayload);
    expect(/must have at least 1 key/.test(result.details[0].message)).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });

  it('should validate required WalletBalanceValue keys', async () => {
    expect.hasAssertions();

    const sendEvent = { wallet1: { } } as unknown as StringMap<WalletBalanceValue>;
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.invalidPayload);
    expect(result.details).toHaveLength(4);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });
});
