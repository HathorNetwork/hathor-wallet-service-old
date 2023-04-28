import eventTemplate from '@events/eventTemplate.json';
import {
  getAddressBalanceMap,
  getWalletBalanceMap,
  markLockedOutputs,
  unlockUtxos,
  unlockTimelockedUtxos,
  maybeRefreshWalletConstants,
  searchForLatestValidBlock,
  getWalletBalancesForTx,
} from '@src/commons';
import {
  FullNodeVersionData,
  Authorities,
  Balance,
  TokenBalanceMap,
  DbTxOutput,
  Block,
  TxInput,
  TxOutput,
  Transaction,
} from '@src/types';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToAddressTable,
  addToAddressBalanceTable,
  addToUtxoTable,
  addToWalletTable,
  addToWalletBalanceTable,
  cleanDatabase,
  checkUtxoTable,
  checkAddressBalanceTable,
  checkWalletBalanceTable,
  createInput,
  createOutput,
  TX_IDS,
  XPUBKEY,
  AUTH_XPUBKEY,
} from '@tests/utils';
import {
  updateVersionData,
  addOrUpdateTx,
  updateWalletTablesWithTx,
  createWallet,
  updateTxOutputSpentBy,
  addUtxos,
  storeTokenInformation,
} from '@src/db';
import * as Utils from '@src/utils';
import hathorLib from '@hathor/wallet-lib';

const mysql = getDbConnection();
const OLD_ENV = process.env;

beforeEach(async () => {
  await cleanDatabase(mysql);
});

beforeAll(async () => {
  // modify env so block reward is unlocked after 1 new block (overrides .env file)
  jest.resetModules();
  process.env = { ...OLD_ENV };
  process.env.BLOCK_REWARD_LOCK = '1';
});

afterAll(async () => {
  await closeDbConnection(mysql);
  // restore old env
  process.env = OLD_ENV;
});

test('markLockedOutputs and getAddressBalanceMap', () => {
  expect.hasAssertions();
  const evt = JSON.parse(JSON.stringify(eventTemplate));
  const tx = evt.Records[0].body;
  const now = 20000;
  tx.tx_id = 'txId1';
  tx.timestamp = 0;
  tx.inputs = [
    createInput(10, 'address1', 'inputTx', 0, 'token1'),
    createInput(5, 'address1', 'inputTx', 0, 'token1'),
    createInput(7, 'address1', 'inputTx', 1, 'token2'),
    createInput(3, 'address2', 'inputTx', 2, 'token1'),
  ];
  tx.outputs = [
    createOutput(0, 5, 'address1', 'token1'),
    createOutput(1, 2, 'address1', 'token3'),
    createOutput(2, 11, 'address2', 'token1'),
  ];
  const map1 = new TokenBalanceMap();
  map1.set('token1', new Balance(5, -10, 0));
  map1.set('token2', new Balance(0, -7, 0));
  map1.set('token3', new Balance(2, 2, 0));
  const map2 = new TokenBalanceMap();
  map2.set('token1', new Balance(11, 8, 0));
  const expectedAddrMap = {
    address1: map1,
    address2: map2,
  };

  markLockedOutputs(tx.outputs, now, false);
  for (const output of tx.outputs) {
    expect(output.locked).toBe(false);
  }

  const addrMap = getAddressBalanceMap(tx.inputs, tx.outputs);
  expect(addrMap).toStrictEqual(expectedAddrMap);

  // update tx to contain outputs with timelock
  tx.outputs[0].decoded.timelock = now - 1;   // won't be locked
  tx.outputs[1].decoded.timelock = now;       // won't be locked
  tx.outputs[2].decoded.timelock = now + 1;   // locked

  // should mark the corresponding output as locked
  markLockedOutputs(tx.outputs, now, false);
  expect(tx.outputs[0].locked).toBe(false);
  expect(tx.outputs[1].locked).toBe(false);
  expect(tx.outputs[2].locked).toBe(true);

  // check balance
  map2.set('token1', new Balance(11, -3, 11, now + 1));
  const addrMap2 = getAddressBalanceMap(tx.inputs, tx.outputs);
  expect(addrMap2).toStrictEqual(expectedAddrMap);

  // a block will have its rewards locked, even with no timelock
  tx.inputs = [];
  tx.outputs = [
    createOutput(0, 100, 'address1', 'token1'),
  ];
  markLockedOutputs(tx.outputs, now, true);
  for (const output of tx.outputs) {
    expect(output.locked).toBe(true);
  }
  const addrMap3 = getAddressBalanceMap(tx.inputs, tx.outputs);
  const map3 = new TokenBalanceMap();
  map3.set('token1', new Balance(100, 0, 100));
  const expectedAddrMap2 = {
    address1: map3,
  };
  expect(addrMap3).toStrictEqual(expectedAddrMap2);

  // tx with authorities
  tx.inputs = [
    createInput(0b01, 'address1', 'inputTx', 0, 'token1', null, 129),
    createInput(0b10, 'address1', 'inputTx', 1, 'token2', null, 129),
  ];
  tx.outputs = [
    createOutput(0, 0b01, 'address1', 'token1', null, false, 129),
    createOutput(1, 0b10, 'address1', 'token2', 1000, true, 129),
  ];
  const map4 = new TokenBalanceMap();
  map4.set('token1', new Balance(0, 0, 0, null));
  map4.set('token2', new Balance(0, 0, 0, 1000, new Authorities([-1, 0]), new Authorities([1, 0])));
  const expectedAddrMap4 = {
    address1: map4,
  };
  const addrMap4 = getAddressBalanceMap(tx.inputs, tx.outputs);
  expect(addrMap4).toStrictEqual(expectedAddrMap4);
});

test('getWalletBalanceMap', () => {
  expect.hasAssertions();
  const mapAddress1 = new TokenBalanceMap();
  mapAddress1.set('token1', new Balance(1, -10, 0));
  mapAddress1.set('token2', new Balance(0, -7, 0));
  mapAddress1.set('token3', new Balance(27, 2, 0));
  const mapAddress2 = new TokenBalanceMap();
  mapAddress2.set('token1', new Balance(10, 8, 0));
  const mapAddress3 = new TokenBalanceMap();
  mapAddress3.set('token2', new Balance(4, 2, 0));
  mapAddress3.set('token3', new Balance(12, 6, 0));
  const mapAddress4 = new TokenBalanceMap();
  mapAddress4.set('token1', new Balance(10, 2, 0));
  mapAddress4.set('token2', new Balance(14, 9, 1, 500));
  const mapAddress5 = new TokenBalanceMap();
  mapAddress5.set('token1', new Balance(20, 11, 0));
  const addressBalanceMap = {
    address1: mapAddress1,
    address2: mapAddress2,
    address3: mapAddress3,
    address4: mapAddress4,
    address5: mapAddress5,    // doesn't belong to any started wallet
  };
  const walletAddressMap = {
    address1: { walletId: 'wallet1', xpubkey: 'xpubkey1', authXpubkey: 'authxpubkey1', maxGap: 5 },
    address2: { walletId: 'wallet1', xpubkey: 'xpubkey1', authXpubkey: 'authxpubkey1', maxGap: 5 },
    address4: { walletId: 'wallet1', xpubkey: 'xpubkey1', authXpubkey: 'authxpubkey1', maxGap: 5 },
    address3: { walletId: 'wallet2', xpubkey: 'xpubkey2', authXpubkey: 'authxpubkey2', maxGap: 5 },
  };
  const mapWallet1 = new TokenBalanceMap();
  mapWallet1.set('token1', new Balance(21, 0, 0));
  mapWallet1.set('token2', new Balance(14, 2, 1, 500));
  mapWallet1.set('token3', new Balance(27, 2, 0));
  const mapWallet2 = new TokenBalanceMap();
  mapWallet2.set('token2', new Balance(4, 2, 0));
  mapWallet2.set('token3', new Balance(12, 6, 0));
  const expectedWalletBalanceMap = {
    wallet1: mapWallet1,
    wallet2: mapWallet2,
  };
  const walletBalanceMap = getWalletBalanceMap(walletAddressMap, addressBalanceMap);
  expect(walletBalanceMap).toStrictEqual(expectedWalletBalanceMap);

  // if walletAddressMap is empty, should also return an empty object
  const walletBalanceMap2 = getWalletBalanceMap({}, addressBalanceMap);
  expect(walletBalanceMap2).toStrictEqual({});
});

test('unlockUtxos', async () => {
  expect.hasAssertions();
  const reward = 6400;
  const txId1 = 'txId1';
  const txId2 = 'txId2';
  const txId3 = 'txId3';
  const txId4 = 'txId4';
  const txId5 = 'txId5';
  const token = 'tokenId';
  const addr = 'address';
  const walletId = 'walletId';
  const now = 1000;
  await addToUtxoTable(mysql, [
  // blocks with heightlock
    {
      txId: txId1,
      index: 0,
      tokenId: token,
      address: addr,
      value: reward,
      authorities: 0,
      timelock: null,
      heightlock: 3,
      locked: true,
      spentBy: null,
    }, {
      txId: txId2,
      index: 0,
      tokenId: token,
      address: addr,
      value: reward,
      authorities: 0,
      timelock: null,
      heightlock: 4,
      locked: true,
      spentBy: null,
    },
    // some transactions with timelock
    {
      txId: txId3,
      index: 0,
      tokenId: token,
      address: addr,
      value: 2500,
      authorities: 0,
      timelock: now,
      heightlock: null,
      locked: true,
      spentBy: null,
    }, {
      txId: txId4,
      index: 0,
      tokenId: token,
      address: addr,
      value: 2500,
      authorities: 0,
      timelock: now * 2,
      heightlock: null,
      locked: true,
      spentBy: null,
    }, {
      txId: txId5,
      index: 0,
      tokenId: token,
      address: addr,
      value: 0,
      authorities: 0b10,
      timelock: now * 3,
      heightlock: null,
      locked: true,
      spentBy: null,
    },
  ]);

  await addToWalletTable(mysql, [{
    id: walletId,
    xpubkey: 'xpub',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 10,
    createdAt: now,
    readyAt: now + 1,
  }]);

  await addToAddressTable(mysql, [{
    address: addr,
    index: 0,
    walletId,
    transactions: 1,
  }]);

  await addToAddressBalanceTable(mysql, [
    [addr, token, 0, 2 * reward + 5000, now, 5, 0, 0b10, 4 * reward + 5000],
  ]);

  await addToWalletBalanceTable(mysql, [{
    walletId,
    tokenId: token,
    unlockedBalance: 0,
    lockedBalance: 2 * reward + 5000,
    unlockedAuthorities: 0,
    lockedAuthorities: 0b10,
    timelockExpires: now,
    transactions: 5,
  }]);

  const utxo: DbTxOutput = {
    txId: txId1,
    index: 0,
    tokenId: token,
    address: addr,
    value: reward,
    authorities: 0,
    timelock: null,
    heightlock: 3,
    locked: true,
  };

  // unlock txId1
  await unlockUtxos(mysql, [utxo], false);
  await expect(
    checkUtxoTable(mysql, 5, txId1, 0, utxo.tokenId, utxo.address, utxo.value, 0, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, reward, reward + 5000, now, 5, 0, 0b10)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, reward, reward + 5000, now, 5, 0, 0b10)).resolves.toBe(true);

  // unlock txId2
  utxo.txId = txId2;
  utxo.heightlock = 4;
  await unlockUtxos(mysql, [utxo], false);
  await expect(
    checkUtxoTable(mysql, 5, txId2, 0, utxo.tokenId, utxo.address, utxo.value, 0, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 2 * reward, 5000, now, 5, 0, 0b10)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 2 * reward, 5000, now, 5, 0, 0b10)).resolves.toBe(true);

  // unlock txId3, txId4 is still locked
  utxo.txId = txId3;
  utxo.value = 2500;
  utxo.timelock = now;
  utxo.heightlock = null;
  await unlockUtxos(mysql, [utxo], true);
  await expect(
    checkUtxoTable(mysql, 5, txId3, 0, utxo.tokenId, utxo.address, utxo.value, 0, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 2 * reward + 2500, 2500, 2 * now, 5, 0, 0b10)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 2 * reward + 2500, 2500, 2 * now, 5, 0, 0b10)).resolves.toBe(true);

  // unlock txId4
  utxo.txId = txId4;
  utxo.value = 2500;
  utxo.timelock = now * 2;
  utxo.heightlock = null;
  await unlockUtxos(mysql, [utxo], true);
  await expect(
    checkUtxoTable(mysql, 5, txId4, 0, utxo.tokenId, utxo.address, utxo.value, 0, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 2 * reward + 5000, 0, 3 * now, 5, 0, 0b10)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 2 * reward + 5000, 0, 3 * now, 5, 0, 0b10)).resolves.toBe(true);

  // unlock txId5
  utxo.txId = txId5;
  utxo.value = 0;
  utxo.authorities = 0b10;
  utxo.timelock = now * 3;
  utxo.heightlock = null;
  await unlockUtxos(mysql, [utxo], true);
  await expect(
    checkUtxoTable(mysql, 5, txId5, 0, utxo.tokenId, utxo.address, utxo.value, utxo.authorities, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 2 * reward + 5000, 0, null, 5, 0b10, 0)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 2 * reward + 5000, 0, null, 5, 0b10, 0)).resolves.toBe(true);
});

test('unlockTimelockedUtxos', async () => {
  expect.hasAssertions();

  const reward = 6400;
  const txId1 = 'txId1';
  const txId2 = 'txId2';
  const txId3 = 'txId3';
  const token = 'tokenId';
  const addr = 'address';
  const walletId = 'walletId';
  const now = 1000;
  await addToUtxoTable(mysql, [{
    txId: txId1,
    index: 0,
    tokenId: token,
    address: addr,
    value: 2500,
    authorities: 0,
    timelock: now,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    txId: txId2,
    index: 0,
    tokenId: token,
    address: addr,
    value: 2500,
    authorities: 0,
    timelock: now * 2,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    txId: txId3,
    index: 0,
    tokenId: token,
    address: addr,
    value: 0,
    authorities: 0b10,
    timelock: now * 3,
    heightlock: null,
    locked: true,
    spentBy: null,
  }]);

  await addToWalletTable(mysql, [{
    id: walletId,
    xpubkey: 'xpub',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 10,
    createdAt: now,
    readyAt: now + 1,
  }]);

  await addToAddressTable(mysql, [{
    address: addr,
    index: 0,
    walletId,
    transactions: 3,
  }]);

  await addToAddressBalanceTable(mysql, [
    [addr, token, 0, 5000, now, 3, 0, 0b10, 10000],
  ]);

  await addToWalletBalanceTable(mysql, [{
    walletId,
    tokenId: token,
    unlockedBalance: 0,
    lockedBalance: 5000,
    unlockedAuthorities: 0,
    lockedAuthorities: 0b10,
    timelockExpires: now,
    transactions: 3,
  }]);

  const utxo: DbTxOutput = {
    txId: txId1,
    index: 0,
    tokenId: token,
    address: addr,
    value: reward,
    authorities: 0,
    timelock: null,
    heightlock: 3,
    locked: true,
  };

  // unlock txId1, txId2 is still locked
  utxo.txId = txId1;
  utxo.value = 2500;
  utxo.timelock = now;
  utxo.heightlock = null;
  await unlockTimelockedUtxos(mysql, now + 1);
  await expect(
    checkUtxoTable(mysql, 3, txId1, 0, utxo.tokenId, utxo.address, utxo.value, 0, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 2500, 2500, 2 * now, 3, 0, 0b10)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 2500, 2500, 2 * now, 3, 0, 0b10)).resolves.toBe(true);

  // unlock txId2
  utxo.txId = txId2;
  utxo.value = 2500;
  utxo.timelock = now * 2;
  utxo.heightlock = null;
  await unlockTimelockedUtxos(mysql, (now * 2) + 1);
  await expect(
    checkUtxoTable(mysql, 3, txId2, 0, utxo.tokenId, utxo.address, utxo.value, 0, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 5000, 0, 3 * now, 3, 0, 0b10)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 5000, 0, 3 * now, 3, 0, 0b10)).resolves.toBe(true);

  // unlock txId3
  utxo.txId = txId3;
  utxo.value = 0;
  utxo.authorities = 0b10;
  utxo.timelock = now * 3;
  utxo.heightlock = null;
  await unlockTimelockedUtxos(mysql, (now * 3) + 1);
  await expect(
    checkUtxoTable(mysql, 3, txId3, 0, utxo.tokenId, utxo.address, utxo.value, utxo.authorities, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 5000, 0, null, 3, 0b10, 0)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 5000, 0, null, 3, 0b10, 0)).resolves.toBe(true);
});

test('maybeRefreshWalletConstants with an uninitialized version_data database should call hathorLib.version.checkApiVersion()', async () => {
  expect.hasAssertions();

  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');

  const mockGet = jest.fn(() => Promise.resolve({
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
  }));

  spy.mockReturnValue({
    post: () => Promise.resolve({
      data: {
        success: true,
      },
    }),
    get: mockGet,
  });

  await maybeRefreshWalletConstants(mysql);

  expect(mockGet).toHaveBeenCalledTimes(1);
});

test('maybeRefreshWalletConstants with an initialized version_data database should query data from the database', async () => {
  expect.hasAssertions();

  const axiosSpy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  const mockGet = jest.fn(() => Promise.resolve({ data: {} }));

  axiosSpy.mockReturnValue({ get: mockGet });

  const mockedVersionData: FullNodeVersionData = {
    timestamp: new Date().getTime(),
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

  await updateVersionData(mysql, mockedVersionData);

  await maybeRefreshWalletConstants(mysql);

  const {
    txMinWeight,
    txWeightCoefficient,
    txMinWeightK,
  } = hathorLib.transaction.getTransactionWeightConstants();

  const maxNumberInputs = hathorLib.transaction.getMaxInputsConstant();
  const maxNumberOutputs = hathorLib.transaction.getMaxOutputsConstant();

  expect(mockGet).toHaveBeenCalledTimes(0);
  expect(txMinWeight).toStrictEqual(mockedVersionData.minTxWeight);
  expect(txWeightCoefficient).toStrictEqual(mockedVersionData.minTxWeightCoefficient);
  expect(txMinWeightK).toStrictEqual(mockedVersionData.minTxWeightK);
  expect(maxNumberInputs).toStrictEqual(mockedVersionData.maxNumberInputs);
  expect(maxNumberOutputs).toStrictEqual(mockedVersionData.maxNumberOutputs);
});

test('searchForLatestValidBlock should find the first voided block', async () => {
  expect.hasAssertions();

  const spy = jest.spyOn(Utils, 'isTxVoided');

  const mockImplementation = jest.fn(async (block: string): Promise<[boolean, any]> => {
    const voidedList = [
      '0000000f1fbb4bd8a8e71735af832be210ac9a6c1e2081b21faeea3c0f5797f7',
      '00000649d769de25fcca204faaa23d4974d00fcb01130ab3f736fade4013598d',
      '000002e185a37162bbcb1ec43576056638f0fad43648ae070194d1e1105f339a',
      '00000597288221301f856e245579e7d32cea3e257330f9cb10178bb487b343e5',
    ];

    if (voidedList.indexOf(block) > -1) {
      return [true, {}];
    }

    return [false, {}];
  });

  spy.mockImplementation(mockImplementation);

  const mockData: Block[] = TX_IDS.map((tx, index) => ({
    txId: tx,
    height: index,
    timestamp: 0,
  }));

  for (let i = 0; i < mockData.length; i++) {
    await addOrUpdateTx(mysql, mockData[i].txId, mockData[i].height, i, 0, 60);
  }

  const result = await searchForLatestValidBlock(mysql);

  expect(result.txId).toStrictEqual('000005cbcb8b29f74446a260cd7d36fab3cba1295ac9fe904795d7b064e0e53c');
});

describe('getWalletBalancesForTx', () => {
  it('should return an empty list when tx has no started wallet', async () => {
    expect.hasAssertions();

    // create a wallet
    const wallet1 = {
      id: 'wallet1',
    };
    await createWallet(mysql, wallet1.id, XPUBKEY, AUTH_XPUBKEY, 5);

    const addr1 = 'addr1';
    const addr2 = 'addr2';

    // add a transaction
    const tx1 = {
      id: 'txId1',
      height: 1,
      timestamp: 10,
      version: 3,
      weight: 65.4321,
    };
    await addOrUpdateTx(mysql, tx1.id, tx1.height, tx1.timestamp, tx1.version, tx1.weight);

    // instantiate a token
    const token1 = {
      id: 'token1',
      name: 'Token 1',
      symbol: 'T1',
    };
    await storeTokenInformation(mysql, token1.id, token1.name, token1.symbol);

    // transaction base
    const utxos = [
      { index: 0, value: 5, address: addr1, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
      { index: 1, value: 5, address: addr2, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
    ];

    // instantiate outputs
    const outputs = utxos.map((utxo) => createOutput(
      utxo.index,
      utxo.value,
      utxo.address,
      utxo.tokenId,
      utxo.timelock,
      utxo.locked,
      utxo.tokenData,
    ));
    await addUtxos(mysql, tx1.id, outputs);

    // instantiate inputs
    const input = createInput(
      utxos[0].value,
      utxos[0].address,
      tx1.id,
      utxos[0].index,
      utxos[0].tokenId,
      utxos[0].timelock,
      utxos[0].tokenData,
    ) as TxInput;
    await updateTxOutputSpentBy(mysql, [input], tx1.id);

    const tx = {
      tx_id: tx1.id,
      nonce: 10,
      timestamp: tx1.timestamp,
      version: tx1.version,
      weight: tx1.weight,
      parents: [],
      inputs: [input],
      outputs: [outputs[1] as TxOutput],
      height: tx1.height,
      token_name: token1.name,
      token_symbol: token1.symbol,
    } as Transaction;
    const result = await getWalletBalancesForTx(mysql, tx);

    expect(result).toStrictEqual({});
  });

  it('should return a list of WalletBalance when tx has a started wallet', async () => {
    expect.hasAssertions();

    // create a wallet
    const wallet1 = {
      id: 'wallet1',
    };
    await createWallet(mysql, wallet1.id, XPUBKEY, AUTH_XPUBKEY, 5);

    // register an andress to started wallet
    const addr1 = 'addr1';
    await addToAddressTable(mysql, [
      { address: addr1, index: 0, walletId: wallet1.id, transactions: 0 },
    ]);
    // address without started wallet
    const addr2 = 'addr2';

    // add a transaction
    const tx1 = {
      id: 'txId1',
      height: 1,
      timestamp: 10,
      version: 3,
      weight: 65.4321,
    };
    // The persistence is not necessary, but used for state consistency
    await addOrUpdateTx(mysql, tx1.id, tx1.height, tx1.timestamp, tx1.version, tx1.weight);

    // instantiate a token
    const token1 = {
      id: 'token1',
      name: 'Token 1',
      symbol: 'T1',
    };
    await storeTokenInformation(mysql, token1.id, token1.name, token1.symbol);

    // instantiate token balance
    const balanceToken1 = {
      unlocked: 5,
      locked: 0,
      lockExpires: null,
      transactions: 1,
      unlockedAuthorities: new Authorities(0b01),
      lockedAuthorities: 0,
    };

    // update wallet state by tx1
    const walletBalanceMap1 = {
      [wallet1.id]: TokenBalanceMap.fromStringMap({
        [token1.id]: balanceToken1,
      }),
    };
    await updateWalletTablesWithTx(mysql, tx1.id, tx1.timestamp, walletBalanceMap1);

    // transaction base
    const utxos = [
      { index: 0, value: 5, address: addr1, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
      { index: 1, value: 5, address: addr2, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
    ];

    // instantiate outputs
    const outputs = utxos.map((utxo) => createOutput(
      utxo.index,
      utxo.value,
      utxo.address,
      utxo.tokenId,
      utxo.timelock,
      utxo.locked,
      utxo.tokenData,
    ));
    await addUtxos(mysql, tx1.id, outputs);

    // instantiate inputs
    const input = createInput(
      utxos[0].value,
      utxos[0].address,
      tx1.id,
      utxos[0].index,
      utxos[0].tokenId,
      utxos[0].timelock,
      utxos[0].tokenData,
    ) as TxInput;
    await updateTxOutputSpentBy(mysql, [input], tx1.id);

    const tx = {
      tx_id: tx1.id,
      nonce: 10,
      timestamp: tx1.timestamp,
      version: tx1.version,
      weight: tx1.weight,
      parents: [],
      inputs: [input],
      outputs: [outputs[1] as TxOutput],
      height: tx1.height,
      token_name: token1.name,
      token_symbol: token1.symbol,
    } as Transaction;
    const result = await getWalletBalancesForTx(mysql, tx);

    expect(result).toStrictEqual({
      wallet1: {
        walletId: 'wallet1',
        addresses: [
          'addr1',
        ],
        txId: 'txId1',
        walletBalanceForTx: [
          {
            tokenId: 'token1',
            tokenSymbol: 'T1',
            lockExpires: null,
            lockedAmount: 0,
            lockedAuthorities: {
              melt: false,
              mint: false,
            },
            totalAmountSent: 0,
            unlockedAmount: -5,
            unlockedAuthorities: {
              melt: false,
              mint: false,
            },
            total: -5,
          },
        ],
      },
    });
  });

  describe('should be sorted by absolute token balance', () => {
    it('sending token', async () => {
      expect.hasAssertions();
      // create a wallet
      const wallet1 = {
        id: 'wallet1',
      };
      await createWallet(mysql, wallet1.id, XPUBKEY, AUTH_XPUBKEY, 5);

      // register an andress to started wallet
      const addr1 = 'addr1';
      await addToAddressTable(mysql, [
        { address: addr1, index: 0, walletId: wallet1.id, transactions: 0 },
      ]);
      // address without started wallet
      const addr2 = 'addr2';

      // add a transaction
      const tx1 = {
        id: 'txId1',
        height: 1,
        timestamp: 10,
        version: 3,
        weight: 65.4321,
      };
      // The persistence is not necessary, but used for state consistency
      await addOrUpdateTx(mysql, tx1.id, tx1.height, tx1.timestamp, tx1.version, tx1.weight);

      // instantiate a token
      const token1 = {
        id: 'token1',
        name: 'Token 1',
        symbol: 'T1',
      };
      await storeTokenInformation(mysql, token1.id, token1.name, token1.symbol);
      const token2 = {
        id: 'token2',
        name: 'Token 2',
        symbol: 'T2',
      };
      await storeTokenInformation(mysql, token2.id, token2.name, token2.symbol);

      // instantiate token balance
      const balanceToken1 = {
        unlocked: 5,
        locked: 0,
        lockExpires: null,
        transactions: 1,
        unlockedAuthorities: new Authorities(0b01),
        lockedAuthorities: 0,
      };
      const balanceToken2 = {
        unlocked: 10,
        locked: 0,
        lockExpires: null,
        transactions: 1,
        unlockedAuthorities: new Authorities(0b01),
        lockedAuthorities: 0,
      };

      // update wallet state by tx1
      const wallet1BalanceMap = {
        [wallet1.id]: TokenBalanceMap.fromStringMap({
          [token1.id]: balanceToken1,
          [token2.id]: balanceToken2,
        }),
      };
      await updateWalletTablesWithTx(mysql, tx1.id, tx1.timestamp, wallet1BalanceMap);

      // transaction base
      const utxos = [
        { index: 0, value: 5, address: addr1, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
        { index: 1, value: 5, address: addr2, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
        { index: 2, value: 10, address: addr1, tokenId: token2.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
      ];

      // instantiate outputs
      const outputs = utxos.map((utxo) => createOutput(
        utxo.index,
        utxo.value,
        utxo.address,
        utxo.tokenId,
        utxo.timelock,
        utxo.locked,
        utxo.tokenData,
      ));
      await addUtxos(mysql, tx1.id, outputs);

      // instantiate inputs
      const inputToken1 = createInput(
        utxos[0].value,
        utxos[0].address,
        tx1.id,
        utxos[0].index,
        utxos[0].tokenId,
        utxos[0].timelock,
        utxos[0].tokenData,
      ) as TxInput;
      const inputToken2 = createInput(
        utxos[2].value,
        utxos[2].address,
        tx1.id,
        utxos[2].index,
        utxos[2].tokenId,
        utxos[2].timelock,
        utxos[2].tokenData,
      ) as TxInput;

      const tx = {
        tx_id: tx1.id,
        nonce: 10,
        timestamp: tx1.timestamp,
        version: tx1.version,
        weight: tx1.weight,
        parents: [],
        inputs: [inputToken1, inputToken2],
        outputs: [outputs[1] as TxOutput],
        height: tx1.height,
        token_name: token1.name,
        token_symbol: token1.symbol,
      } as Transaction;
      const result = await getWalletBalancesForTx(mysql, tx);

      expect(result).toStrictEqual({
        wallet1: {
          walletId: 'wallet1',
          addresses: [
            'addr1',
          ],
          txId: 'txId1',
          walletBalanceForTx: [
            {
              tokenId: 'token2',
              tokenSymbol: 'T2',
              lockExpires: null,
              lockedAmount: 0,
              lockedAuthorities: {
                melt: false,
                mint: false,
              },
              total: -10,
              totalAmountSent: 0,
              unlockedAmount: -10,
              unlockedAuthorities: {
                melt: false,
                mint: false,
              },
            },
            {
              tokenId: 'token1',
              tokenSymbol: 'T1',
              lockExpires: null,
              lockedAmount: 0,
              lockedAuthorities: {
                melt: false,
                mint: false,
              },
              totalAmountSent: 0,
              unlockedAmount: -5,
              unlockedAuthorities: {
                melt: false,
                mint: false,
              },
              total: -5,
            },
          ],
        },
      });
    });

    it('receiving token', async () => {
      expect.hasAssertions();

      // create a wallet
      const wallet1 = {
        id: 'wallet1',
      };
      await createWallet(mysql, wallet1.id, XPUBKEY, AUTH_XPUBKEY, 5);

      // register an andress to started wallet
      const addr1 = 'addr1';
      // address without started wallet
      const addr2 = 'addr2';
      await addToAddressTable(mysql, [
        { address: addr2, index: 0, walletId: wallet1.id, transactions: 0 },
      ]);

      // add a transaction
      const tx1 = {
        id: 'txId1',
        height: 1,
        timestamp: 10,
        version: 3,
        weight: 65.4321,
      };
      // The persistence is not necessary, but used for state consistency
      await addOrUpdateTx(mysql, tx1.id, tx1.height, tx1.timestamp, tx1.version, tx1.weight);

      // instantiate a token
      const token1 = {
        id: 'token1',
        name: 'Token 1',
        symbol: 'T1',
      };
      await storeTokenInformation(mysql, token1.id, token1.name, token1.symbol);
      const token2 = {
        id: 'token2',
        name: 'Token 2',
        symbol: 'T2',
      };
      await storeTokenInformation(mysql, token2.id, token2.name, token2.symbol);

      // instantiate token balance
      const balanceToken1 = {
        unlocked: 5,
        locked: 0,
        lockExpires: null,
        transactions: 1,
        unlockedAuthorities: new Authorities(0b01),
        lockedAuthorities: 0,
      };
      const balanceToken2 = {
        unlocked: 10,
        locked: 0,
        lockExpires: null,
        transactions: 1,
        unlockedAuthorities: new Authorities(0b01),
        lockedAuthorities: 0,
      };

      // update wallet state by tx1
      const wallet1BalanceMap = {
        [wallet1.id]: TokenBalanceMap.fromStringMap({
          [token1.id]: balanceToken1,
          [token2.id]: balanceToken2,
        }),
      };
      await updateWalletTablesWithTx(mysql, tx1.id, tx1.timestamp, wallet1BalanceMap);

      // transaction base
      const utxos = [
        { index: 0, value: 5, address: addr1, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
        { index: 1, value: 5, address: addr2, tokenId: token1.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
        { index: 2, value: 10, address: addr1, tokenId: token2.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
        { index: 3, value: 10, address: addr2, tokenId: token2.id, locked: false, timelock: null, tokenData: 0, spentBy: null },
      ];

      // instantiate outputs
      const outputs = utxos.map((utxo) => createOutput(
        utxo.index,
        utxo.value,
        utxo.address,
        utxo.tokenId,
        utxo.timelock,
        utxo.locked,
        utxo.tokenData,
      ));
      await addUtxos(mysql, tx1.id, outputs);

      // instantiate inputs
      const inputToken1 = createInput(
        utxos[0].value,
        utxos[0].address,
        tx1.id,
        utxos[0].index,
        utxos[0].tokenId,
        utxos[0].timelock,
        utxos[0].tokenData,
      ) as TxInput;
      const inputToken2 = createInput(
        utxos[2].value,
        utxos[2].address,
        tx1.id,
        utxos[2].index,
        utxos[2].tokenId,
        utxos[2].timelock,
        utxos[2].tokenData,
      ) as TxInput;

      const tx = {
        tx_id: tx1.id,
        nonce: 10,
        timestamp: tx1.timestamp,
        version: tx1.version,
        weight: tx1.weight,
        parents: [],
        inputs: [inputToken1, inputToken2],
        outputs: [outputs[1] as TxOutput, outputs[3] as TxOutput],
        height: tx1.height,
        token_name: token1.name,
        token_symbol: token1.symbol,
      } as Transaction;
      const result = await getWalletBalancesForTx(mysql, tx);

      expect(result).toStrictEqual({
        wallet1: {
          walletId: 'wallet1',
          addresses: [
            'addr2',
          ],
          txId: 'txId1',
          walletBalanceForTx: [
            {
              tokenId: 'token2',
              tokenSymbol: 'T2',
              lockExpires: null,
              lockedAmount: 0,
              lockedAuthorities: {
                melt: false,
                mint: false,
              },
              total: 10,
              totalAmountSent: 10,
              unlockedAmount: 10,
              unlockedAuthorities: {
                melt: false,
                mint: false,
              },
            },
            {
              tokenId: 'token1',
              tokenSymbol: 'T1',
              lockExpires: null,
              lockedAmount: 0,
              lockedAuthorities: {
                melt: false,
                mint: false,
              },
              totalAmountSent: 5,
              unlockedAmount: 5,
              unlockedAuthorities: {
                melt: false,
                mint: false,
              },
              total: 5,
            },
          ],
        },
      });
    });
  });
});
