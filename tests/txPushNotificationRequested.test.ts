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
import { registerPushDevice } from '@src/db';
import { Context } from 'aws-lambda';

const mysql = getDbConnection();

initFirebaseAdminMock();
const spyOnInvokeSendNotification = jest.spyOn(PushNotificationUtils, 'invokeSendNotificationHandlerLambda');

beforeEach(async () => {
  jest.resetAllMocks();
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

describe('success', () => {
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
    await registerPushDevice(mysql, pushDevice);

    const txId = 'txId1';
    const validPayload = {
      [walletId]: {
        walletId,
        addresses: [
          'addr2',
        ],
        txId,
        walletBalanceForTx: [
          {
            tokenId: 'token2',
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
    } as StringMap<WalletBalanceValue>;
    const sendEvent = { body: validPayload };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(1);

    const expectedNotification = {
      deviceId,
      metadata: {
        txId,
        body_loc_key: 'new_transaction_received_description_without_tokens',
        title_loc_key: 'new_transaction_received_title',
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

    // device with disabled enableShowAmounts, resulting in a generic notification
    const pushDevice = {
      deviceId,
      walletId,
      pushProvider: PushProvider.ANDROID,
      enablePush: false,
      enableShowAmounts: false,
    };
    await registerPushDevice(mysql, pushDevice);

    const payloadWith1Token = {
      [walletId]: {
        walletId,
        addresses: [
          'addr2',
        ],
        txId,
        walletBalanceForTx: [
          {
            tokenId: 'token2',
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
        ],
      },
    } as StringMap<WalletBalanceValue>;
    const sendEvent = { body: payloadWith1Token };
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
    });

    it('token balance with 1 token', async () => {
      expect.hasAssertions();
      const payloadWith1Token = {
        [walletId]: {
          walletId,
          addresses: [
            'addr2',
          ],
          txId,
          walletBalanceForTx: [
            {
              tokenId: 'token2',
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
          ],
        },
      } as StringMap<WalletBalanceValue>;
      const sendEvent = { body: payloadWith1Token };
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
    "body_loc_args": "[\\"10 token2\\"]",
    "body_loc_key": "new_transaction_received_description_without_tokens",
    "title_loc_key": "new_transaction_received_title",
    "txId": "txId1",
  },
}
`);
    });

    it('token balance with 2 token', async () => {
      expect.hasAssertions();
      const payloadWith1Token = {
        [walletId]: {
          walletId,
          addresses: [
            'addr2',
          ],
          txId,
          walletBalanceForTx: [
            {
              tokenId: 'token2',
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
      } as StringMap<WalletBalanceValue>;
      const sendEvent = { body: payloadWith1Token };
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
    "body_loc_args": "[\\"10 token2\\",\\"5 token1\\"]",
    "body_loc_key": "new_transaction_received_description_without_tokens",
    "title_loc_key": "new_transaction_received_title",
    "txId": "txId1",
  },
}
`);
    });

    it('token balance with 3 tokens', async () => {
      expect.hasAssertions();
      const payloadWith1Token = {
        [walletId]: {
          walletId,
          addresses: [
            'addr2',
          ],
          txId,
          walletBalanceForTx: [
            {
              tokenId: 'token2',
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
          ],
        },
      } as StringMap<WalletBalanceValue>;
      const sendEvent = { body: payloadWith1Token };
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
    "body_loc_args": "[\\"10 token2\\",\\"5 token1\\",\\"1\\"]",
    "body_loc_key": "new_transaction_received_description_without_tokens",
    "title_loc_key": "new_transaction_received_title",
    "txId": "txId1",
  },
}
`);
    });

    it('token balance with more than 3 tokens', async () => {
      expect.hasAssertions();
      const payloadWith1Token = {
        [walletId]: {
          walletId,
          addresses: [
            'addr2',
          ],
          txId,
          walletBalanceForTx: [
            {
              tokenId: 'token2',
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
          ],
        },
      } as StringMap<WalletBalanceValue>;
      const sendEvent = { body: payloadWith1Token };
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
    "body_loc_args": "[\\"10 token2\\",\\"5 token1\\",\\"2\\"]",
    "body_loc_key": "new_transaction_received_description_without_tokens",
    "title_loc_key": "new_transaction_received_title",
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

    const payloadWith1Token = {
      [walletId]: {
        walletId,
        addresses: [
          'addr2',
        ],
        txId,
        walletBalanceForTx: [
          {
            tokenId: 'token2',
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
        ],
      },
    } as StringMap<WalletBalanceValue>;
    const sendEvent = { body: payloadWith1Token };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.deviceSettinsNotFound);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });
});

describe('validation StringMap<WalletBalanceValue>', () => {
  it('should validate map format', async () => {
    expect.hasAssertions();

    const invalidPayload = [] as unknown as StringMap<WalletBalanceValue>;
    const sendEvent = { body: invalidPayload };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.invalidPayload);
    expect(/must be of type object/.test(result.details[0].message)).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });

  it('should validate map key type', async () => {
    expect.hasAssertions();

    const invalidPayload = {} as unknown as StringMap<WalletBalanceValue>;
    const sendEvent = { body: invalidPayload };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.invalidPayload);
    expect(/must have at least 1 key/.test(result.details[0].message)).toStrictEqual(true);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });

  it('should validate required WalletBalanceValue keys', async () => {
    expect.hasAssertions();

    const invalidPayload = { wallet1: { } } as unknown as StringMap<WalletBalanceValue>;
    const sendEvent = { body: invalidPayload };
    const sendContext = { awsRequestId: '123' } as Context;

    const result = await handleRequest(sendEvent, sendContext, null) as { success: boolean, message?: string, details?: unknown };

    expect(result.success).toStrictEqual(false);
    expect(result.message).toStrictEqual(pushNotificationMessage.invalidPayload);
    expect(result.details).toHaveLength(4);
    expect(spyOnInvokeSendNotification).toHaveBeenCalledTimes(0);
  });
});
