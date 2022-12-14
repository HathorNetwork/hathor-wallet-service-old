import {
  unregister,
} from '@src/api/pushUnregister';
import { closeDbConnection, getDbConnection } from '@src/utils';
import { registerPushDevice, unregisterPushDevice } from '@src/db';
import {
  addToWalletTable,
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
  checkPushDevicesTable,
} from '@tests/utils';
import { APIGatewayProxyResult } from 'aws-lambda';
import { ApiError } from '@src/api/errors';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('unregister push device given a wallet', async () => {
  expect.hasAssertions();

  // register a wallet
  const walletId = 'wallet1';
  await addToWalletTable(mysql, [{
    id: walletId,
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);

  // register the device to a wallet
  const deviceId = 'device1';
  const pushProvider = 'android';
  const enablePush = true;
  const enableShowAmounts = false;
  await registerPushDevice(mysql, {
    walletId,
    deviceId,
    pushProvider,
    enablePush,
    enableShowAmounts,
  });

  await expect(checkPushDevicesTable(mysql, 1, {
    walletId,
    deviceId,
    pushProvider,
    enablePush: true,
    enableShowAmounts,
  })).resolves.toBe(true);

  const event = makeGatewayEventWithAuthorizer(walletId, {
    deviceId,
  }, null);

  const result = await unregister(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);

  await expect(checkPushDevicesTable(mysql, 0, {
    walletId,
    deviceId,
    pushProvider,
    enablePush: true,
    enableShowAmounts,
  })).resolves.toBe(true);
});

describe('statusCode:200', () => {
  it('should unregister the right device in face of many', async () => {
    expect.hasAssertions();

    // register wallets
    const walletId = 'wallet1';
    await addToWalletTable(mysql, [{
      id: walletId,
      xpubkey: 'xpubkey',
      authXpubkey: 'auth_xpubkey',
      status: 'ready',
      maxGap: 5,
      createdAt: 10000,
      readyAt: 10001,
    }]);

    // register the device to a wallets
    const pushProvider = 'android';
    const enablePush = true;
    const enableShowAmounts = false;

    const deviceToUnregister = 'device1';
    const deviceToRemain = 'device2';
    const devicesToAdd = [deviceToUnregister, deviceToRemain];
    devicesToAdd.forEach(async (eachDevice) => {
      await registerPushDevice(mysql, {
        walletId,
        deviceId: eachDevice,
        pushProvider,
        enablePush,
        enableShowAmounts,
      });
    });
    await expect(checkPushDevicesTable(mysql, 2)).resolves.toBe(true);

    const event = makeGatewayEventWithAuthorizer(walletId, {
      deviceId: deviceToUnregister,
    }, null);

    const result = await unregister(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId: deviceToRemain,
      pushProvider,
      enablePush: true,
      enableShowAmounts,
    })).resolves.toBe(true);
  });

  it('should succeed even when there is no device registered', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const deviceId = 'device1';

    const event = makeGatewayEventWithAuthorizer(walletId, {
      deviceId,
    }, null);

    const result = await unregister(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);

    await expect(checkPushDevicesTable(mysql, 0)).resolves.toBe(true);
  });

  it('should succeed even when device id not exists', async () => {
    expect.hasAssertions();

    // register a wallet
    const walletId = 'wallet1';
    await addToWalletTable(mysql, [{
      id: walletId,
      xpubkey: 'xpubkey',
      authXpubkey: 'auth_xpubkey',
      status: 'ready',
      maxGap: 5,
      createdAt: 10000,
      readyAt: 10001,
    }]);

    // register the device to a wallet
    const deviceId = 'device1';
    const pushProvider = 'android';
    const enablePush = true;
    const enableShowAmounts = false;
    await registerPushDevice(mysql, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    });

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId,
      pushProvider,
      enablePush: true,
      enableShowAmounts,
    })).resolves.toBe(true);

    const event = makeGatewayEventWithAuthorizer(walletId, {
      deviceId: 'device-not-exists',
    }, null);

    const result = await unregister(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    })).resolves.toBe(true);
  });
});

describe('statusCode:400', () => {
  it('should validate deviceId', async () => {
    expect.hasAssertions();
    const deviceId = (new Array(257)).fill('x').join('');

    await addToWalletTable(mysql, [{
      id: 'my-wallet',
      xpubkey: 'xpubkey',
      authXpubkey: 'auth_xpubkey',
      status: 'ready',
      maxGap: 5,
      createdAt: 10000,
      readyAt: 10001,
    }]);

    const event = makeGatewayEventWithAuthorizer('my-wallet', {
      deviceId,
    }, null);

    const result = await unregister(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(400);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual(ApiError.INVALID_PAYLOAD);
    expect(returnBody.details).toMatchInlineSnapshot(`
Array [
  Object {
    "message": "\\"deviceId\\" length must be less than or equal to 256 characters long",
    "path": Array [
      "deviceId",
    ],
  },
]
`);
  });
});
