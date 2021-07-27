import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import { get as addressesGet } from '@src/api/addresses';
import { get as newAddressesGet } from '@src/api/newAddresses';
import { get as balancesGet } from '@src/api/balances';
import { get as txHistoryGet } from '@src/api/txhistory';
import { get as walletGet, load as walletLoad } from '@src/api/wallet';
import { ApiError } from '@src/api/errors';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
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
  makeGatewayEventWithAuthorizer,
} from '@tests/utils';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

const _testInvalidPayload = async (fn: APIGatewayProxyHandler, errorMessages: string[] = [], walletId: string, params = {}) => {
  const event = makeGatewayEventWithAuthorizer(walletId, params);
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);

  const messages = returnBody.details.map((detail) => detail.message);

  expect(messages).toHaveLength(errorMessages.length);
  expect(messages).toStrictEqual(errorMessages);
};

const _testMissingWallet = async (fn: APIGatewayProxyHandler, walletId: string, body = null) => {
  const event = makeGatewayEventWithAuthorizer(walletId, {}, body && JSON.stringify(body));
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(404);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_NOT_FOUND);
};

const _testWalletNotReady = async (fn: APIGatewayProxyHandler) => {
  const walletId = 'wallet-not-started';
  await addToWalletTable(mysql, [[walletId, 'aaaa', 'creating', 5, 10000, null]]);
  const event = makeGatewayEventWithAuthorizer(walletId, {});
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
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

  // TODO: test missing walletId?
  // Authorizer should be responsible for this

  // missing wallet
  await _testMissingWallet(addressesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(addressesGet);

  // success case
  const event = makeGatewayEventWithAuthorizer('my-wallet', {});
  const result = await addressesGet(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.addresses).toHaveLength(2);
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[0], index: 0, transactions: 0 });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[1], index: 1, transactions: 0 });
});

test('GET /addresses/new', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [
    { address: ADDRESSES[0], index: 0, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[1], index: 1, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[2], index: 2, walletId: 'my-wallet', transactions: 2 },
    { address: ADDRESSES[3], index: 3, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[4], index: 4, walletId: 'my-wallet', transactions: 3 },
    { address: ADDRESSES[5], index: 5, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[6], index: 6, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[7], index: 7, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[8], index: 8, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[9], index: 0, walletId: null, transactions: 0 },
    { address: ADDRESSES[10], index: 0, walletId: 'test', transactions: 0 },
  ]);

  // missing wallet
  await _testMissingWallet(newAddressesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(newAddressesGet);

  // success case
  const event = makeGatewayEventWithAuthorizer('my-wallet', {});
  const result = await newAddressesGet(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.addresses).toHaveLength(4);
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[5], index: 5, addressPath: "m/44'/280'/0'/0/5" });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[6], index: 6, addressPath: "m/44'/280'/0'/0/6" });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[7], index: 7, addressPath: "m/44'/280'/0'/0/7" });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[8], index: 8, addressPath: "m/44'/280'/0'/0/8" });
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

  // missing wallet
  await _testMissingWallet(balancesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(balancesGet);

  // success but no balances
  let event = makeGatewayEventWithAuthorizer('my-wallet', {});
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
  event = makeGatewayEventWithAuthorizer('my-wallet', {});
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
  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: 'token1' });
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
  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: 'token3' });
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
  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: 'token4' });
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

  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: '00' });
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
  await addToWalletTxHistoryTable(mysql, [
    ['my-wallet', 'tx1', '00', 5, 1000, false],
    ['my-wallet', 'tx1', 'token2', '7', 1000, false],
    ['my-wallet', 'tx2', '00', 7, 1001, false],
    ['my-wallet', 'tx2', 'token3', 7, 1001, true],
  ]);

  // missing wallet
  await _testMissingWallet(txHistoryGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(txHistoryGet);

  // invalid 'skip' param
  await _testInvalidPayload(txHistoryGet, ['"skip" must be a number'], 'my-wallet', { skip: 'aaa' });

  // invalid 'count' param
  await _testInvalidPayload(txHistoryGet, ['"count" must be a number'], 'my-wallet', { count: 'aaa' });

  // without token in parameters, use htr
  let event = makeGatewayEventWithAuthorizer('my-wallet', {});
  let result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.history).toHaveLength(2);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 5, voided: 0 });
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7, voided: 0 });

  // with count just 1, return only the most recent tx
  event = makeGatewayEventWithAuthorizer('my-wallet', { count: '1' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.count).toBe(1);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7, voided: 0 });

  // skip first item
  event = makeGatewayEventWithAuthorizer('my-wallet', { skip: '1' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.skip).toBe(1);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 5, voided: 0 });

  // use other token id
  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: 'token2' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 7, voided: 0 });

  // it should also return voided transactions
  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: 'token3' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7, voided: 1 });
});

test('GET /wallet', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);

  // missing wallet
  await _testMissingWallet(walletGet, 'some-wallet');

  // get all balances
  const event = makeGatewayEventWithAuthorizer('my-wallet', null);
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
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);

  event = makeGatewayEvent({}, 'aaa');
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toStrictEqual('"value" must be of type object');

  // missing xpubkey
  event = makeGatewayEvent({}, JSON.stringify({ param1: 'aaa', firstAddress: 'a' }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(2);
  expect(returnBody.details[0].message).toStrictEqual('"xpubkey" is required');
  expect(returnBody.details[1].message).toStrictEqual('"param1" is not allowed');

  // Wrong first address
  event = makeGatewayEvent({}, JSON.stringify({ xpubkey: XPUBKEY, firstAddress: 'a' }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.message).toStrictEqual('Expected first address to be a but it is HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci');

  // Load success
  event = makeGatewayEvent({}, JSON.stringify({ xpubkey: XPUBKEY, firstAddress: 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci' }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  expect(result.statusCode).toBe(200);

  // already loaded
  event = makeGatewayEvent({}, JSON.stringify({ xpubkey: XPUBKEY, firstAddress: 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci' }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_ALREADY_LOADED);
});
