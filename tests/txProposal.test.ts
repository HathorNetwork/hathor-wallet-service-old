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
import { getTxProposal, getTxProposalOutputs, getUtxos } from '@src/db';
import { Balance, TokenBalanceMap, TokenInfo, WalletTokenBalance } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
import {
  addToAddressTable,
  addToUtxoTable,
  addToWalletBalanceTable,
  addToWalletTable,
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

test('parseValidateOutputs', () => {
  expect.hasAssertions();

  let outputs = [];
  expect(parseValidateOutputs(outputs)).toStrictEqual([]);

  // less than 4 elements
  outputs = [['address', 10, 'token1']];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong address type
  outputs = [[10, 10, 'token1', 20]];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong value type
  outputs = [['address', '10', 'token1', 20]];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong token type
  outputs = [['address', 10, 15, 20]];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // wrong timelock type
  outputs = [['address', 10, 'token1', '20']];
  expect(parseValidateOutputs(outputs)).toBeNull();

  // success test
  outputs = [['address', 10, 'token1', 20]];
  expect(parseValidateOutputs(outputs)).toStrictEqual([{ address: 'address', value: 10, token: 'token1', timelock: 20 }]);

  // success test (null timelock)
  outputs = [['address', 10, 'token1', null]];
  expect(parseValidateOutputs(outputs)).toStrictEqual([{ address: 'address', value: 10, token: 'token1', timelock: null }]);
});

test('parseValidateInputs', () => {
  expect.hasAssertions();

  let inputs = [];
  expect(parseValidateInputs(inputs)).toStrictEqual([]);

  // less than 2 elements
  inputs = [['txId']];
  expect(parseValidateInputs(inputs)).toBeNull();

  // wrong txId type
  inputs = [[10, 0]];
  expect(parseValidateInputs(inputs)).toBeNull();

  // wrong index type
  inputs = [['txId', '0']];
  expect(parseValidateInputs(inputs)).toBeNull();

  // success test
  inputs = [['txId', 0]];
  expect(parseValidateInputs(inputs)).toStrictEqual([{ txId: 'txId', index: 0 }]);
});

test('getOutputsBalance', () => {
  expect.hasAssertions();
  const addr1 = 'address1';
  const addr2 = 'address2';
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
  const addr2 = 'address2';
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
    [addr1, 0, walletId, 1],
    [addr2, 1, walletId, 1],
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

const _checkTxProposalTables = async (txProposalId, inputs, outputs): void => {
  const utxos = await getUtxos(mysql, inputs);
  for (const utxo of utxos) {
    expect(utxo.txProposalId).toBe(txProposalId);
  }
  expect(await getTxProposal(mysql, txProposalId)).not.toBeNull();
  expect(await getTxProposalOutputs(mysql, txProposalId)).toStrictEqual(outputs);
};

test('POST /txproposals one output and input', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [['address', 0, 'my-wallet', 2]]);

  const utxos = [
    ['txSuccess0', 0, 'token1', 'address', 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', 'address', 100, 0, null, null, false],
    ['txSuccess2', 0, 'token2', 'address', 300, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [['my-wallet', 'token1', 400, 0, 0, 0, null, 2], ['my-wallet', 'token2', 300, 0, 0, 0, null, 1]]);
  await addToAddressTable(mysql, [['address2', 1, 'my-wallet', 0]]);

  // only one output, spending the whole 300 utxo of token3
  const outputs = [['address', 300, 'token1', null]];
  const event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(1);
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess0', index: 0 });
  expect(returnBody.outputs).toHaveLength(1);
  expect(returnBody.outputs).toContainEqual({ address: 'address', value: 300, token: 'token1', timelock: null });

  await _checkTxProposalTables(returnBody.txProposalId, returnBody.inputs, returnBody.outputs);
});

test('POST /txproposals use two UTXOs and add change output', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [['address', 0, 'my-wallet', 2]]);

  const utxos = [
    ['txSuccess0', 0, 'token1', 'address', 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', 'address', 100, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [['my-wallet', 'token1', 400, 0, 0, 0, null, 2], ['my-wallet', 'token2', 300, 0, 0, 0, null, 1]]);
  await addToAddressTable(mysql, [['address2', 1, 'my-wallet', 0]]);

  const event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs: [['address', 320, 'token1', null]] }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(200);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(2);
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess0', index: 0 });
  expect(returnBody.inputs).toContainEqual({ txId: 'txSuccess1', index: 0 });
  expect(returnBody.outputs).toHaveLength(2);
  expect(returnBody.outputs).toContainEqual({ address: 'address', value: 320, token: 'token1', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: 'address2', value: 80, token: 'token1', timelock: null });

  await _checkTxProposalTables(returnBody.txProposalId, returnBody.inputs, returnBody.outputs);
});

test('POST /txproposals two tokens, both with change output', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [['my-wallet', 'xpubkey', 'ready', 5, 10000, 10001]]);
  await addToAddressTable(mysql, [['address', 0, 'my-wallet', 2]]);

  const utxos = [
    ['txSuccess0', 0, 'token1', 'address', 300, 0, null, null, false],
    ['txSuccess1', 0, 'token1', 'address', 100, 0, null, null, false],
    ['txSuccess2', 0, 'token2', 'address', 300, 0, null, null, false],
  ];
  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [['my-wallet', 'token1', 400, 0, 0, 0, null, 2], ['my-wallet', 'token2', 300, 0, 0, 0, null, 1]]);
  await addToAddressTable(mysql, [['address2', 1, 'my-wallet', 0]]);

  const event = makeGatewayEvent(null, JSON.stringify({ id: 'my-wallet', outputs: [['address', 320, 'token1', null], ['address', 90, 'token2', null]] }));
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
  expect(returnBody.outputs).toContainEqual({ address: 'address', value: 320, token: 'token1', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: 'address2', value: 80, token: 'token1', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: 'address', value: 90, token: 'token2', timelock: null });
  expect(returnBody.outputs).toContainEqual({ address: 'address2', value: 210, token: 'token2', timelock: null });

  await _checkTxProposalTables(returnBody.txProposalId, returnBody.inputs, returnBody.outputs);
});
