import { getFilteredUtxos } from '@src/api/utxos';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToUtxoTable,
  addToWalletTable,
  addToAddressTable,
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
  ADDRESSES,
  TX_IDS,
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

test('filter utxo api with invalid parameters', async () => {
  expect.hasAssertions();

  const event = makeGatewayEventWithAuthorizer('my-wallet', {
    biggerThan: 'invalid-parameter',
    smallerThan: 'invalid-parameter',
  }, null);

  const result = await getFilteredUtxos(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(400);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.details).toHaveLength(2);
  expect(returnBody.error).toStrictEqual(ApiError.INVALID_PAYLOAD);
});

test('get utxos with wallet id', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false],
    [TX_IDS[1], 0, token1, ADDRESSES[0], 100, 0, null, null, false],
    [TX_IDS[2], 0, token1, ADDRESSES[0], 150, 0, null, null, false],
    [TX_IDS[2], 1, token1, ADDRESSES[0], 200, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);

  const event = makeGatewayEventWithAuthorizer('my-wallet', {
    tokenId: token1,
    biggerThan: '50',
    smallerThan: '200',
  }, null);

  const result = await getFilteredUtxos(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.utxos).toHaveLength(2);
  expect(returnBody.utxos).toStrictEqual([utxos[2], utxos[1]].map((utxo) => ({
    txId: utxo[0],
    index: utxo[1],
    tokenId: utxo[2],
    address: utxo[3],
    value: utxo[4],
    authorities: utxo[5],
    timelock: utxo[6],
    heightlock: utxo[7],
    locked: utxo[8],
  })));
});
