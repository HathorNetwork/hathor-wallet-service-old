import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import { get as addressesGet } from '@src/api/addresses';
import { get as balancesGet } from '@src/api/balances';
import { get as txHistoryGet } from '@src/api/txhistory';
import { create as txProposalCreate } from '@src/api/txProposalCreate';
import { get as walletGet, load as walletLoad } from '@src/api/wallet';
import { ApiError } from '@src/api/errors';
import { closeDbConnection, getDbConnection, getUnixTimestamp, getWalletId } from '@src/utils';
import {
  ADDRESSES,
  XPUBKEY,
  addToAddressTable,
  addToAddressBalanceTable,
  addToTokenTable,
  addToUtxoTable,
  addToWalletBalanceTable,
  addToWalletTable,
  addToWalletTxHistoryTable,
  cleanDatabase,
  makeGatewayEvent,
} from '@tests/utils';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

const _testMissingParam = async (fn: APIGatewayProxyHandler, paramName: string, params = {}) => {
  const event = makeGatewayEvent(params);
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.MISSING_PARAMETER);
  expect(returnBody.parameter).toBe(paramName);
};

const _testInvalidParam = async (fn: APIGatewayProxyHandler, paramName: string, params) => {
  const event = makeGatewayEvent(params);
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PARAMETER);
  expect(returnBody.parameter).toBe(paramName);
};

const _testMissingWallet = async (fn: APIGatewayProxyHandler, walletId: string, body = null) => {
  const event = makeGatewayEvent({ id: walletId }, JSON.stringify(body));
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_NOT_FOUND);
};

const _testWalletNotReady = async (fn: APIGatewayProxyHandler) => {
  const walletId = 'wallet-not-started';
  await addToWalletTable(mysql, [[walletId, 'aaaa', 'creating', 5, 10000, null]]);
  const event = makeGatewayEvent({ id: walletId });
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_NOT_READY);
};

test('GET /addresses', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [
    { address: ADDRESSES[0], index: 0, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[1], index: 1, walletId: 'my-wallet', transactions: 0 },
  ]);

  // missing param
  await _testMissingParam(addressesGet, 'id');

  // missing wallet
  await _testMissingWallet(addressesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(addressesGet);

  // success case
  const event = makeGatewayEvent({ id: 'my-wallet' });
  const result = await addressesGet(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.addresses).toHaveLength(2);
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[0], index: 0, transactions: 0 });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[1], index: 1, transactions: 0 });
});

test('GET /balances', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);

  // add tokens
  const token1 = { id: 'token1', name: 'MyToken1', symbol: 'MT1' };
  const token2 = { id: 'token2', name: 'MyToken2', symbol: 'MT2' };
  const token3 = { id: 'token3', name: 'MyToken3', symbol: 'MT3' };
  const token4 = { id: 'token4', name: 'MyToken4', symbol: 'MT4' };
  await addToTokenTable(mysql, [
    { id: token1.id, name: token1.name, symbol: token1.symbol },
    { id: token2.id, name: token2.name, symbol: token2.symbol },
    { id: token3.id, name: token3.name, symbol: token3.symbol },
    { id: token4.id, name: token4.name, symbol: token4.symbol },
  ]);

  // missing param
  await _testMissingParam(balancesGet, 'id');

  // missing wallet
  await _testMissingWallet(balancesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(balancesGet);

  // success but no balances
  let event = makeGatewayEvent({ id: 'my-wallet' });
  let result = await balancesGet(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.balances).toHaveLength(0);

  // add 2 balances
  const lockExpires = getUnixTimestamp() + 200;
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 10,
    lockedBalance: 0,
    unlockedAuthorities: 0b01,
    lockedAuthorities: 0b10,
    timelockExpires: null,
    transactions: 3,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 3,
    lockedBalance: 2,
    unlockedAuthorities: 0b00,
    lockedAuthorities: 0b11,
    timelockExpires: lockExpires,
    transactions: 1,
  }]);

  // get all balances
  event = makeGatewayEvent({ id: 'my-wallet' });
  result = await balancesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.balances).toHaveLength(2);
  expect(returnBody.balances).toContainEqual({
    token: token1,
    transactions: 3,
    balance: { unlocked: 10, locked: 0 },
    lockExpires: null,
    tokenAuthorities: { unlocked: { mint: true, melt: false }, locked: { mint: false, melt: true } },
  });
  expect(returnBody.balances).toContainEqual({
    token: token2,
    transactions: 1,
    balance: { unlocked: 3, locked: 2 },
    lockExpires,
    tokenAuthorities: { unlocked: { mint: false, melt: false }, locked: { mint: true, melt: true } },
  });

  // get token1 balance
  event = makeGatewayEvent({ id: 'my-wallet', token_id: 'token1' });
  result = await balancesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.balances).toHaveLength(1);
  expect(returnBody.balances).toContainEqual({
    token: token1,
    transactions: 3,
    balance: { unlocked: 10, locked: 0 },
    lockExpires: null,
    tokenAuthorities: { unlocked: { mint: true, melt: false }, locked: { mint: false, melt: true } },
  });

  // balance that needs to be refreshed
  const lockExpires2 = getUnixTimestamp() - 200;
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);
  await addToAddressBalanceTable(mysql, [[ADDRESSES[0], 'token3', 5, 1, lockExpires2, 2, 0, 0]]);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token3',
    unlockedBalance: 5,
    lockedBalance: 1,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: lockExpires2,
    transactions: 2,
  }]);
  await addToUtxoTable(mysql, [['txId', 0, 'token3', ADDRESSES[0], 1, 0, lockExpires2, null, true]]);
  event = makeGatewayEvent({ id: 'my-wallet', token_id: 'token3' });
  result = await balancesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.balances).toHaveLength(1);
  expect(returnBody.balances).toContainEqual({
    token: token3,
    transactions: 2,
    balance: { unlocked: 6, locked: 0 },
    lockExpires: null,
    tokenAuthorities: { unlocked: { mint: false, melt: false }, locked: { mint: false, melt: false } },
  });

  // balance that needs to be refreshed, but there's another locked utxo in the future
  await addToAddressBalanceTable(mysql, [[ADDRESSES[0], 'token4', 10, 5, lockExpires2, 3, 0, 0]]);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token4',
    unlockedBalance: 10,
    lockedBalance: 5,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: lockExpires2,
    transactions: 3,
  }]);
  await addToUtxoTable(mysql, [
    ['txId2', 0, 'token4', ADDRESSES[0], 3, 0, lockExpires2, null, true],
    ['txId3', 0, 'token4', ADDRESSES[0], 2, 0, lockExpires, null, true],
  ]);
  event = makeGatewayEvent({ id: 'my-wallet', token_id: 'token4' });
  result = await balancesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.balances).toHaveLength(1);
  expect(returnBody.balances).toContainEqual({
    token: token4,
    transactions: 3,
    balance: { unlocked: 13, locked: 2 },
    lockExpires,
    tokenAuthorities: { unlocked: { mint: false, melt: false }, locked: { mint: false, melt: false } },
  });

  // add HTR balance
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: '00',
    unlockedBalance: 10,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 3,
  }]);

  event = makeGatewayEvent({ id: 'my-wallet', token_id: '00' });
  result = await balancesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.balances).toHaveLength(1);
  expect(returnBody.balances).toContainEqual({
    token: { id: '00', name: 'Hathor', symbol: 'HTR' },
    transactions: 3,
    balance: { unlocked: 10, locked: 0 },
    lockExpires: null,
    tokenAuthorities: { unlocked: { mint: false, melt: false }, locked: { mint: false, melt: false } },
  });
});

test('GET /txhistory', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToWalletTxHistoryTable(mysql, [['my-wallet', 'tx1', '00', 5, 1000], ['my-wallet', 'tx1', 'token2', '7', 1000], ['my-wallet', 'tx2', '00', 7, 1001]]);

  // missing param
  await _testMissingParam(txHistoryGet, 'id');

  // missing wallet
  await _testMissingWallet(txHistoryGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(txHistoryGet);

  // invalid 'skip' param
  await _testInvalidParam(txHistoryGet, 'skip', { id: 'my-wallet', skip: 'aaa' });

  // invalid 'count' param
  await _testInvalidParam(txHistoryGet, 'count', { id: 'my-wallet', count: 'aaa' });

  // without token in parameters, use htr
  let event = makeGatewayEvent({ id: 'my-wallet' });
  let result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.history).toHaveLength(2);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 5 });
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7 });

  // with count just 1, return only the most recent tx
  event = makeGatewayEvent({ id: 'my-wallet', count: '1' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.count).toBe(1);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7 });

  // skip first item
  event = makeGatewayEvent({ id: 'my-wallet', skip: '1' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.skip).toBe(1);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 5 });

  // use other token id
  event = makeGatewayEvent({ id: 'my-wallet', token_id: 'token2' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 7 });
});

test('GET /wallet', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);

  // missing param
  await _testMissingParam(walletGet, 'id');

  // missing wallet
  await _testMissingWallet(walletGet, 'some-wallet');

  // get all balances
  const event = makeGatewayEvent({ id: 'my-wallet' });
  const result = await walletGet(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.status).toStrictEqual({ walletId: 'my-wallet', xpubkey: 'xpubkey', status: 'ready', maxGap: 5, createdAt: 10000, readyAt: 10001 });
});

test('POST /wallet', async () => {
  expect.hasAssertions();

  // invalid body
  let event = makeGatewayEvent({});
  let result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PARAMETER);
  expect(returnBody.parameter).toBe('xpubkey');

  event = makeGatewayEvent({}, 'aaa');
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PARAMETER);
  expect(returnBody.parameter).toBe('xpubkey');

  // missing xpubkey
  event = makeGatewayEvent({}, JSON.stringify({ param1: 'aaa' }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.MISSING_PARAMETER);
  expect(returnBody.parameter).toBe('xpubkey');

  // already loaded
  const walletId = getWalletId(XPUBKEY);
  await addToWalletTable(mysql, [[walletId, XPUBKEY, 'ready', 5, 10000, 10001]]);
  event = makeGatewayEvent({}, JSON.stringify({ xpubkey: XPUBKEY }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_ALREADY_LOADED);
});

test('POST /txproposals params validation', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: 'address',
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  // invalid body
  let event = makeGatewayEvent({ id: 'my-wallet' });
  let result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);

  event = makeGatewayEvent({ id: 'my-wallet' }, 'aaa');
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);

  // missing id
  event = makeGatewayEvent(null, '{}');
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(2); // id and outputs are required parameters
  expect(returnBody.details[0].message).toStrictEqual('"id" is required');
  expect(returnBody.details[1].message).toStrictEqual('"outputs" is required');

  // missing outputs
  event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet' }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toStrictEqual('"outputs" is required');

  // empty outputs
  event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs: [] }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toStrictEqual('"outputs" must contain at least 1 items');

  // invalid outputs
  event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [{ address: ADDRESSES[0], value: '10', token: 'token', timelock: 100000 }],
  }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toStrictEqual('"outputs[0].value" must be a number');

  // invalid outputs 2
  event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [{
      address: ADDRESSES[0],
      value: 10,
      token: 'token',
      timelock: '1005',
    }],
  }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toStrictEqual('"outputs[0].timelock" must be a number');

  // invalid inputs
  event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [{ address: ADDRESSES[0], value: 10, token: 'token1', timelock: 100000 }],
    inputs: [{ txId: 'txId', index: '0' }],
  }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(2);
  expect(returnBody.details[0].message).toStrictEqual('"inputs[0].index" must be a number');
  expect(returnBody.details[1].message).toStrictEqual('"inputs" does not contain 1 required value(s)');

  // invalid inputs 2
  event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [{ address: ADDRESSES[0], value: 10, token: 'token1', timelock: 100000 }],
    inputs: [{ txId: 'txId' }],
  }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(2);
  expect(returnBody.details[0].message).toStrictEqual('"inputs[0].index" is required');
  expect(returnBody.details[1].message).toStrictEqual('"inputs" does not contain 1 required value(s)');

  // missing wallet
  event = makeGatewayEvent(null, JSON.stringify({ id: 'other-wallet', outputs: [{ address: ADDRESSES[0], value: 10, token: 'token', timelock: 100000 }] }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_NOT_FOUND);
});

test('POST /txproposals inputs error', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  // insufficient funds
  await addToTokenTable(mysql, [{
    id: 'token1',
    name: 'MyToken1',
    symbol: 'MTK1',
  }]);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 10,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 3,
  }]);

  let event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs: [{ address: ADDRESSES[0], value: 20, token: 'token1', timelock: 100000 }] }));
  let result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INSUFFICIENT_FUNDS);
  expect(returnBody.insufficient[0]).toStrictEqual({ tokenId: 'token1', requested: 20, available: 10 });

  // too many inputs
  await addToTokenTable(mysql, [{
    id: 'token2',
    name: 'MyToken2',
    symbol: 'MTK2',
  }]);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 300,
  }]);

  const utxos = [];
  for (let i = 0; i < 300; i++) {
    utxos.push([`tx${i}`, 0, 'token2', ADDRESSES[0], 1, 0, null, null, false]);
  }
  await addToUtxoTable(mysql, utxos);
  event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs: [{ address: ADDRESSES[0], value: 300, token: 'token2', timelock: 100000 }] }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.TOO_MANY_INPUTS);
  expect(returnBody.inputs).toBe(300);

  // inputs not found
  event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [{ address: ADDRESSES[0], value: 10, token: 'token1', timelock: 100000 }],
    inputs: [{ txId: 'txId', index: 0 }],
  }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INPUTS_NOT_FOUND);
  expect(returnBody.missing).toStrictEqual([{ txId: 'txId', index: 0 }]);

  // insufficient inputs (sent by user)
  event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [{ address: ADDRESSES[0], value: 10, token: 'token2', timelock: 100000 }],
    inputs: [{ txId: 'tx0', index: 0 }],
  }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INSUFFICIENT_INPUTS);
  expect(returnBody.insufficient[0]).toStrictEqual('token2');
});

test('POST /txproposals outputs error', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  // too many outputs (sent by user)
  let outputs = [];
  for (let i = 0; i < 300; i++) {
    outputs.push({ address: ADDRESSES[0], value: i, token: 'token', timelock: null });
  }
  let event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs }));
  let result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.TOO_MANY_OUTPUTS);
  expect(returnBody.outputs).toBe(outputs.length);

  // too many outputs (after adding change output)
  const utxos = [['txBig', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false]];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 300,
  }]);
  outputs = [];
  for (let i = 0; i < 255; i++) {
    outputs.push({ address: ADDRESSES[0], value: 1, token: 'token2', timelock: null });
  }
  event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs }));
  result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.TOO_MANY_OUTPUTS);
  expect(returnBody.outputs).toBe(outputs.length + 1);
});
