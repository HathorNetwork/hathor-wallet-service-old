import {
  get,
} from '@src/api/txById';
import { closeDbConnection, getDbConnection } from '@src/utils';
import { addOrUpdateTx, createWallet, initWalletTxHistory } from '@src/db';
import {
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
  XPUBKEY,
  AUTH_XPUBKEY,
  addToAddressTxHistoryTable,
} from '@tests/utils';
import { APIGatewayProxyResult } from 'aws-lambda';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('get a transaction given its ID', async () => {
  expect.hasAssertions();
  const txId1 = 'txId1';
  const walletId1 = 'wallet1';
  const addr1 = 'addr1';
  const token1 = 'token1';
  const token2 = 'token2';
  const timestamp1 = 10;
  const height1 = 1;
  const version1 = 3;
  const weight1 = 65.4321;

  await createWallet(mysql, walletId1, XPUBKEY, AUTH_XPUBKEY, 5);
  await addOrUpdateTx(mysql, txId1, height1, timestamp1, version1, weight1);

  const entries = [
    { address: addr1, txId: txId1, tokenId: token1, balance: 10, timestamp: timestamp1 },
    { address: addr1, txId: txId1, tokenId: token2, balance: 7, timestamp: timestamp1 },
  ];
  await addToAddressTxHistoryTable(mysql, entries);
  await initWalletTxHistory(mysql, walletId1, [addr1]);

  const event = makeGatewayEventWithAuthorizer(walletId1, null, {
    txId: txId1,
  });

  const result = await get(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);
  expect(returnBody.tx).toHaveLength(2);
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
