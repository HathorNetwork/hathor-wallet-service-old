import {
  update,
} from '@src/api/pushUpdate';
import { closeDbConnection, getDbConnection } from '@src/utils';
import { registerPushDevice } from '@src/db';
import {
  addToWalletTable,
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
  checkPushDevicesTable,
} from '@tests/utils';
import { ApiError } from '@src/api/errors';
import { APIGatewayProxyResult } from 'aws-lambda';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('update push device given a wallet', async () => {
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
  const enablePush = false; // disabled push notification
  const enableShowAmounts = false;
  await registerPushDevice(mysql, {
    walletId,
    deviceId,
    pushProvider,
    enablePush,
    enableShowAmounts,
  });

  const event = makeGatewayEventWithAuthorizer(walletId, null, JSON.stringify({
    deviceId,
    enablePush: true, // enables push notification
    enableShowAmounts: false,
  }));

  const result = await update(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);

  await expect(checkPushDevicesTable(mysql, 1, {
    walletId,
    deviceId,
    pushProvider,
    enablePush: true,
    enableShowAmounts,
  })).resolves.toBe(true);
});

describe('statusCode:200', () => {
  it('should have default value for enablePush', async () => {
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
    const enablePush = true; // start enabled
    const enableShowAmounts = false;
    await registerPushDevice(mysql, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    });

    // enablePush should be disabled by default
    const event = makeGatewayEventWithAuthorizer(walletId, null, JSON.stringify({
      deviceId,
      enableShowAmounts: false,
    }));

    const result = await update(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId,
      pushProvider,
      enablePush: false, // default value
      enableShowAmounts,
    })).resolves.toBe(true);
  });

  it('should have default value for enableShowAmounts', async () => {
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
    const enablePush = false;
    const enableShowAmounts = true; // start enabled
    await registerPushDevice(mysql, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    });

    // enableShowAmounts should be disabled by default
    const event = makeGatewayEventWithAuthorizer(walletId, null, JSON.stringify({
      deviceId,
      enablePush,
    }));

    const result = await update(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts: false, // default value
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

    const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({
      deviceId,
      enablePush: false,
      enableShowAmounts: false,
    }));

    const result = await update(event, null, null) as APIGatewayProxyResult;
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

describe('statusCode:404', () => {
  it('should validate deviceId existence', async () => {
    expect.hasAssertions();
    const deviceId = 'device-not-registered';

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
      deviceId,
      enablePush: false,
      enableShowAmounts: false,
    }));

    const result = await update(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(404);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual(ApiError.DEVICE_NOT_FOUND);
  });
});
