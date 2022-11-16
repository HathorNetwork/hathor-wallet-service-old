import {
  get,
} from '@src/api/txById';
import { closeDbConnection, getDbConnection } from '@src/utils';
import { addOrUpdateTx } from '@src/db';
import {
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
} from '@tests/utils';
import { APIGatewayProxyResult } from 'aws-lambda';
import exp from 'constants';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('get a transaction given its ID', async () => {
  expect.hasAssertions();
  const txId = 'tx1';

  await addOrUpdateTx(mysql, txId, 1, 2, 3, 65.4321);
  // register a wallet
  const walletId = 'wallet1';

  const event = makeGatewayEventWithAuthorizer(walletId, null, {
    txId,
  });

  const result = await get(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);
  expect(returnBody.tx).toStrictEqual({
    txId,
    height: 1,
    timestamp: 2,
    version: 3,
    voided: false,
    weight: 65.4321,
  });
});

describe('statusCode:400', () => {
  it('should validate txId', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const event = makeGatewayEventWithAuthorizer(walletId, null, {
      txId: 1, // must be string
    });

    const result = await get(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(400);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual('invalid-payload');
  });
});

describe('statusCode:404', () => {
  it('should validate tx existence', async () => {
    expect.hasAssertions();

    await addOrUpdateTx(mysql, 'txId1', 1, 2, 3, 65.4321);

    const walletId = 'wallet1';
    const event = makeGatewayEventWithAuthorizer(walletId, null, {
      txId: 'tx-not-found',
    });

    const result = await get(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(404);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual('tx-not-found');
  });
});
