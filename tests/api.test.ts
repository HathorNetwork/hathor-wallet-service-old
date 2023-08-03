import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import { get as addressesGet, checkMine } from '@src/api/addresses';
import { get as newAddressesGet } from '@src/api/newAddresses';
import { get as balancesGet } from '@src/api/balances';
import { get as txHistoryGet } from '@src/api/txhistory';
import { get as walletTokensGet, getTokenDetails } from '@src/api/tokens';
import { get as getVersionDataGet } from '@src/api/version';
import {
  getTransactionById,
  getConfirmationData,
  queryGraphvizNeighbours,
} from '@src/api/fullnodeProxy';
import { create as txProposalCreate } from '@src/api/txProposalCreate';
import { send as txProposalSend } from '@src/api/txProposalSend';
import { destroy as txProposalDestroy } from '@src/api/txProposalDestroy';
import { getFilteredUtxos, getFilteredTxOutputs } from '@src/api/txOutputs';
import {
  get as walletGet,
  load as walletLoad,
  loadWallet,
  changeAuthXpub,
} from '@src/api/wallet';
import {
  updateVersionData,
} from '@src/db';
import * as Wallet from '@src/api/wallet';
import * as Db from '@src/db';
import { ApiError } from '@src/api/errors';
import { closeDbConnection, getDbConnection, getUnixTimestamp, getWalletId } from '@src/utils';
import { STATUS_CODE_TABLE } from '@src/api/utils';
import { WalletStatus, FullNodeVersionData } from '@src/types';
import { walletUtils, constants, network, HathorWalletServiceWallet } from '@hathor/wallet-lib';
import bitcore from 'bitcore-lib';
import {
  ADDRESSES,
  TX_IDS,
  XPUBKEY,
  AUTH_XPUBKEY,
  TEST_SEED,
  addToAddressTable,
  addToAddressBalanceTable,
  addToAddressTxHistoryTable,
  addToTokenTable,
  addToUtxoTable,
  addToWalletBalanceTable,
  addToWalletTable,
  addToWalletTxHistoryTable,
  addToTransactionTable,
  cleanDatabase,
  makeGatewayEvent,
  makeGatewayEventWithAuthorizer,
  getAuthData,
} from '@tests/utils';
import fullnode from '@src/fullnode';

// Monkey patch bitcore-lib

bitcore.Message.MAGIC_BYTES = Buffer.from('Hathor Signed Message:\n');

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

const _testCORSHeaders = async (fn: APIGatewayProxyHandler, walletId: string, params = {}) => {
  const event = makeGatewayEventWithAuthorizer(walletId, params);
  // This is a hack to force middy to include the CORS headers, we can't know what http method our request
  // uses as it is only defined on serverless.yml
  event.httpMethod = 'XXX';
  const result = await fn(event, null, null) as APIGatewayProxyResult;

  expect(result.headers).toStrictEqual(
    expect.objectContaining({
      'Access-Control-Allow-Origin': '*', // This is the default origin makeGatewayEventWithAuthorizer returns on headers
    }),
  );
};

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
  await addToWalletTable(mysql, [{
    id: walletId,
    xpubkey: 'aaaa',
    authXpubkey: AUTH_XPUBKEY,
    status: 'creating',
    maxGap: 5,
    createdAt: 10000,
    readyAt: null,
  }]);
  const event = makeGatewayEventWithAuthorizer(walletId, {});
  const result = await fn(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_NOT_READY);
};

test('GET /addresses', async () => {
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

  const addresses = [
    { address: ADDRESSES[0], index: 0, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[1], index: 1, walletId: 'my-wallet', transactions: 0 },
  ];

  await addToAddressTable(mysql, addresses);

  // missing wallet
  await _testMissingWallet(addressesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(addressesGet);

  await _testCORSHeaders(addressesGet, 'my-wallet', {});

  // success case
  let event = makeGatewayEventWithAuthorizer('my-wallet', {});
  let result = await addressesGet(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.addresses).toHaveLength(2);
  expect(returnBody.addresses).toContainEqual({
    address: addresses[0].address,
    index: addresses[0].index,
    transactions: addresses[0].transactions,
  });
  expect(returnBody.addresses).toContainEqual({
    address: addresses[1].address,
    index: addresses[1].index,
    transactions: addresses[1].transactions,
  });

  // we should error on invalid index parameter
  event = makeGatewayEventWithAuthorizer('my-wallet', {
    index: '-50',
  });
  result = await addressesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(STATUS_CODE_TABLE[ApiError.INVALID_PAYLOAD]);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message)
    .toMatchInlineSnapshot('"\\"index\\" must be greater than or equal to 0"');

  // we should be able to filter for a specific index
  event = makeGatewayEventWithAuthorizer('my-wallet', {
    index: String(addresses[0].index),
  });
  result = await addressesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.addresses).toHaveLength(1);
  expect(returnBody.addresses).toStrictEqual([{
    address: addresses[0].address,
    index: addresses[0].index,
    transactions: addresses[0].transactions,
  }]);

  // we should receive ApiError.ADDRESS_NOT_FOUND if the address was not found
  event = makeGatewayEventWithAuthorizer('my-wallet', {
    index: '150',
  });
  result = await addressesGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(404);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.ADDRESS_NOT_FOUND);
});

test('GET /addresses/check_mine', async () => {
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

  await addToAddressTable(mysql, [
    { address: ADDRESSES[0], index: 0, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[1], index: 1, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[2], index: 3, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[3], index: 4, walletId: 'my-wallet', transactions: 0 },
  ]);

  // missing wallet
  await _testMissingWallet(newAddressesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(checkMine);

  await _testCORSHeaders(checkMine, 'my-wallet', {});

  // success case

  let event = makeGatewayEventWithAuthorizer('my-wallet', {}, JSON.stringify({
    addresses: [
      ADDRESSES[0],
      ADDRESSES[1],
      ADDRESSES[8],
    ],
  }));
  let result = await checkMine(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(Object.keys(returnBody.addresses)).toHaveLength(3);
  expect(returnBody.addresses).toStrictEqual({
    [ADDRESSES[0]]: true,
    [ADDRESSES[1]]: true,
    [ADDRESSES[8]]: false,
  });

  // validation error, invalid json

  event = makeGatewayEventWithAuthorizer('my-wallet', {}, 'invalid-json');
  result = await checkMine(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toStrictEqual('"value" must be of type object');

  // validation error, addresses shouldn't be empty

  event = makeGatewayEventWithAuthorizer('my-wallet', {}, JSON.stringify({
    addresses: [],
  }));
  result = await checkMine(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toStrictEqual('"addresses" must contain at least 1 items');

  // validation error, invalid address

  event = makeGatewayEventWithAuthorizer('my-wallet', {}, JSON.stringify({
    addresses: [
      'invalid-address',
    ],
  }));
  result = await checkMine(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(2);
  expect(returnBody.details[0].message).toStrictEqual('"addresses[0]" with value "invalid-address" fails to match the required pattern: /^[A-HJ-NP-Za-km-z1-9]*$/');
  expect(returnBody.details[1].message).toStrictEqual('"addresses[0]" length must be at least 34 characters long');
});

test('GET /addresses/new', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    highestUsedIndex: 4,
    createdAt: 10000,
    readyAt: 10001,
  }]);
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

  await _testCORSHeaders(newAddressesGet, 'some-wallet', {});

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

test('GET /addresses/new with no transactions', async () => {
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

  await addToAddressTable(mysql, [
    { address: ADDRESSES[0], index: 0, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[1], index: 1, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[2], index: 2, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[3], index: 3, walletId: 'my-wallet', transactions: 0 },
    { address: ADDRESSES[4], index: 4, walletId: 'my-wallet', transactions: 0 },
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
  expect(returnBody.addresses).toHaveLength(5); // max gap for this wallet is 5
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[0], index: 0, addressPath: "m/44'/280'/0'/0/0" });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[1], index: 1, addressPath: "m/44'/280'/0'/0/1" });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[2], index: 2, addressPath: "m/44'/280'/0'/0/2" });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[3], index: 3, addressPath: "m/44'/280'/0'/0/3" });
  expect(returnBody.addresses).toContainEqual({ address: ADDRESSES[4], index: 4, addressPath: "m/44'/280'/0'/0/4" });
});

test('GET /balances', async () => {
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

  // add the hathor token as it will be deleted by the beforeAll
  const htrToken = { id: '00', name: 'Hathor', symbol: 'HTR' };
  // add tokens
  const token1 = { id: 'token1', name: 'MyToken1', symbol: 'MT1' };
  const token2 = { id: 'token2', name: 'MyToken2', symbol: 'MT2' };
  const token3 = { id: 'token3', name: 'MyToken3', symbol: 'MT3' };
  const token4 = { id: 'token4', name: 'MyToken4', symbol: 'MT4' };
  await addToTokenTable(mysql, [
    { ...htrToken, transactions: 0 },
    { id: token1.id, name: token1.name, symbol: token1.symbol, transactions: 0 },
    { id: token2.id, name: token2.name, symbol: token2.symbol, transactions: 0 },
    { id: token3.id, name: token3.name, symbol: token3.symbol, transactions: 0 },
    { id: token4.id, name: token4.name, symbol: token4.symbol, transactions: 0 },
  ]);

  // missing wallet
  await _testMissingWallet(balancesGet, 'some-wallet');

  // wallet not ready
  await _testWalletNotReady(balancesGet);

  // check CORS headers
  await _testCORSHeaders(balancesGet, 'my-wallet', {});

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
  await addToAddressBalanceTable(mysql, [[ADDRESSES[0], 'token3', 5, 1, lockExpires2, 2, 0, 0, 10]]);
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
  await addToUtxoTable(mysql, [{
    txId: 'txId',
    index: 0,
    tokenId: 'token3',
    address: ADDRESSES[0],
    value: 1,
    authorities: 0,
    timelock: lockExpires2,
    heightlock: null,
    locked: true,
    spentBy: null,
  }]);
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
  await addToAddressBalanceTable(mysql, [[ADDRESSES[0], 'token4', 10, 5, lockExpires2, 3, 0, 0, 30]]);
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
  await addToUtxoTable(mysql, [{
    txId: 'txId2',
    index: 0,
    tokenId: 'token4',
    address: ADDRESSES[0],
    value: 3,
    authorities: 0,
    timelock: lockExpires2,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    txId: 'txId3',
    index: 0,
    tokenId: 'token4',
    address: ADDRESSES[0],
    value: 2,
    authorities: 0,
    timelock: lockExpires,
    heightlock: null,
    locked: true,
    spentBy: null,
  }]);
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

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToWalletTxHistoryTable(mysql, [
    ['my-wallet', 'tx1', '00', 5, 1000, false],
    ['my-wallet', 'tx1', 'token2', '7', 1000, false],
    ['my-wallet', 'tx2', '00', 7, 1001, false],
    ['my-wallet', 'tx2', 'token3', 7, 1001, true],
  ]);
  await addToTransactionTable(mysql, [
    ['tx1', 100, 2, false, null, 60],
    ['tx2', 100, 3, false, null, 60],
  ]);

  // check CORS headers
  await _testCORSHeaders(txHistoryGet, 'my-wallet', {});

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
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 5, voided: 0, version: 2 });
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7, voided: 0, version: 3 });

  // with count just 1, return only the most recent tx
  event = makeGatewayEventWithAuthorizer('my-wallet', { count: '1' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.count).toBe(1);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7, voided: 0, version: 3 });

  // skip first item
  event = makeGatewayEventWithAuthorizer('my-wallet', { skip: '1' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.skip).toBe(1);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 5, voided: 0, version: 2 });

  // use other token id
  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: 'token2' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx1', timestamp: 1000, balance: 7, voided: 0, version: 2 });

  // it should also return voided transactions
  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: 'token3' });
  result = await txHistoryGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.history).toHaveLength(1);
  expect(returnBody.history).toContainEqual({ txId: 'tx2', timestamp: 1001, balance: 7, voided: 1, version: 3 });
});

test('GET /wallet', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: XPUBKEY,
    authXpubkey: AUTH_XPUBKEY,
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);

  // check CORS headers
  await _testCORSHeaders(walletGet, 'some-wallet', {});

  // missing wallet
  await _testMissingWallet(walletGet, 'some-wallet');

  // get all balances
  const event = makeGatewayEventWithAuthorizer('my-wallet', null);
  const result = await walletGet(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.status).toStrictEqual({
    walletId: getWalletId(XPUBKEY),
    xpubkey: XPUBKEY,
    authXpubkey: AUTH_XPUBKEY,
    status: 'ready',
    maxGap: 5,
    retryCount: 0,
    createdAt: 10000,
    readyAt: 10001,
  });
});

test('POST /wallet', async () => {
  expect.hasAssertions();

  // check CORS headers
  await _testCORSHeaders(walletLoad, null, {});

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

  // missing xpubkey, auth_xpubkey, signatures and timestamp
  event = makeGatewayEvent({}, JSON.stringify({ param1: 'aaa', firstAddress: 'a' }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(6);
  expect(returnBody.details[0].message).toStrictEqual('"xpubkey" is required');
  expect(returnBody.details[1].message).toStrictEqual('"authXpubkey" is required');
  expect(returnBody.details[2].message).toStrictEqual('"xpubkeySignature" is required');
  expect(returnBody.details[3].message).toStrictEqual('"authXpubkeySignature" is required');
  expect(returnBody.details[4].message).toStrictEqual('"timestamp" is required');
  expect(returnBody.details[5].message).toStrictEqual('"param1" is not allowed');

  // get the first address
  const xpubChangeDerivation = walletUtils.xpubDeriveChild(XPUBKEY, 0);
  const firstAddress = walletUtils.getAddressAtIndex(xpubChangeDerivation, 0, process.env.NETWORK);

  // Wrong first address
  event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    authXpubkey: AUTH_XPUBKEY,
    xpubkeySignature: 'xpubkeySignature',
    authXpubkeySignature: 'authXpubkeySignature',
    timestamp: Math.floor(Date.now() / 1000),
    firstAddress: 'a',
  }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.message).toStrictEqual(`Expected first address to be a but it is ${firstAddress}`);

  // Clean database so our pubkey is free to be used again:

  await cleanDatabase(mysql);

  const spy = jest.spyOn(Wallet, 'invokeLoadWalletAsync');

  const mockImplementationSuccess = jest.fn(() => Promise.resolve());
  const mockImplementationFailure = jest.fn(() => Promise.reject(new Error('error!')));

  let mockFn = spy.mockImplementation(mockImplementationSuccess);

  // we need signatures for both the account path and the purpose path:
  const now = Math.floor(Date.now() / 1000);
  const walletId = getWalletId(XPUBKEY);
  const xpriv = walletUtils.getXPrivKeyFromSeed(TEST_SEED, {
    passphrase: '',
    networkName: process.env.NETWORK,
  });

  // account path
  const accountDerivationIndex = '0\'';

  const derivedPrivKey = walletUtils.deriveXpriv(xpriv, accountDerivationIndex);
  const address = derivedPrivKey.publicKey.toAddress(network.getNetwork()).toString();
  const message = new bitcore.Message(String(now).concat(walletId).concat(address));
  const xpubkeySignature = message.sign(derivedPrivKey.privateKey);

  // auth purpose path (m/280'/280')
  const authDerivedPrivKey = HathorWalletServiceWallet.deriveAuthPrivateKey(xpriv);
  const authAddress = authDerivedPrivKey.publicKey.toAddress(network.getNetwork());
  const authMessage = new bitcore.Message(String(now).concat(walletId).concat(authAddress));
  const authXpubkeySignature = authMessage.sign(authDerivedPrivKey.privateKey);

  // Load success
  event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  }));

  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  expect(result.statusCode).toBe(200);

  // already loaded
  event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_ALREADY_LOADED);

  await cleanDatabase(mysql);

  mockFn = spy.mockImplementation(mockImplementationFailure);

  // fail load and then retry
  event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);

  // wallet should be in error state:
  event = makeGatewayEventWithAuthorizer(returnBody.status.walletId, null);
  result = await walletGet(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.status.status).toStrictEqual('error');

  // retrying should succeed
  mockFn = spy.mockImplementation(mockImplementationSuccess);

  event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  // XXX: invoking lambdas is not working on serverless-offline, so for now we are considering a call to the mocked lambda a success:
  expect(mockFn).toHaveBeenCalledWith(XPUBKEY, 10);
}, 30000);

test('POST /wallet should fail with ApiError.WALLET_MAX_RETRIES when max retries are reached', async () => {
  expect.hasAssertions();

  // get the first address
  const xpubChangeDerivation = walletUtils.xpubDeriveChild(XPUBKEY, 0);
  const firstAddress = walletUtils.getAddressAtIndex(xpubChangeDerivation, 0, process.env.NETWORK);

  // we need signatures for both the account path and the purpose path:
  const now = Math.floor(Date.now() / 1000);
  const walletId = getWalletId(XPUBKEY);
  const xpriv = walletUtils.getXPrivKeyFromSeed(TEST_SEED, {
    passphrase: '',
    networkName: process.env.NETWORK,
  });

  // account path
  const accountDerivationIndex = '0\'';

  const derivedPrivKey = walletUtils.deriveXpriv(xpriv, accountDerivationIndex);
  const address = derivedPrivKey.publicKey.toAddress(network.getNetwork()).toString();
  const message = new bitcore.Message(String(now).concat(walletId).concat(address));
  const xpubkeySignature = message.sign(derivedPrivKey.privateKey);

  // auth purpose path (m/280'/280')
  const authDerivedPrivKey = HathorWalletServiceWallet.deriveAuthPrivateKey(xpriv);
  const authAddress = authDerivedPrivKey.publicKey.toAddress(network.getNetwork());
  const authMessage = new bitcore.Message(String(now).concat(walletId).concat(authAddress));
  const authXpubkeySignature = authMessage.sign(authDerivedPrivKey.privateKey);

  const spy = jest.spyOn(Wallet, 'invokeLoadWalletAsync');
  const mockImplementationFailure = jest.fn(() => Promise.reject(new Error('error!')));
  spy.mockImplementation(mockImplementationFailure);

  const params = {
    xpubkey: XPUBKEY,
    xpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  };

  // Load failure
  let event = makeGatewayEvent({}, JSON.stringify(params));
  let result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.status.status).toStrictEqual(WalletStatus.ERROR);
  expect(returnBody.status.retryCount).toStrictEqual(1);

  event = makeGatewayEvent({}, JSON.stringify(params));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.status.status).toStrictEqual(WalletStatus.ERROR);
  expect(returnBody.status.retryCount).toStrictEqual(2);

  event = makeGatewayEvent({}, JSON.stringify(params));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.status.status).toStrictEqual(WalletStatus.ERROR);
  expect(returnBody.status.retryCount).toStrictEqual(3);

  event = makeGatewayEvent({}, JSON.stringify(params));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.status.status).toStrictEqual(WalletStatus.ERROR);
  expect(returnBody.status.retryCount).toStrictEqual(4);

  event = makeGatewayEvent({}, JSON.stringify(params));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.status.status).toStrictEqual(WalletStatus.ERROR);
  expect(returnBody.status.retryCount).toStrictEqual(5);

  event = makeGatewayEvent({}, JSON.stringify(params));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.status.status).toStrictEqual(WalletStatus.ERROR);
  expect(returnBody.error).toStrictEqual(ApiError.WALLET_MAX_RETRIES);
  expect(returnBody.status.retryCount).toStrictEqual(5);
}, 30000); // This is huge for a test, but bitcore-lib takes too long

test('POST /wallet/init should validate attributes properly', async () => {
  expect.hasAssertions();

  const params = {
    xpubkey: XPUBKEY,
    authXpubkey: AUTH_XPUBKEY,
  };

  const event = makeGatewayEvent({}, JSON.stringify(params));
  const result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.details).toHaveLength(4);
  expect(returnBody.details[0].message).toStrictEqual('"xpubkeySignature" is required');
  expect(returnBody.details[1].message).toStrictEqual('"authXpubkeySignature" is required');
  expect(returnBody.details[2].message).toStrictEqual('"timestamp" is required');
  expect(returnBody.details[3].message).toStrictEqual('"firstAddress" is required');
});

test('PUT /wallet/auth', async () => {
  expect.hasAssertions();

  // check CORS headers
  await _testCORSHeaders(changeAuthXpub, null, null);
});

test('PUT /wallet/auth should validate attributes properly', async () => {
  expect.hasAssertions();

  const params = {
    xpubkey: XPUBKEY,
    authXpubkey: AUTH_XPUBKEY,
  };

  const event = makeGatewayEvent({}, JSON.stringify(params));
  const result = await changeAuthXpub(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.details).toHaveLength(4);
  expect(returnBody.details[0].message).toStrictEqual('"xpubkeySignature" is required');
  expect(returnBody.details[1].message).toStrictEqual('"authXpubkeySignature" is required');
  expect(returnBody.details[2].message).toStrictEqual('"timestamp" is required');
  expect(returnBody.details[3].message).toStrictEqual('"firstAddress" is required');
});

test('PUT /wallet/auth should fail if wallet is not yet started', async () => {
  expect.hasAssertions();

  const event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature: 'xpubkey-signature',
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature: 'auth-xpubkey-signature',
    firstAddress: ADDRESSES[0],
    timestamp: Math.floor(Date.now() / 1000),
  }));

  const result = await changeAuthXpub(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(404);
  expect(returnBody.success).toStrictEqual(false);
  expect(returnBody.error).toStrictEqual(ApiError.WALLET_NOT_FOUND);
});

test('changeAuthXpub should fail if timestamp is shifted for more than 30s', async () => {
  expect.hasAssertions();

  const event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature: 'xpubkey-signature',
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature: 'auth-xpubkey-signature',
    firstAddress: ADDRESSES[0],
    timestamp: Math.floor(Date.now() / 1000) - 40,
  }));

  const result = await changeAuthXpub(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toBe('The timestamp is shifted 40(s). Limit is 30(s).');
});

test('loadWallet should fail if signatures do not match', async () => {
  expect.hasAssertions();

  const event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature: 'xpubkey-signature',
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature: 'auth-xpubkey-signature',
    firstAddress: ADDRESSES[0],
    timestamp: Math.floor(Date.now() / 1000),
  }));

  const result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(403);
  expect(returnBody.success).toBe(false);
  expect(returnBody.details[0].message).toBe('Signatures are not valid');
});

test('changeAuthXpub should fail if signatures do not match', async () => {
  expect.hasAssertions();

  const walletId = getWalletId(XPUBKEY);
  await addToWalletTable(mysql, [{
    id: walletId,
    xpubkey: XPUBKEY,
    authXpubkey: AUTH_XPUBKEY,
    status: 'creating',
    maxGap: 5,
    createdAt: 10000,
    readyAt: null,
  }]);

  const event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature: 'xpubkey-signature',
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature: 'auth-xpubkey-signature',
    firstAddress: ADDRESSES[0],
    timestamp: Math.floor(Date.now() / 1000),
  }));

  const result = await changeAuthXpub(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(403);
  expect(returnBody.success).toBe(false);
  expect(returnBody.details[0].message).toBe('Signatures are not valid');
});

test('PUT /wallet/auth should change the auth_xpub only after validating both the xpub and the auth_xpubkey', async () => {
  expect.hasAssertions();

  // get the first address
  const xpubChangeDerivation = walletUtils.xpubDeriveChild(XPUBKEY, 0);
  const firstAddress = walletUtils.getAddressAtIndex(xpubChangeDerivation, 0, process.env.NETWORK);

  // we need signatures for both the account path and the purpose path:
  const now = Math.floor(Date.now() / 1000);
  const walletId = getWalletId(XPUBKEY);
  const xpriv = walletUtils.getXPrivKeyFromSeed(TEST_SEED, {
    passphrase: '',
    networkName: process.env.NETWORK,
  });

  // account path
  const accountDerivationIndex = '0\'';

  const derivedPrivKey = walletUtils.deriveXpriv(xpriv, accountDerivationIndex);
  const address = derivedPrivKey.publicKey.toAddress(network.getNetwork()).toString();
  const message = new bitcore.Message(String(now).concat(walletId).concat(address));
  const xpubkeySignature = message.sign(derivedPrivKey.privateKey);

  // auth purpose path (m/280'/280')
  const authDerivedPrivKey = HathorWalletServiceWallet.deriveAuthPrivateKey(xpriv);
  const authAddress = authDerivedPrivKey.publicKey.toAddress(network.getNetwork());
  const authMessage = new bitcore.Message(String(now).concat(walletId).concat(authAddress));
  const authXpubkeySignature = authMessage.sign(authDerivedPrivKey.privateKey);

  const spy = jest.spyOn(Wallet, 'invokeLoadWalletAsync');
  const mockImplementationSuccess = jest.fn(() => Promise.resolve());
  spy.mockImplementation(mockImplementationSuccess);

  const params = {
    xpubkey: XPUBKEY,
    xpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  };
  // Load wallet should create the wallet row
  let event = makeGatewayEvent({}, JSON.stringify(params));
  let result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.status.authXpubkey).toStrictEqual(AUTH_XPUBKEY);

  // m/280'/280'/1
  const newAuthPurposePath = xpriv.deriveNonCompliantChild('m/280\'/280\'/1');
  const newAuthXpubkey = newAuthPurposePath.xpubkey;
  const newAuthAddress = newAuthPurposePath.publicKey.toAddress(network.getNetwork());
  const newAuthMessage = new bitcore.Message(String(now).concat(walletId).concat(newAuthAddress));
  const newAuthSignature = newAuthMessage.sign(newAuthPurposePath.privateKey);

  const changeAuthXpubParams = {
    ...params,
    authXpubkey: newAuthXpubkey,
    authXpubkeySignature: newAuthSignature,
  };

  // Load success
  event = makeGatewayEvent({}, JSON.stringify(changeAuthXpubParams));
  result = await changeAuthXpub(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.status.authXpubkey).toStrictEqual(newAuthXpubkey.toString());
}, 30000);

test('loadWallet API should fail if a wrong signature is sent', async () => {
  expect.hasAssertions();

  const xpubChangeDerivation = walletUtils.xpubDeriveChild(XPUBKEY, 0);
  const firstAddress = walletUtils.getAddressAtIndex(xpubChangeDerivation, 0, process.env.NETWORK);

  const now = Math.floor(Date.now() / 1000);
  const walletId = getWalletId(XPUBKEY);
  const xpriv = walletUtils.getXPrivKeyFromSeed(TEST_SEED, {
    passphrase: '',
    networkName: process.env.NETWORK,
  });

  const invalidXpubkeySignature = 'WRONG_XPUBKEY_SIGNATURE';
  const invalidAuthXpubkeySignature = 'WRONG_AUTH_XPUBKEY_SIGNATURE';

  // account path
  const accountDerivationIndex = '0\'';

  const derivedPrivKey = walletUtils.deriveXpriv(xpriv, accountDerivationIndex);
  const address = derivedPrivKey.publicKey.toAddress(network.getNetwork()).toString();
  const message = new bitcore.Message(String(now).concat(walletId).concat(address));
  const xpubkeySignature = message.sign(derivedPrivKey.privateKey);

  // auth purpose path (m/280'/280')
  const authDerivedPrivKey = HathorWalletServiceWallet.deriveAuthPrivateKey(xpriv);
  const authAddress = authDerivedPrivKey.publicKey.toAddress(network.getNetwork());
  const authMessage = new bitcore.Message(String(now).concat(walletId).concat(authAddress));
  const authXpubkeySignature = authMessage.sign(authDerivedPrivKey.privateKey);

  const loadWalletAsyncSpy = jest.spyOn(Wallet, 'invokeLoadWalletAsync');
  const mockImplementationSuccess = jest.fn(() => Promise.resolve());
  loadWalletAsyncSpy.mockImplementation(mockImplementationSuccess);

  let event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature: invalidXpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  }));
  let result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(403);
  expect(returnBody.success).toStrictEqual(false);

  event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature,
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature: invalidAuthXpubkeySignature,
    firstAddress,
    timestamp: now,
  }));
  result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toStrictEqual(403);
  expect(returnBody.success).toStrictEqual(false);
}, 30000);

test('loadWallet should fail if timestamp is shifted for more than 30s', async () => {
  expect.hasAssertions();

  const event = makeGatewayEvent({}, JSON.stringify({
    xpubkey: XPUBKEY,
    xpubkeySignature: 'xpubkey-signature',
    authXpubkey: AUTH_XPUBKEY,
    authXpubkeySignature: 'auth-xpubkey-signature',
    firstAddress: ADDRESSES[0],
    timestamp: Math.floor(Date.now() / 1000) - 40,
  }));

  const result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
  expect(returnBody.details).toHaveLength(1);
  expect(returnBody.details[0].message).toBe('The timestamp is shifted 40(s). Limit is 30(s).');
});

test('loadWallet should update wallet status to ERROR if an error occurs', async () => {
  expect.hasAssertions();

  const now = Math.floor(Date.now() / 1000);
  const {
    walletId,
    xpubkey,
    xpubkeySignature,
    authXpubkey,
    authXpubkeySignature,
    firstAddress,
  } = getAuthData(now);

  const loadWalletAsyncSpy = jest.spyOn(Wallet, 'invokeLoadWalletAsync');
  const mockImplementationSuccess = jest.fn(() => Promise.resolve());
  loadWalletAsyncSpy.mockImplementation(mockImplementationSuccess);

  // wallet should be 'creating'
  const event = makeGatewayEvent({}, JSON.stringify({
    xpubkey,
    xpubkeySignature,
    authXpubkey,
    authXpubkeySignature,
    firstAddress,
    timestamp: now,
  }));
  const result = await walletLoad(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.status.status).toStrictEqual(WalletStatus.CREATING);

  const dbSpy = jest.spyOn(Db, 'addNewAddresses');
  const mockImplementationFailure = jest.fn(() => Promise.reject(new Error('error!')));
  dbSpy.mockImplementation(mockImplementationFailure);

  const loadEvent = { xpubkey: XPUBKEY, maxGap: 10 };

  const noop = () => false;

  // mocking an event call from aws
  await loadWallet(loadEvent, {
    callbackWaitsForEmptyEventLoop: true,
    logGroupName: '/aws/lambda/mock-lambda',
    logStreamName: '2018/11/29/[$LATEST]xxxxxxxxxxxb',
    functionName: 'loadWalletAsync',
    memoryLimitInMB: '1024',
    functionVersion: '$LATEST',
    awsRequestId: 'xxxxxx-xxxxx-11e8-xxxx-xxxxxxxxx',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:xxxxxxxx:function:loadWalletAsync',
    getRemainingTimeInMillis: () => 1000,
    done: noop,
    fail: noop,
    succeed: noop,
  }, noop);

  const wallet = await Db.getWallet(mysql, walletId);

  expect(wallet.status).toStrictEqual(WalletStatus.ERROR);
}, 30000);

test('GET /wallet/tokens', async () => {
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
  await addToWalletTxHistoryTable(mysql, [
    ['my-wallet', 'tx1', '00', 5, 1000, false],
    ['my-wallet', 'tx1', 'token2', '7', 1000, false],
    ['my-wallet', 'tx2', '00', 7, 1001, false],
    ['my-wallet', 'tx2', 'token3', 7, 1001, true],
  ]);

  // check CORS headers
  await _testCORSHeaders(walletTokensGet, null, null);

  const event = makeGatewayEventWithAuthorizer('my-wallet', {});
  const result = await walletTokensGet(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.tokens).toStrictEqual(['00', 'token2', 'token3']);
});

test('GET /wallet/tokens/token_id/details', async () => {
  expect.hasAssertions();

  // check CORS headers
  await _testCORSHeaders(getTokenDetails, null, null);

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);

  let event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: TX_IDS[0] });
  let result = await getTokenDetails(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(404);
  expect(returnBody.success).toBe(false);
  expect(returnBody.details[0]).toStrictEqual({ message: 'Token not found' });

  event = makeGatewayEventWithAuthorizer('my-wallet', {});
  result = await getTokenDetails(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.details[0]).toStrictEqual({ message: '"token_id" is required', path: ['token_id'] });

  // add tokens
  const token1 = { id: TX_IDS[1], name: 'MyToken1', symbol: 'MT1' };
  const token2 = { id: TX_IDS[2], name: 'MyToken2', symbol: 'MT2' };

  await addToTokenTable(mysql, [
    { id: token1.id, name: token1.name, symbol: token1.symbol, transactions: 0 },
    { id: token2.id, name: token2.name, symbol: token2.symbol, transactions: 0 },
  ]);

  await addToUtxoTable(mysql, [{
    // Total tokens created
    txId: 'txId',
    index: 0,
    tokenId: token1.id,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    // Mint UTXO:
    txId: 'txId',
    index: 1,
    tokenId: token1.id,
    address: ADDRESSES[0],
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    // Another Mint UTXO
    txId: 'txId',
    index: 2,
    tokenId: token1.id,
    address: ADDRESSES[0],
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    // Total tokens created
    txId: 'txId2',
    index: 0,
    tokenId: token2.id,
    address: ADDRESSES[0],
    value: 250,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    // Locked utxo
    txId: 'txId2',
    index: 1,
    tokenId: token2.id,
    address: ADDRESSES[0],
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: 1000,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    // Spent utxo
    txId: 'txId2',
    index: 2,
    tokenId: token2.id,
    address: ADDRESSES[0],
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: 1000,
    heightlock: null,
    locked: true,
    spentBy: 'txid2',
  }, {
    txId: 'txId3',
    index: 0,
    tokenId: token2.id,
    address: ADDRESSES[0],
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    // Melt UTXO
    txId: 'txId3',
    index: 1,
    tokenId: token2.id,
    address: ADDRESSES[0],
    value: 0,
    authorities: constants.TOKEN_MELT_MASK,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }]);

  await addToAddressTxHistoryTable(mysql, [
    { address: ADDRESSES[0], txId: 'txId', tokenId: token1.id, balance: 100, timestamp: 0 },
    { address: ADDRESSES[0], txId: 'txId2', tokenId: token2.id, balance: 250, timestamp: 0 },
    { address: ADDRESSES[0], txId: 'txId3', tokenId: token2.id, balance: 0, timestamp: 0 },
  ]);

  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: token1.id });
  result = await getTokenDetails(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.details.totalSupply).toStrictEqual(100);
  expect(returnBody.details.totalTransactions).toStrictEqual(1);
  expect(returnBody.details.authorities.mint).toStrictEqual(true);
  expect(returnBody.details.authorities.melt).toStrictEqual(false);
  expect(returnBody.details.tokenInfo).toStrictEqual(token1);

  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: token2.id });
  result = await getTokenDetails(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.details.totalSupply).toStrictEqual(250);
  expect(returnBody.details.totalTransactions).toStrictEqual(2);
  expect(returnBody.details.authorities.mint).toStrictEqual(true);
  expect(returnBody.details.authorities.melt).toStrictEqual(true);
  expect(returnBody.details.tokenInfo).toStrictEqual(token2);

  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: constants.HATHOR_TOKEN_CONFIG.uid });
  result = await getTokenDetails(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.details).toMatchInlineSnapshot(`
  Array [
    Object {
      "message": "\\"token_id\\" length must be at least 64 characters long",
      "path": Array [
        "token_id",
      ],
    },
  ]
  `);

  const oldHathorTokenConfig = constants.HATHOR_TOKEN_CONFIG.uid;

  constants.HATHOR_TOKEN_CONFIG.uid = TX_IDS[4];

  event = makeGatewayEventWithAuthorizer('my-wallet', { token_id: constants.HATHOR_TOKEN_CONFIG.uid });
  result = await getTokenDetails(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.details).toStrictEqual([{ message: 'Invalid tokenId' }]);

  constants.HATHOR_TOKEN_CONFIG.uid = oldHathorTokenConfig;
});

test('GET /wallet/utxos', async () => {
  expect.hasAssertions();

  await _testCORSHeaders(getFilteredUtxos, null, null);
});

test('GET /wallet/tx_outputs', async () => {
  expect.hasAssertions();

  await _testCORSHeaders(getFilteredTxOutputs, null, null);
});

test('POST /tx/proposal', async () => {
  expect.hasAssertions();

  await _testCORSHeaders(txProposalCreate, null, null);
});

test('PUT /tx/proposal/{txProposalId}', async () => {
  expect.hasAssertions();

  await _testCORSHeaders(txProposalSend, null, null);
});

test('DELETE /tx/proposal/{txProposalId}', async () => {
  expect.hasAssertions();

  await _testCORSHeaders(txProposalDestroy, null, null);
});

test('GET /version', async () => {
  expect.hasAssertions();

  const mockData: FullNodeVersionData = {
    timestamp: 1614875031449,
    version: '0.38.0',
    network: 'mainnet',
    minWeight: 14,
    minTxWeight: 14,
    minTxWeightCoefficient: 1.6,
    minTxWeightK: 100,
    tokenDepositPercentage: 0.01,
    rewardSpendMinBlocks: 300,
    maxNumberInputs: 255,
    maxNumberOutputs: 255,
  };

  await updateVersionData(mysql, mockData);

  const event = makeGatewayEvent({});
  const result = await getVersionDataGet(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.data).toStrictEqual(mockData);
});

test('GET /wallet/proxy/transactions/{txId}', async () => {
  expect.hasAssertions();

  const mockData = {
    success: true,
    tx: {
      hash: '000011f5cd1c2bcb7e5e91567666042d8681deeca96263bca60f10c528b9af32',
      nonce: '16651564',
      timestamp: 1672930233,
      version: 1,
      weight: 18.173170552208116,
      parents: [
        '000021de2f105caa2daa9979bdb591a5860b6482a82ed4d7987496c30dbd4496',
        '000007cf2c382898af0f9fd963b2a34279370b522e7816371b778f4a80951ca8',
      ],
      inputs: [{
        value: 2,
        token_data: 129,
        script: 'dqkUuRVulIYgVepEURsh05y3F4ztyJaIrA==',
        decoded: {
          type: 'P2PKH',
          address: 'HPPm4x85cytT9UmSk9MfgQEDfX295JKmiT',
          timelock: null,
          value: 2,
          token_data: 129,
        },
        tx_id: '000028a7886b410958014a61924920b12c667945f2e1c20a986e230fb92afdfc',
        index: 1,
      }],
      outputs: [{
        value: 2,
        token_data: 129,
        script: 'dqkUBAsAnZEAjdjFegyP0eo6WClFKeCIrA==',
        decoded: {
          type: 'P2PKH',
          address: 'H6tWGa8kY5uu3Hz9s4yqV63SCdd3yaXXmX',
          timelock: null,
          value: 2,
          token_data: 129,
        },
      }],
      tokens: [{
        uid: '00003feaf0adb971ef05ad381f5a6c0364c52145617f8f3a8464048c43378628',
        name: 'TEST TOKEN',
        symbol: 'TEST',
      }],
      raw: '',
    },
    meta: {
      hash: '000011f5cd1c2bcb7e5e91567666042d8681deeca96263bca60f10c528b9af32',
      spent_outputs: [
        [0, []],
        [1, []],
      ],
      received_by: [],
      children: [
        '00000000000000000a3df6f146fef03b5044b0e415c4d85a702a72cae133d17b',
        '00000000000000000f091b4d3088aa568ca4a60e4aa67d9e881b3ae60cb846c7',
      ],
      conflict_with: [],
      voided_by: [],
      twins: [],
      accumulated_weight: 18.173170552208116,
      score: 0,
      height: 0,
      min_height: 3074721,
      first_block: '00000000000000000a3df6f146fef03b5044b0e415c4d85a702a72cae133d17b',
      validation: 'full',
      first_block_height: 3140266,
    },
    spent_outputs: {},
  };

  const spy = jest.spyOn(fullnode, 'downloadTx');

  const mockFullnodeResponse = jest.fn(() => Promise.resolve(mockData));
  spy.mockImplementation(mockFullnodeResponse);

  let event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: '000011f5cd1c2bcb7e5e91567666042d8681deeca96263bca60f10c528b9af32',
  });
  let result = await getTransactionById(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody).toStrictEqual(mockData);

  event = makeGatewayEventWithAuthorizer('my-wallet', {});
  result = await getTransactionById(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody).toMatchInlineSnapshot(`
    Object {
      "details": Array [
        Object {
          "message": "\\"txId\\" is required",
          "path": Array [
            "txId",
          ],
        },
      ],
      "error": "invalid-payload",
      "success": false,
    }
  `);
});

test('GET /wallet/proxy/{txId}/confirmation_data', async () => {
  expect.hasAssertions();

  const mockData = {
    success: true,
    accumulated_weight: 67.45956109191802,
    accumulated_bigger: true,
    stop_value: 67.45416781056525,
    confirmation_level: 1,
  };

  const spy = jest.spyOn(fullnode, 'getConfirmationData');

  const mockFullnodeResponse = jest.fn(() => Promise.resolve(mockData));
  spy.mockImplementation(mockFullnodeResponse);

  let event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: '000011f5cd1c2bcb7e5e91567666042d8681deeca96263bca60f10c528b9af32',
  });
  let result = await getConfirmationData(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody).toStrictEqual(mockData);

  // Missing txId
  event = makeGatewayEventWithAuthorizer('my-wallet', {});
  result = await getConfirmationData(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody).toMatchInlineSnapshot(`
    Object {
      "details": Array [
        Object {
          "message": "\\"txId\\" is required",
          "path": Array [
            "txId",
          ],
        },
      ],
      "error": "invalid-payload",
      "success": false,
    }
  `);
});

test('GET /wallet/proxy/graphviz/neighbours', async () => {
  expect.hasAssertions();

  const mockData = 'digraph {}';

  const spy = jest.spyOn(fullnode, 'queryGraphvizNeighbours');

  const mockFullnodeResponse = jest.fn(() => Promise.resolve(mockData));
  spy.mockImplementation(mockFullnodeResponse);

  let event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: '000011f5cd1c2bcb7e5e91567666042d8681deeca96263bca60f10c528b9af32',
    graphType: 'verification',
    maxLevel: '1',
  });
  let result = await queryGraphvizNeighbours(event, null, null) as APIGatewayProxyResult;
  let returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody).toStrictEqual(mockData);

  // Missing a single attribute
  event = makeGatewayEventWithAuthorizer('my-wallet', {
    txId: '000011f5cd1c2bcb7e5e91567666042d8681deeca96263bca60f10c528b9af32',
    graphType: 'verification',
  });

  result = await queryGraphvizNeighbours(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody).toMatchInlineSnapshot(`
    Object {
      "details": Array [
        Object {
          "message": "\\"maxLevel\\" is required",
          "path": Array [
            "maxLevel",
          ],
        },
      ],
      "error": "invalid-payload",
      "success": false,
    }
  `);

  // Missing all attributes
  event = makeGatewayEventWithAuthorizer('my-wallet', {});
  result = await queryGraphvizNeighbours(event, null, null) as APIGatewayProxyResult;
  returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody).toMatchInlineSnapshot(`
    Object {
      "details": Array [
        Object {
          "message": "\\"txId\\" is required",
          "path": Array [
            "txId",
          ],
        },
        Object {
          "message": "\\"graphType\\" is required",
          "path": Array [
            "graphType",
          ],
        },
        Object {
          "message": "\\"maxLevel\\" is required",
          "path": Array [
            "maxLevel",
          ],
        },
      ],
      "error": "invalid-payload",
      "success": false,
    }
  `);
});
