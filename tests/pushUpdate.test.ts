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
  const enableOnlyNewTx = false;
  await registerPushDevice(mysql, {
    walletId,
    deviceId,
    pushProvider,
    enablePush,
    enableShowAmounts,
    enableOnlyNewTx,
  });

  const event = makeGatewayEventWithAuthorizer(walletId, null, {
    deviceId,
    enablePush: true, // enables push notification
    enableShowAmounts: false,
  });

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
    enableOnlyNewTx,
  })).resolves.toBe(true);
});
