import {
  register,
} from '@src/api/pushRegister';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToWalletTable,
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
} from '@tests/utils';
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

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, {
    deviceId: 'device1',
    pushProvider: 'android',
    enablePush: true,
    enableShowAmounts: false,
  });

  const result = await register(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);
});