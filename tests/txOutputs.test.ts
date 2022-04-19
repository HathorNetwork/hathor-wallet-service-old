import {
  getFilteredTxOutputs,
  getFilteredUtxos,
} from '@src/api/txOutputs';
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

test('filter utxos api with invalid parameters', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[1], 100, 0, null, null, false, null],
    [TX_IDS[2], 0, token1, ADDRESSES[2], 150, 0, null, null, false, null],
    [TX_IDS[2], 1, token1, ADDRESSES[3], 200, 0, null, null, false, null],
  ];

  await addToUtxoTable(mysql, utxos);

  let event = makeGatewayEventWithAuthorizer('my-wallet', {
    biggerThan: 'invalid-parameter',
    smallerThan: 'invalid-parameter',
  }, null);

  let result = await getFilteredUtxos(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(400);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.details).toHaveLength(2);
  expect(returnBody.error).toStrictEqual(ApiError.INVALID_PAYLOAD);

  // Should complain about missing index

  event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: TX_IDS[0],
  }, null);

  result = await getFilteredUtxos(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(400);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.details[0].message).toStrictEqual('"value" contains [txId] without its required peers [index]');

  // tx_output not found should return an empty list

  event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: TX_IDS[3],
    index: '0', // queryparams expects a string
  }, null);

  result = await getFilteredUtxos(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);
  expect(returnBody.utxos).toStrictEqual([]);

  // Utxo not from user's wallet

  event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: TX_IDS[2],
    index: '1',
  }, null);

  result = await getFilteredUtxos(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(403);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.error).toStrictEqual(ApiError.TX_OUTPUT_NOT_IN_WALLET);
});

test('filter tx_output api with invalid parameters', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[1], 100, 0, null, null, false, null],
    [TX_IDS[2], 0, token1, ADDRESSES[2], 150, 0, null, null, false, null],
    [TX_IDS[2], 1, token1, ADDRESSES[3], 200, 0, null, null, false, null],
  ];

  await addToUtxoTable(mysql, utxos);

  let event = makeGatewayEventWithAuthorizer('my-wallet', {
    biggerThan: 'invalid-parameter',
    smallerThan: 'invalid-parameter',
  }, null);

  let result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(400);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.details).toHaveLength(2);
  expect(returnBody.error).toStrictEqual(ApiError.INVALID_PAYLOAD);

  // Should complain about missing index

  event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: TX_IDS[0],
  }, null);

  result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(400);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.details[0].message).toStrictEqual('"value" contains [txId] without its required peers [index]');

  event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: TX_IDS[3],
    index: '0', // queryparams expects a string
  }, null);

  // tx_output not found should return an empty list

  result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(200);
  expect(returnBody.success).toStrictEqual(true);
  expect(returnBody.txOutputs).toStrictEqual([]);

  // Utxo not from user's wallet

  event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: TX_IDS[2],
    index: '1',
  }, null);

  result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(403);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.error).toStrictEqual(ApiError.TX_OUTPUT_NOT_IN_WALLET);
});

test('get utxos with wallet id', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[0], 100, 0, null, null, false, null],
    [TX_IDS[2], 0, token1, ADDRESSES[1], 150, 0, null, null, false, null],
    [TX_IDS[2], 1, token1, ADDRESSES[0], 200, 0, null, null, false, null],
  ];

  await addToUtxoTable(mysql, utxos);

  const event = makeGatewayEventWithAuthorizer('my-wallet', {
    tokenId: token1,
    biggerThan: '50',
    smallerThan: '200',
  }, null);

  const result = await getFilteredUtxos(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  const formatUtxo = (utxo, path) => ({
    txId: utxo[0],
    index: utxo[1],
    tokenId: utxo[2],
    address: utxo[3],
    value: utxo[4],
    authorities: utxo[5],
    timelock: utxo[6],
    heightlock: utxo[7],
    locked: utxo[8],
    addressPath: `m/44'/280'/0'/0/${path}`,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.utxos).toHaveLength(2);
  expect(returnBody.utxos[0]).toStrictEqual(formatUtxo(utxos[2], 1));
  expect(returnBody.utxos[1]).toStrictEqual(formatUtxo(utxos[1], 0));
});

test('get tx outputs with wallet id', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[0], 100, 0, null, null, false, null],
    [TX_IDS[2], 0, token1, ADDRESSES[1], 150, 0, null, null, false, null],
    [TX_IDS[2], 1, token1, ADDRESSES[0], 200, 0, null, null, false, null],
  ];

  await addToUtxoTable(mysql, utxos);

  const event = makeGatewayEventWithAuthorizer('my-wallet', {
    tokenId: token1,
    biggerThan: '50',
    smallerThan: '200',
  }, null);

  const result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  const formatUtxo = (utxo, path) => ({
    txId: utxo[0],
    index: utxo[1],
    tokenId: utxo[2],
    address: utxo[3],
    value: utxo[4],
    authorities: utxo[5],
    timelock: utxo[6],
    heightlock: utxo[7],
    locked: utxo[8],
    addressPath: `m/44'/280'/0'/0/${path}`,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txOutputs).toHaveLength(2);
  expect(returnBody.txOutputs[0]).toStrictEqual(formatUtxo(utxos[2], 1));
  expect(returnBody.txOutputs[1]).toStrictEqual(formatUtxo(utxos[1], 0));
});

test('get authority utxos', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 0, 1, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[0], 0, 2, null, null, false, null],
    [TX_IDS[2], 0, token1, ADDRESSES[1], 0, 1, null, null, false, null],
    [TX_IDS[2], 1, token1, ADDRESSES[0], 0, 1, null, null, false, null],
    [TX_IDS[3], 0, token1, ADDRESSES[0], 150, 0, null, null, false, null],
  ];

  await addToUtxoTable(mysql, utxos);

  const formatUtxo = (utxo, path) => ({
    txId: utxo[0],
    index: utxo[1],
    tokenId: utxo[2],
    address: utxo[3],
    value: utxo[4],
    authorities: utxo[5],
    timelock: utxo[6],
    heightlock: utxo[7],
    locked: utxo[8],
    addressPath: `m/44'/280'/0'/0/${path}`,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });

  let event = makeGatewayEventWithAuthorizer('my-wallet', {
    tokenId: token1,
    authority: '1', // Only mint authorities
  }, null);

  let result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txOutputs).toHaveLength(3);
  expect(returnBody.txOutputs[0]).toStrictEqual(formatUtxo(utxos[0], 0));
  expect(returnBody.txOutputs[1]).toStrictEqual(formatUtxo(utxos[2], 1));
  expect(returnBody.txOutputs[2]).toStrictEqual(formatUtxo(utxos[3], 0));

  event = makeGatewayEventWithAuthorizer('my-wallet', {
    tokenId: token1,
    authority: '3', // Mint and melt authorities
  }, null);

  result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txOutputs).toHaveLength(4);
});

test('get a specific utxo', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[0], 100, 0, null, null, false, null],
    [TX_IDS[2], 0, token1, ADDRESSES[1], 150, 0, null, null, false, null],
    [TX_IDS[2], 1, token1, ADDRESSES[0], 200, 0, null, null, false, null],
  ];

  await addToUtxoTable(mysql, utxos);

  const event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: TX_IDS[0],
    index: '0',
  }, null);

  const result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  const formatUtxo = (utxo, path) => ({
    txId: utxo[0],
    index: utxo[1],
    tokenId: utxo[2],
    address: utxo[3],
    value: utxo[4],
    authorities: utxo[5],
    timelock: utxo[6],
    heightlock: utxo[7],
    locked: utxo[8],
    txProposalId: null,
    txProposalIndex: null,
    addressPath: `m/44'/280'/0'/0/${path}`,
    spentBy: null,
  });

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txOutputs).toHaveLength(1);
  expect(returnBody.txOutputs[0]).toStrictEqual(formatUtxo(utxos[0], 0));
});

test('get utxos from addresses that are not my own should fail with ApiError.ADDRESS_NOT_IN_WALLET', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'other-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const utxos = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[0], 100, 0, null, null, false, null],
    [TX_IDS[2], 0, token1, ADDRESSES[1], 150, 0, null, null, false, null],
    [TX_IDS[2], 1, token1, ADDRESSES[1], 200, 0, null, null, false, null],
  ];

  await addToUtxoTable(mysql, utxos);

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, null, {
    addresses: [ADDRESSES[1]],
  });

  const result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toStrictEqual(ApiError.ADDRESS_NOT_IN_WALLET);
});

test('get spent tx_output', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'auth_xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 4,
  }, {
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 4,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';

  const txOutputs = [
    [TX_IDS[0], 0, token1, ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, token1, ADDRESSES[0], 100, 0, null, null, false, '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50'],
  ];

  await addToUtxoTable(mysql, txOutputs);

  const event = makeGatewayEventWithAuthorizer('my-wallet', {
    tokenId: token1,
    skipSpent: 'false', // should include TX_IDS[1]
  }, null);
  const result = await getFilteredTxOutputs(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  const formatTxOutput = (txOutput, path) => ({
    txId: txOutput[0],
    index: txOutput[1],
    tokenId: txOutput[2],
    address: txOutput[3],
    value: txOutput[4],
    authorities: txOutput[5],
    timelock: txOutput[6],
    heightlock: txOutput[7],
    locked: txOutput[8],
    txProposalId: null,
    txProposalIndex: null,
    addressPath: `m/44'/280'/0'/0/${path}`,
    spentBy: txOutput[9],
  });

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txOutputs).toHaveLength(2);
  expect(returnBody.txOutputs[0]).toStrictEqual(formatTxOutput(txOutputs[1], 0));
  expect(returnBody.txOutputs[1]).toStrictEqual(formatTxOutput(txOutputs[0], 0));
});
