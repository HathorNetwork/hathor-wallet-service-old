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
  addToTokenTable,
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

test('get a transaction given its ID', async () => {
  expect.hasAssertions();
  const txId1 = new Array(64).fill('0').join('');
  const walletId1 = 'wallet1';
  const addr1 = 'addr1';
  const token1 = { id: 'token1', name: 'Token 1', symbol: 'T1' };
  const token2 = { id: 'token2', name: 'Token 2', symbol: 'T2' };
  const timestamp1 = 10;
  const height1 = 1;
  const version1 = 3;
  const weight1 = 65.4321;

  await createWallet(mysql, walletId1, XPUBKEY, AUTH_XPUBKEY, 5);
  await addOrUpdateTx(mysql, txId1, height1, timestamp1, version1, weight1);

  await addToTokenTable(mysql, [
    { id: token1.id, name: token1.name, symbol: token1.symbol, transactions: 0 },
    { id: token2.id, name: token2.name, symbol: token2.symbol, transactions: 0 },
  ]);
  const entries = [
    { address: addr1, txId: txId1, tokenId: token1.id, balance: 10, timestamp: timestamp1 },
    { address: addr1, txId: txId1, tokenId: token2.id, balance: 7, timestamp: timestamp1 },
  ];
  await addToAddressTxHistoryTable(mysql, entries);
  await initWalletTxHistory(mysql, walletId1, [addr1]);

  const event = makeGatewayEventWithAuthorizer(walletId1, {
    txId: txId1,
  }, null);

  const result = await get(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);
  expect(returnBody.txTokens).toHaveLength(2);
  expect(returnBody.txTokens).toStrictEqual([
    {
      balance: 10,
      timestamp: 10,
      tokenId: token1.id,
      tokenName: token1.name,
      tokenSymbol: token1.symbol,
      txId: txId1,
      version: 3,
      voided: false,
      weight: 65.4321,
    },
    {
      balance: 7,
      timestamp: 10,
      tokenId: token2.id,
      tokenName: token2.name,
      tokenSymbol: token2.symbol,
      txId: txId1,
      version: 3,
      voided: false,
      weight: 65.4321,
    },
  ]);
});

describe('statusCode:400', () => {
  it('should validate txId', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const event = makeGatewayEventWithAuthorizer(walletId, {
      txId: '', // must be string
    }, null);

    const result = await get(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(400);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual(ApiError.INVALID_PAYLOAD);
    expect(returnBody.details).toMatchInlineSnapshot(`
Array [
  Object {
    "message": "\\"txId\\" is not allowed to be empty",
    "path": Array [
      "txId",
    ],
  },
]
`);
  });
});

describe('statusCode:404', () => {
  it('should validate tx existence', async () => {
    expect.hasAssertions();
    const txIdNotRegistered = new Array(64).fill('0').join('');

    await addOrUpdateTx(mysql, 'txId1', 1, 2, 3, 65.4321);

    const walletId = 'wallet1';
    const event = makeGatewayEventWithAuthorizer(walletId, {
      txId: txIdNotRegistered,
    }, null);

    const result = await get(event, null, null) as APIGatewayProxyResult;
    const returnBody = JSON.parse(result.body as string);

    expect(result.statusCode).toStrictEqual(404);
    expect(returnBody.success).toStrictEqual(false);
    expect(returnBody.error).toStrictEqual(ApiError.TX_NOT_FOUND);
    expect(returnBody.details).toBeUndefined();
  });
});
