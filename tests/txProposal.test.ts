import {
  checkWalletFunds,
  create as txProposalCreate,
  getChangeOutputs,
  getInputsBalance,
  getOutputsBalance,
  parseValidateInputs,
  parseValidateOutputs,
  useLargerUtxos,
} from '@src/api/txProposalCreate';
import { send as txProposalSend } from '@src/api/txProposalSend';
import { destroy as txProposalDestroy } from '@src/api/txProposalDestroy';
import { getTxProposal, getTxProposalOutputs, getUtxos, updateTxProposal } from '@src/db';
import { TxProposalStatus, Balance, TokenBalanceMap, TokenInfo, WalletTokenBalance } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
import {
  addToWalletBalanceTable,
  addToTxProposalTable,
  addToAddressTable,
  addToWalletTable,
  addToUtxoTable,
  makeGatewayEvent,
  cleanDatabase,
  ADDRESSES,
} from '@tests/utils';
import { APIGatewayProxyResult } from 'aws-lambda';
import buffer from 'buffer';

import { ApiError } from '@src/api/errors';

import hathorLib from '@hathor/wallet-lib';

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('parseValidateOutputs', () => {
  expect.hasAssertions();

  let outputs = [];
  expect(parseValidateOutputs(outputs)).toStrictEqual([]);

  // less than 4 elements
  outputs = [[ADDRESSES[0], 10, 'token1']];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong address type
  outputs = [[10, 10, 'token1', 20]];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong value type
  outputs = [[ADDRESSES[0], '10', 'token1', 20]];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong token type
  outputs = [[ADDRESSES[0], 10, 15, 20]];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong timelock type
  outputs = [[ADDRESSES[0], 10, 'token1', '20']];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // success test
  outputs = [[ADDRESSES[0], 10, 'token1', 20]];
  expect(parseValidateOutputs(outputs)).toStrictEqual([{ address: ADDRESSES[0], value: 10, token: 'token1', timelock: 20 }]);

  // success test (null timelock)
  outputs = [[ADDRESSES[0], 10, 'token1', null]];
  expect(parseValidateOutputs(outputs)).toStrictEqual([{ address: ADDRESSES[0], value: 10, token: 'token1', timelock: null }]);
});

test('parseValidateInputs', () => {
  expect.hasAssertions();

  let inputs = [];
  expect(parseValidateInputs(inputs)).toStrictEqual([]);

  // less than 2 elements
  inputs = [{ txId: 'txId' }];
  expect(parseValidateInputs(inputs)).toBeNull();

  // wrong txId type
  inputs = [{ txId: 10, index: 0 }];
  expect(parseValidateInputs(inputs)).toBeNull();

  // wrong index type
  inputs = [{ txId: 'txId', index: '0' }];
  expect(parseValidateInputs(inputs)).toBeNull();

  // success test
  inputs = [{ txId: 'txId', index: 0 }];
  expect(parseValidateInputs(inputs)).toStrictEqual([{ txId: 'txId', index: 0 }]);
});

test('getOutputsBalance', () => {
  expect.hasAssertions();
  const addr1 = 'address1';
  const addr2 = ADDRESSES[1];
  const token1 = 'token1';
  const token2 = 'token2';

  const now = getUnixTimestamp();

  const result = getOutputsBalance([
    { address: addr1, value: 2, token: token1, timelock: null },
    { address: addr1, value: 3, token: token1, timelock: now + 100 },
    { address: addr2, value: 15, token: token1, timelock: null },
    { address: addr1, value: 7, token: token2, timelock: null },
    { address: addr2, value: 1, token: token2, timelock: null },
  ], now);

  const expected = TokenBalanceMap.fromStringMap({
    token1: { unlocked: 17, locked: 3, lockExpires: now + 100 },
    token2: { unlocked: 8, locked: 0 },
  });

  expect(result).toStrictEqual(expected);
});

test('getInputsBalance', () => {
  expect.hasAssertions();

  const addr1 = 'address1';
  const addr2 = ADDRESSES[1];
  const token1 = 'token1';
  const token2 = 'token2';
  const txId = 'txId';

  const now = getUnixTimestamp();

  const result = getInputsBalance([
    { txId, index: 0, tokenId: token1, address: addr1, value: 5, authorities: 0, timelock: null, heightlock: null, locked: false },
    { txId, index: 1, tokenId: token1, address: addr1, value: 3, authorities: 0, timelock: now - 20, heightlock: null, locked: false },
    { txId, index: 3, tokenId: token1, address: addr2, value: 2, authorities: 0, timelock: null, heightlock: null, locked: false },
    { txId, index: 2, tokenId: token2, address: addr1, value: 7, authorities: 0, timelock: null, heightlock: null, locked: false },
  ]);

  const expected = TokenBalanceMap.fromStringMap({
    token1: { unlocked: -10, locked: 0 },
    token2: { unlocked: -7, locked: 0 },
  });

  expect(result).toStrictEqual(expected);
});

test('getChangeOutputs', () => {
  expect.hasAssertions();

  let addrs = ['addr0', 'addr1', 'addr2'];
  const token1 = 'token1';
  const token3 = 'token3';
  const diff = TokenBalanceMap.fromStringMap({
    token1: { unlocked: -10, locked: 0 },
    token2: { unlocked: 0, locked: 0 },
    token3: { unlocked: -7, locked: 0 },
  });
  let expected = [
    { address: addrs[0], value: 10, token: token1, timelock: null },
    { address: addrs[1], value: 7, token: token3, timelock: null },
  ];

  let result = getChangeOutputs(diff, addrs);
  expect(result).toStrictEqual(expected);

  // repeating change addresses
  addrs = ['addr0'];
  expected = [
    { address: addrs[0], value: 10, token: token1, timelock: null },
    { address: addrs[0], value: 7, token: token3, timelock: null },
  ];
  result = getChangeOutputs(diff, addrs);
  expect(result).toStrictEqual(expected);
});

test('useLargerUtxos', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const walletId = 'walletId';
  const tokenId = 'tokenId';
  const txId = 'txId';
  await addToAddressTable(mysql, [
    { address: addr1, index: 0, walletId, transactions: 1 },
    { address: addr2, index: 1, walletId, transactions: 1 },
  ]);
  await addToUtxoTable(mysql, [
    // another wallet
    [txId, 2, tokenId, 'otherAddr', 10, 0, null, null, false],
    // another token
    [txId, 3, 'tokenId2', addr1, 5, 0, null, null, false],
    // these sould be considered
    [txId, 4, tokenId, addr1, 40, 0, null, null, false],
    [txId, 5, tokenId, addr2, 5, 0, null, null, false],
    [txId, 6, tokenId, addr1, 10, 0, null, null, false],
  ]);

  // need all UTXOs
  let utxos = await useLargerUtxos(mysql, walletId, tokenId, 52);
  expect(utxos).toHaveLength(3);
  expect(utxos[0]).toStrictEqual({
    txId, index: 4, tokenId, address: addr1, value: 40, authorities: 0, timelock: null, heightlock: null, locked: false,
  });
  expect(utxos[1]).toStrictEqual({
    txId, index: 6, tokenId, address: addr1, value: 10, authorities: 0, timelock: null, heightlock: null, locked: false,
  });
  expect(utxos[2]).toStrictEqual({
    txId, index: 5, tokenId, address: addr2, value: 5, authorities: 0, timelock: null, heightlock: null, locked: false,
  });

  // need 2 UTXOs
  utxos = await useLargerUtxos(mysql, walletId, tokenId, 47);
  expect(utxos).toHaveLength(2);
  expect(utxos[0]).toStrictEqual({
    txId, index: 4, tokenId, address: addr1, value: 40, authorities: 0, timelock: null, heightlock: null, locked: false,
  });
  expect(utxos[1]).toStrictEqual({
    txId, index: 6, tokenId, address: addr1, value: 10, authorities: 0, timelock: null, heightlock: null, locked: false,
  });

  // need only 1 UTXO
  utxos = await useLargerUtxos(mysql, walletId, tokenId, 20);
  expect(utxos).toHaveLength(1);
  expect(utxos[0]).toStrictEqual({
    txId, index: 4, tokenId, address: addr1, value: 40, authorities: 0, timelock: null, heightlock: null, locked: false,
  });
});

test('checkWalletFunds', () => {
  expect.hasAssertions();

  const token1 = new TokenInfo('token1', 'MyToken1', 'tk1');
  const token2 = new TokenInfo('token2', 'MyToken2', 'tk2');
  const outputsBalance = TokenBalanceMap.fromStringMap({
    token1: { unlocked: 17, locked: 3, lockExpires: 10000 },
    token2: { unlocked: 8, locked: 0 },
  });

  // total amount is ok, but unlocked amount is insufficient
  let walletBalances = [
    new WalletTokenBalance(token1, new Balance(15, 10), 3),
    new WalletTokenBalance(token2, new Balance(10, 0), 2),
  ];
  let result = checkWalletFunds(walletBalances, outputsBalance);
  expect(result).toHaveLength(1);
  expect(result[0]).toStrictEqual({ tokenId: 'token1', requested: 20, available: 15 });

  // wallet doesn't have token2
  walletBalances = [
    new WalletTokenBalance(token1, new Balance(25, 1), 3),
  ];
  result = checkWalletFunds(walletBalances, outputsBalance);
  expect(result).toHaveLength(1);
  expect(result[0]).toStrictEqual({ tokenId: 'token2', requested: 8, available: 0 });

  // all ok
  walletBalances = [
    new WalletTokenBalance(token1, new Balance(25, 1), 3),
    new WalletTokenBalance(token2, new Balance(10, 0), 2),
  ];
  result = checkWalletFunds(walletBalances, outputsBalance);
  expect(result).toHaveLength(0);
});

const _checkTxProposalTables = async (txProposalId, inputs, outputs): Promise<void> => {
  const utxos = await getUtxos(mysql, inputs);
  for (const utxo of utxos) {
    expect(utxo.txProposalId).toBe(txProposalId);
  }
  expect(await getTxProposal(mysql, txProposalId)).not.toBeNull();
  expect(await getTxProposalOutputs(mysql, txProposalId)).toStrictEqual(outputs);
};

test('POST /txproposals with null as param should fail with ApiError.INVALID_PAYLOAD', async () => {
  expect.hasAssertions();

  const event = makeGatewayEvent(null, null);
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
});

test('POST /txproposals one output and input', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['txSuccess0', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['txSuccess2', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token3
  const outputs = [[ADDRESSES[0], 300, 'token1', null]];
  const event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(1);
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess0', index: 0 });
  expect(returnBody.outputs).toHaveLength(1);
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[0], value: 300, token: 'token1', timelock: null });

  await _checkTxProposalTables(returnBody.txProposalId, returnBody.inputs, returnBody.outputs);
});

test('POST /txproposals with utxos that are already used on another txproposal should fail with ApiError.INPUTS_ALREADY_USED', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['txSuccess0', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['txSuccess2', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const outputs = [[ADDRESSES[0], 300, 'token1', null]];
  const event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(1);
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess0', index: 0 });
  expect(returnBody.outputs).toHaveLength(1);
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[0], value: 300, token: 'token1', timelock: null });

  const usedInputsEvent = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs, inputs: [['txSuccess0', 0]] }));
  const usedInputsResult = await txProposalCreate(usedInputsEvent, null, null) as APIGatewayProxyResult;
  const usedInputsReturnBody = JSON.parse(usedInputsResult.body as string);

  expect(usedInputsReturnBody.success).toBe(false);
  expect(usedInputsReturnBody.error).toBe(ApiError.INPUTS_ALREADY_USED);
});

test('POST /txproposals with a wallet that is not ready should fail with ApiError.WALLET_NOT_READY', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['not-ready-wallet', 'xpubkey', 'creating', 5, 10000, null]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'not-ready-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['txSuccess0', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['txSuccess2', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token3
  const outputs = [[ADDRESSES[0], 300, 'token1', null]];
  const event = makeGatewayEvent(null, JSON.stringify({ id: 'not-ready-wallet', outputs }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_NOT_READY);
});

test('POST /txproposals use two UTXOs and add change output', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['txSuccess0', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [[ADDRESSES[0], 320, 'token1', null]],
  }));

  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(2);
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess0', index: 0 });
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess1', index: 0 });
  expect(returnBody.outputs).toHaveLength(2);
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[0], value: 320, token: 'token1', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[1], value: 80, token: 'token1', timelock: null });

  await _checkTxProposalTables(returnBody.txProposalId, returnBody.inputs, returnBody.outputs);
});

test('POST /txproposals with invalid inputSelectionAlgo should fail with ApiError.INVALID_SELECTION_ALGORITHM', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['txSuccess0', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [[ADDRESSES[0], 320, 'token1', null]],
    inputSelectionAlgo: 'INVALID_SELECTION_ALGORITHM',
  }));

  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_SELECTION_ALGORITHM);
});

test('POST /txproposals two tokens, both with change output', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['txSuccess0', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['txSuccess2', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const event = makeGatewayEvent(null, JSON.stringify({
    id: 'my-wallet',
    outputs: [
      [ADDRESSES[0], 320, 'token1', null],
      [ADDRESSES[0], 90, 'token2', null],
    ],
  }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(3);
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess0', index: 0 });
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess1', index: 0 });
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess2', index: 0 });
  expect(returnBody.outputs).toHaveLength(4);
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[0], value: 320, token: 'token1', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[1], value: 80, token: 'token1', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[0], value: 90, token: 'token2', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: ADDRESSES[1], value: 210, token: 'token2', timelock: null });

  await _checkTxProposalTables(returnBody.txProposalId, returnBody.inputs, returnBody.outputs);
});

test('PUT /txproposals/{proposalId}', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => Promise.resolve({
      data: { success: true },
    }),
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: 'HFxhB69vk5PCdvVpRtk5bB27ujP68jPKe2',
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const txCreateEvent = makeGatewayEvent(null,
    JSON.stringify({
      id: 'my-wallet',
      outputs: [
        [ADDRESSES[0], 320, 'token1', null],
        [ADDRESSES[0], 90, 'token2', null],
      ],
    }));
  const txCreateResult = await txProposalCreate(txCreateEvent, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const signature = new buffer.Buffer(20);
  const pubkeyBytes = new buffer.Buffer(30);

  const txSendEvent = makeGatewayEvent({ txProposalId: returnBody.txProposalId }, JSON.stringify({
    inputsSignatures: [
      1, 2, 3, 4, 5, 6, 7,
    ].map(() => hathorLib.transaction.createInputData(signature, pubkeyBytes).toString('base64')),
    nonce: 28,
    parents: [
      '00000000204080e1b7563558869e39d169efae5008d2158cc3cb6c0c3812ff2a',
      '00000000414ede4aad9e08e3a336191e2b0510d9f74c7b5e94b68e653bcbf42e',
    ],
    timestamp: 1609881763,
    weight: 19,
  }));

  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  const sendReturnBody = JSON.parse(txSendResult.body as string);
  const txProposal = await getTxProposal(mysql, sendReturnBody.txProposalId);

  expect(sendReturnBody.success).toStrictEqual(true);
  expect(txProposal.status).toStrictEqual(TxProposalStatus.SENT);

  spy.mockRestore();
});

test('PUT /txproposals/{proposalId} with an empty body should fail with ApiError.INVALID_PAYLOAD', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: 'HFxhB69vk5PCdvVpRtk5bB27ujP68jPKe2',
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const txCreateEvent = makeGatewayEvent(null,
    JSON.stringify({
      id: 'my-wallet',
      outputs: [
        [ADDRESSES[0], 320, 'token1', null],
        [ADDRESSES[0], 90, 'token2', null],
      ],
    }));
  const txCreateResult = await txProposalCreate(txCreateEvent, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const txSendEvent = makeGatewayEvent({ txProposalId: returnBody.txProposalId }, null);
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.INVALID_PAYLOAD);
});

test('PUT /txproposals/{proposalId} with missing params should fail with ApiError.MISSING_PARAMETER', async () => {
  expect.hasAssertions();

  const txSendEvent = makeGatewayEvent(null, null);
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toBe(ApiError.MISSING_PARAMETER);
  expect(JSON.parse(txSendResult.body as string).parameter).toBe('txProposalId');
});

test('PUT /txproposals/{proposalId} with a missing proposalId should fail with ApiError.TX_PROPOSAL_NOT_FOUND', async () => {
  expect.hasAssertions();

  const txSendEvent = makeGatewayEvent({ txProposalId: '8d1e2921-7bc9-41f5-9758-40b734edff0f' }, JSON.stringify({
    inputsSignatures: [1],
    nonce: 28,
    parents: [
      '00000000204080e1b7563558869e39d169efae5008d2158cc3cb6c0c3812ff2a',
      '00000000414ede4aad9e08e3a336191e2b0510d9f74c7b5e94b68e653bcbf42e',
    ],
    timestamp: 1609881763,
    weight: 19,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_FOUND);
});

test('PUT /txproposals/{proposalId} with a invalid proposalId should fail with ApiError.INVALID_PARAMETER', async () => {
  expect.hasAssertions();

  const txSendEvent = makeGatewayEvent({ txProposalId: 'invalid-uuid' }, null);
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.INVALID_PARAMETER);
  expect(JSON.parse(txSendResult.body as string).parameter).toStrictEqual('txProposalId');
});

test('PUT /txproposals/{proposalId} on a proposal which status is not OPEN or SEND_ERROR should fail with ApiError.TX_PROPOSAL_NOT_OPEN', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: 'HFxhB69vk5PCdvVpRtk5bB27ujP68jPKe2',
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const txCreateEvent = makeGatewayEvent(null,
    JSON.stringify({
      id: 'my-wallet',
      outputs: [
        [ADDRESSES[0], 320, 'token1', null],
        [ADDRESSES[0], 90, 'token2', null],
      ],
    }));
  const txCreateResult = await txProposalCreate(txCreateEvent, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  // Set tx_proposal status to CANCELLED so it will fail on txProposalSend
  const now = getUnixTimestamp();
  await updateTxProposal(
    mysql,
    returnBody.txProposalId,
    now,
    TxProposalStatus.CANCELLED,
  );

  const txSendEvent = makeGatewayEvent({ txProposalId: returnBody.txProposalId }, JSON.stringify({
    inputsSignatures: [1],
    nonce: 28,
    parents: [
      '00000000204080e1b7563558869e39d169efae5008d2158cc3cb6c0c3812ff2a',
      '00000000414ede4aad9e08e3a336191e2b0510d9f74c7b5e94b68e653bcbf42e',
    ],
    timestamp: 1609881763,
    weight: 19,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_OPEN);
});

test('PUT /txproposals/{proposalId} with an invalid weight should fail with ApiError.INVALID_TX_WEIGHT', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => Promise.resolve({
      data: { success: true },
    }),
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: 'HFxhB69vk5PCdvVpRtk5bB27ujP68jPKe2',
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const txCreateEvent = makeGatewayEvent(null,
    JSON.stringify({
      id: 'my-wallet',
      outputs: [
        [ADDRESSES[0], 320, 'token1', null],
        [ADDRESSES[0], 90, 'token2', null],
      ],
    }));
  const txCreateResult = await txProposalCreate(txCreateEvent, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const signature = new buffer.Buffer(20);
  const pubkeyBytes = new buffer.Buffer(30);

  const txSendEvent = makeGatewayEvent({ txProposalId: returnBody.txProposalId }, JSON.stringify({
    inputsSignatures: [
      1, 2, 3, 4, 5, 6, 7,
    ].map(() => hathorLib.transaction.createInputData(signature, pubkeyBytes).toString('base64')),
    nonce: 28,
    parents: [
      '00000000204080e1b7563558869e39d169efae5008d2158cc3cb6c0c3812ff2a',
      '00000000414ede4aad9e08e3a336191e2b0510d9f74c7b5e94b68e653bcbf42e',
    ],
    timestamp: 1609881763,
    weight: -1,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body).success).toStrictEqual(false);
  expect(JSON.parse(txSendResult.body).error).toStrictEqual(ApiError.INVALID_TX_WEIGHT);

  spy.mockRestore();
});

test('PUT /txproposals/{proposalId} with an invalid txHex should fail and update tx_proposal to SEND_ERROR', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => Promise.resolve({
      data: {
        success: false,
        message: 'invalid txhex',
      },
    }),
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: 'HFxhB69vk5PCdvVpRtk5bB27ujP68jPKe2',
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const txCreateEvent = makeGatewayEvent(null,
    JSON.stringify({
      id: 'my-wallet',
      outputs: [
        [ADDRESSES[0], 320, 'token1', null],
        [ADDRESSES[0], 90, 'token2', null],
      ],
    }));
  const txCreateResult = await txProposalCreate(txCreateEvent, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const signature = new buffer.Buffer(20);
  const pubkeyBytes = new buffer.Buffer(30);

  const txSendEvent = makeGatewayEvent({ txProposalId: returnBody.txProposalId }, JSON.stringify({
    inputsSignatures: [
      1, 2, 3, 4, 5, 6, 7,
    ].map(() => hathorLib.transaction.createInputData(signature, pubkeyBytes).toString('base64')),
    nonce: 28,
    parents: [
      '00000000204080e1b7563558869e39d169efae5008d2158cc3cb6c0c3812ff2a',
      '00000000414ede4aad9e08e3a336191e2b0510d9f74c7b5e94b68e653bcbf42e',
    ],
    timestamp: 1609881763,
    weight: 19,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body).success).toStrictEqual(false);

  const txProposal = await getTxProposal(mysql, returnBody.txProposalId);

  expect(txProposal.status).toStrictEqual(TxProposalStatus.SEND_ERROR);

  spy.mockRestore();
});

test('PUT /txproposals/{proposalId} should update tx_proposal to SEND_ERROR on fail because of wallet-lib call error', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => {
      throw new Error('Wallet lib error');
    },
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: 'HFxhB69vk5PCdvVpRtk5bB27ujP68jPKe2',
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const txCreateEvent = makeGatewayEvent(null,
    JSON.stringify({
      id: 'my-wallet',
      outputs: [
        [ADDRESSES[0], 320, 'token1', null],
        [ADDRESSES[0], 90, 'token2', null],
      ],
    }));
  const txCreateResult = await txProposalCreate(txCreateEvent, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const signature = new buffer.Buffer(20);
  const pubkeyBytes = new buffer.Buffer(30);

  const txSendEvent = makeGatewayEvent({ txProposalId: returnBody.txProposalId }, JSON.stringify({
    inputsSignatures: [
      1, 2, 3, 4, 5, 6, 7,
    ].map(() => hathorLib.transaction.createInputData(signature, pubkeyBytes).toString('base64')),
    nonce: 28,
    parents: [
      '00000000204080e1b7563558869e39d169efae5008d2158cc3cb6c0c3812ff2a',
      '00000000414ede4aad9e08e3a336191e2b0510d9f74c7b5e94b68e653bcbf42e',
    ],
    timestamp: 1609881763,
    weight: 19,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body).success).toStrictEqual(false);

  const txProposal = await getTxProposal(mysql, returnBody.txProposalId);

  expect(txProposal.status).toStrictEqual(TxProposalStatus.SEND_ERROR);

  spy.mockRestore();
});

test('DELETE /txproposals/{proposalId} should delete a tx_proposal and remove the utxos associated to it', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [
    ['00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa', 0, 'token1', ADDRESSES[0], 300, 0, null, null, false],
    ['000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746', 0, 'token1', ADDRESSES[0], 100, 0, null, null, false],
    ['0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef', 0, 'token2', ADDRESSES[0], 300, 0, null, null, false],
  ];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: 'HFxhB69vk5PCdvVpRtk5bB27ujP68jPKe2',
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const txCreateEvent = makeGatewayEvent(null,
    JSON.stringify({
      id: 'my-wallet',
      outputs: [
        [ADDRESSES[0], 320, 'token1', null],
        [ADDRESSES[0], 90, 'token2', null],
      ],
    }));
  const txCreateResult = await txProposalCreate(txCreateEvent, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const txDeleteEvent = makeGatewayEvent({ txProposalId: returnBody.txProposalId }, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txDeleteResult.body).success).toStrictEqual(true);

  const txProposal = await getTxProposal(mysql, returnBody.txProposalId);

  expect(txProposal.status).toStrictEqual(TxProposalStatus.CANCELLED);

  // TODO: Verify if outputs were deleted from tx_proposal
});

test('DELETE /txproposals/{proposalId} with missing txProposalId should fail with ApiError.MISSING_PARAMETER', async () => {
  expect.hasAssertions();

  const txDeleteEvent = makeGatewayEvent(null, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;
  const txDeleteResultBody = JSON.parse(txDeleteResult.body as string);

  expect(txDeleteResultBody.success).toStrictEqual(false);
  expect(txDeleteResultBody.error).toStrictEqual(ApiError.MISSING_PARAMETER);
  expect(txDeleteResultBody.parameter).toStrictEqual('txProposalId');
});

test('DELETE /txproposals/{proposalId} with not existing tx_proposal should fail with ApiError.TX_PROPOSAL_NOT_FOUND', async () => {
  expect.hasAssertions();

  const txDeleteEvent = makeGatewayEvent({ txProposalId: 'invalid-tx-proposal-id' }, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;
  const txDeleteResultBody = JSON.parse(txDeleteResult.body as string);

  expect(txDeleteResultBody.success).toStrictEqual(false);
  expect(txDeleteResultBody.error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_FOUND);
});

test('DELETE /txproposals/{proposalId} shoudl fail with ApiError.TX_PROPOSAL_NOT_OPEN on already sent tx_proposals', async () => {
  expect.hasAssertions();

  await addToTxProposalTable(mysql, [['fe141b88-7328-4851-a608-631d1d5a5513', 'wallet-id', 'sent', 1, 1]]);

  const txDeleteEvent = makeGatewayEvent({ txProposalId: 'fe141b88-7328-4851-a608-631d1d5a5513' }, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;
  const txDeleteResultBody = JSON.parse(txDeleteResult.body as string);

  expect(txDeleteResultBody.success).toStrictEqual(false);
  expect(txDeleteResultBody.error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_OPEN);
});
