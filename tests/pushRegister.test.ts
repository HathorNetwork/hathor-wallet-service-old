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
import { ApiError } from '@src/api/errors';
import { APIGatewayProxyResult } from 'aws-lambda';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('register a device for push notification', async () => {
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

  const result = await register(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);
});

describe('statusCode:200', () => {
  it('should have default value for enablePush', async () => {
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

    const payloadWithoutEnablePush = JSON.stringify({
      deviceId: 'device1',
      pushProvider: 'android',
      enableShowAmounts: false,
    });
    const event = makeGatewayEventWithAuthorizer('my-wallet', null, payloadWithoutEnablePush);

    const result = await register(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);
    await expect(
      checkPushDevicesTable(mysql, 1, {
        walletId: 'my-wallet',
        deviceId: 'device1',
        pushProvider: 'android',
        enablePush: false,
        enableShowAmounts: false,
      }),
    ).resolves.toBe(true);
  });

  it('should have default value for enableShowAmounts', async () => {
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

    const payloadWithoutEnableShowAmounts = JSON.stringify({
      deviceId: 'device1',
      pushProvider: 'android',
      enablePush: true,
    });
    const event = makeGatewayEventWithAuthorizer('my-wallet', null, payloadWithoutEnableShowAmounts);

    const result = await register(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);
    await expect(
      checkPushDevicesTable(mysql, 1, {
        walletId: 'my-wallet',
        deviceId: 'device1',
        pushProvider: 'android',
        enablePush: true,
        enableShowAmounts: false,
      }),
    ).resolves.toBe(true);
  });

  it('should register even if alredy exists (idempotency proof)', async () => {
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

    const payload = JSON.stringify({
      deviceId: 'device1',
      pushProvider: 'android',
      enablePush: true,
      enableShowAmounts: false,
    });
    const event = makeGatewayEventWithAuthorizer('my-wallet', null, payload);

    let result = await register(event, null, null) as APIGatewayProxyResult;
    let returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);

    result = await register(event, null, null) as APIGatewayProxyResult;
    returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(200);
    expect(returnBody.success).toStrictEqual(true);
  });
});

describe('statusCode:400', () => {
  it('should validate provider', async () => {
    expect.hasAssertions();
    const pushProvider = 'not-supported-provider';

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
      pushProvider,
      enablePush: true,
      enableShowAmounts: false,
    }));

    const result = await register(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(400);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual(ApiError.INVALID_PAYLOAD);
    expect(returnBody.details).toMatchInlineSnapshot(`
Array [
  Object {
    "message": "\\"pushProvider\\" with value \\"not-supported-provider\\" fails to match the required pattern: /^(?:ios|android)$/",
    "path": Array [
      "pushProvider",
    ],
  },
]
`);
  });

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
      pushProvider: 'android',
      enablePush: true,
      enableShowAmounts: false,
    }));

    const result = await register(event, null, null) as APIGatewayProxyResult;
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
  it('should validate wallet existence', async () => {
    expect.hasAssertions();

    const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({
      deviceId: 'device1',
      pushProvider: 'android',
      enablePush: true,
      enableShowAmounts: false,
    }));

    const result = await register(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(404);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual(ApiError.WALLET_NOT_FOUND);
  });
});
