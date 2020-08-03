import eventTemplate from '@events/eventTemplate.json';
import tokenCreationTx from '@events/tokenCreationTx.json';
import { getLatestHeight, getTokenInformation } from '@src/db';
import * as txProcessor from '@src/txProcessor';
import { Authorities, Balance, TokenBalanceMap, Utxo } from '@src/types';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  XPUBKEY,
  addToAddressTable,
  addToAddressBalanceTable,
  addToUtxoTable,
  addToWalletTable,
  addToWalletBalanceTable,
  cleanDatabase,
  checkUtxoTable,
  checkAddressTable,
  checkAddressBalanceTable,
  checkAddressTxHistoryTable,
  checkWalletBalanceTable,
  createOutput,
  createInput,
} from '@tests/utils';

const mysql = getDbConnection();
const blockReward = 6400;
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
    createOutput(5, 'address1', 'token1'),
    createOutput(2, 'address1', 'token3'),
    createOutput(11, 'address2', 'token1'),
  ];
  const map1 = new TokenBalanceMap();
  map1.set('token1', new Balance(-10, 0));
  map1.set('token2', new Balance(-7, 0));
  map1.set('token3', new Balance(2, 0));
  const map2 = new TokenBalanceMap();
  map2.set('token1', new Balance(8, 0));
  const expectedAddrMap = {
    address1: map1,
    address2: map2,
  };

  txProcessor.markLockedOutputs(tx.outputs, now, false);
  for (const output of tx.outputs) {
    expect(output.locked).toBe(false);
  }

  const addrMap = txProcessor.getAddressBalanceMap(tx.inputs, tx.outputs);
  expect(addrMap).toStrictEqual(expectedAddrMap);

  // update tx to contain outputs with timelock
  tx.outputs[0].decoded.timelock = now - 1;   // won't be locked
  tx.outputs[1].decoded.timelock = now;       // won't be locked
  tx.outputs[2].decoded.timelock = now + 1;   // locked

  // should mark the corresponding output as locked
  txProcessor.markLockedOutputs(tx.outputs, now, false);
  expect(tx.outputs[0].locked).toBe(false);
  expect(tx.outputs[1].locked).toBe(false);
  expect(tx.outputs[2].locked).toBe(true);

  // check balance
  map2.set('token1', new Balance(-3, 11, now + 1));
  const addrMap2 = txProcessor.getAddressBalanceMap(tx.inputs, tx.outputs);
  expect(addrMap2).toStrictEqual(expectedAddrMap);

  // a block will have its rewards locked, even with no timelock
  tx.inputs = [];
  tx.outputs = [
    createOutput(100, 'address1', 'token1'),
  ];
  txProcessor.markLockedOutputs(tx.outputs, now, true);
  for (const output of tx.outputs) {
    expect(output.locked).toBe(true);
  }
  const addrMap3 = txProcessor.getAddressBalanceMap(tx.inputs, tx.outputs);
  const map3 = new TokenBalanceMap();
  map3.set('token1', new Balance(0, 100));
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
    createOutput(0b01, 'address1', 'token1', null, false, 129),
    createOutput(0b10, 'address1', 'token2', 1000, true, 129),
  ];
  const map4 = new TokenBalanceMap();
  map4.set('token1', new Balance(0, 0, null));
  map4.set('token2', new Balance(0, 0, 1000, new Authorities([-1, 0]), new Authorities([1, 0])));
  const expectedAddrMap4 = {
    address1: map4,
  };
  const addrMap4 = txProcessor.getAddressBalanceMap(tx.inputs, tx.outputs);
  expect(addrMap4).toStrictEqual(expectedAddrMap4);
});

test('getWalletBalanceMap', () => {
  expect.hasAssertions();
  const mapAddress1 = new TokenBalanceMap();
  mapAddress1.set('token1', new Balance(-10, 0));
  mapAddress1.set('token2', new Balance(-7, 0));
  mapAddress1.set('token3', new Balance(2, 0));
  const mapAddress2 = new TokenBalanceMap();
  mapAddress2.set('token1', new Balance(8, 0));
  const mapAddress3 = new TokenBalanceMap();
  mapAddress3.set('token2', new Balance(2, 0));
  mapAddress3.set('token3', new Balance(6, 0));
  const mapAddress4 = new TokenBalanceMap();
  mapAddress4.set('token1', new Balance(2, 0));
  mapAddress4.set('token2', new Balance(9, 1, 500));
  const mapAddress5 = new TokenBalanceMap();
  mapAddress5.set('token1', new Balance(11, 0));
  const addressBalanceMap = {
    address1: mapAddress1,
    address2: mapAddress2,
    address3: mapAddress3,
    address4: mapAddress4,
    address5: mapAddress5,    // doesn't belong to any started wallet
  };
  const walletAddressMap = {
    address1: { walletId: 'wallet1', xpubkey: 'xpubkey1', maxGap: 5 },
    address2: { walletId: 'wallet1', xpubkey: 'xpubkey1', maxGap: 5 },
    address4: { walletId: 'wallet1', xpubkey: 'xpubkey1', maxGap: 5 },
    address3: { walletId: 'wallet2', xpubkey: 'xpubkey2', maxGap: 5 },
  };
  const mapWallet1 = new TokenBalanceMap();
  mapWallet1.set('token1', new Balance(0, 0));
  mapWallet1.set('token2', new Balance(2, 1, 500));
  mapWallet1.set('token3', new Balance(2, 0));
  const mapWallet2 = new TokenBalanceMap();
  mapWallet2.set('token2', new Balance(2, 0));
  mapWallet2.set('token3', new Balance(6, 0));
  const expectedWalletBalanceMap = {
    wallet1: mapWallet1,
    wallet2: mapWallet2,
  };
  const walletBalanceMap = txProcessor.getWalletBalanceMap(walletAddressMap, addressBalanceMap);
  expect(walletBalanceMap).toStrictEqual(expectedWalletBalanceMap);

  // if walletAddressMap is empty, should also return an empty object
  const walletBalanceMap2 = txProcessor.getWalletBalanceMap({}, addressBalanceMap);
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
    [txId1, 0, token, addr, reward, 0, null, 3, true],
    [txId2, 0, token, addr, reward, 0, null, 4, true],
    // some transactions with timelock
    [txId3, 0, token, addr, 2500, 0, now, null, true],
    [txId4, 0, token, addr, 2500, 0, now * 2, null, true],
    [txId5, 0, token, addr, 0, 0b10, now * 3, null, true],
  ]);

  await addToWalletTable(mysql, [
    [walletId, 'xpub', 'ready', 10, now, now + 1],
  ]);

  await addToAddressTable(mysql, [
    { address: addr, index: 0, walletId, transactions: 1 },
  ]);

  await addToAddressBalanceTable(mysql, [
    [addr, token, 0, 2 * reward + 5000, now, 5, 0, 0b10],
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

  const utxo: Utxo = {
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
  await txProcessor.unlockUtxos(mysql, [utxo], false);
  await expect(
    checkUtxoTable(mysql, 5, txId1, 0, utxo.tokenId, utxo.address, utxo.value, 0, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, reward, reward + 5000, now, 5, 0, 0b10)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, reward, reward + 5000, now, 5, 0, 0b10)).resolves.toBe(true);

  // unlock txId2
  utxo.txId = txId2;
  utxo.heightlock = 4;
  await txProcessor.unlockUtxos(mysql, [utxo], false);
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
  await txProcessor.unlockUtxos(mysql, [utxo], true);
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
  await txProcessor.unlockUtxos(mysql, [utxo], true);
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
  await txProcessor.unlockUtxos(mysql, [utxo], true);
  await expect(
    checkUtxoTable(mysql, 5, txId5, 0, utxo.tokenId, utxo.address, utxo.value, utxo.authorities, utxo.timelock, utxo.heightlock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, addr, token, 2 * reward + 5000, 0, null, 5, 0b10, 0)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 2 * reward + 5000, 0, null, 5, 0b10, 0)).resolves.toBe(true);
});

/*
 * In an unlikely scenario, we can receive a tx spending a UTXO that is still marked as locked.
 */
test('spend "locked" utxo', async () => {
  expect.hasAssertions();

  const txId1 = 'txId1';
  const txId2 = 'txId2';
  const token = 'tokenId';
  const addr = 'address';
  const walletId = 'walletId';
  const timelock = 1000;
  const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);

  await addToWalletTable(mysql, [
    [walletId, XPUBKEY, 'ready', 10, 1, 2],
  ]);

  await addToUtxoTable(mysql, [
    // we received a tx that has timelock
    [txId1, 0, token, addr, 2500, 0, timelock, null, true],
  ]);

  await addToAddressTable(mysql, [
    { address: addr, index: 0, walletId, transactions: 1 },
  ]);

  await addToAddressBalanceTable(mysql, [
    [addr, token, 0, 2500, timelock, 1, 0, 0],
  ]);

  await addToWalletBalanceTable(mysql, [{
    walletId,
    tokenId: token,
    unlockedBalance: 0,
    lockedBalance: 2500,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: timelock,
    transactions: 1,
  }]);

  // let's now receive a tx that spends this utxo, while it's still marked as locked
  const evt = JSON.parse(JSON.stringify(eventTemplate));
  const tx = evt.Records[0].body;
  tx.version = 1;
  tx.tx_id = txId2;
  tx.timestamp += timelock + 1;
  tx.inputs = [createInput(2500, addr, txId1, 0, token)];
  tx.outputs = [
    createOutput(2000, addr, token),    // one output to the same address
    createOutput(500, 'other', token),  // and one to another address
  ];
  await txProcessor.onNewTxEvent(evt);

  await expect(checkUtxoTable(mysql, 2, txId2, 0, token, addr, 2000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 2, txId2, 1, token, 'other', 500, 0, null, null, false)).resolves.toBe(true);
  await expect(checkAddressTable(mysql, maxGap + 2, addr, 0, walletId, 2)).resolves.toBe(true);
  await expect(checkAddressTable(mysql, maxGap + 2, 'other', null, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 2, addr, token, 2000, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 2, 'other', token, 500, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token, 2000, 0, null, 2)).resolves.toBe(true);
});

/*
 * receive some transactions and blocks and make sure database is correct
 */
test('txProcessor', async () => {
  expect.hasAssertions();
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);

  // receive a block
  const evt = JSON.parse(JSON.stringify(eventTemplate));
  const block = evt.Records[0].body;
  block.version = 0;
  block.tx_id = 'txId1';
  block.height = 1;
  block.inputs = [];
  block.outputs = [createOutput(blockReward, 'address1')];
  await txProcessor.onNewTxEvent(evt);
  // check databases
  await expect(checkUtxoTable(mysql, 1, 'txId1', 0, '00', 'address1', blockReward, 0, null, block.height + blockRewardLock, true)).resolves.toBe(true);
  await expect(checkAddressTable(mysql, 1, 'address1', null, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, 'address1', '00', 0, blockReward, null, 1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 1, 'address1', 'txId1', '00', blockReward, block.timestamp)).resolves.toBe(true);
  expect(await getLatestHeight(mysql)).toBe(block.height);

  // receive another block, for the same address
  block.tx_id = 'txId2';
  block.timestamp += 10;
  block.height += 1;
  await txProcessor.onNewTxEvent(evt);
  // we now have 2 blocks, still only 1 address
  await expect(checkUtxoTable(mysql, 2, 'txId2', 0, '00', 'address1', blockReward, 0, null, block.height + blockRewardLock, true)).resolves.toBe(true);
  await expect(checkAddressTable(mysql, 1, 'address1', null, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, 'address1', '00', blockReward, blockReward, null, 2)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 2, 'address1', 'txId2', '00', blockReward, block.timestamp)).resolves.toBe(true);
  expect(await getLatestHeight(mysql)).toBe(block.height);

  // receive another block, for a different address
  block.tx_id = 'txId3';
  block.timestamp += 10;
  block.height += 1;
  block.outputs = [createOutput(blockReward, 'address2')];
  await txProcessor.onNewTxEvent(evt);
  // we now have 3 blocks and 2 addresses
  await expect(checkUtxoTable(mysql, 3, 'txId3', 0, '00', 'address2', blockReward, 0, null, block.height + blockRewardLock, true)).resolves.toBe(true);
  await expect(checkAddressTable(mysql, 2, 'address2', null, null, 1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 3, 'address2', 'txId3', '00', blockReward, block.timestamp)).resolves.toBe(true);
  // new block reward is locked
  await expect(checkAddressBalanceTable(mysql, 2, 'address2', '00', 0, blockReward, null, 1)).resolves.toBe(true);
  // address1's balance is all unlocked now
  await expect(checkAddressBalanceTable(mysql, 2, 'address1', '00', 2 * blockReward, 0, null, 2)).resolves.toBe(true);
  expect(await getLatestHeight(mysql)).toBe(block.height);

  // spend first block to 2 other addresses
  const tx = evt.Records[0].body;
  tx.version = 1;
  tx.tx_id = 'txId4';
  tx.timestamp += 10;
  tx.inputs = [createInput(blockReward, 'address1', 'txId1', 0)];
  tx.outputs = [
    createOutput(5, 'address3'),
    createOutput(blockReward - 5, 'address4'),
  ];
  await txProcessor.onNewTxEvent(evt);
  expect(await getLatestHeight(mysql)).toBe(block.height);
  for (const [index, output] of tx.outputs.entries()) {
    const { token, decoded, value } = output;
    // we now have 4 utxos (had 3, 2 added and 1 removed)
    await expect(checkUtxoTable(mysql, 4, tx.tx_id, index, token, decoded.address, value, 0, decoded.timelock, null, false)).resolves.toBe(true);
    // the 2 addresses on the outputs have been added to the address table, with null walletId and index
    await expect(checkAddressTable(mysql, 4, decoded.address, null, null, 1)).resolves.toBe(true);
    // there are 4 different addresses with some balance
    await expect(checkAddressBalanceTable(mysql, 4, decoded.address, token, value, 0, null, 1)).resolves.toBe(true);
    await expect(checkAddressTxHistoryTable(mysql, 6, decoded.address, tx.tx_id, token, value, tx.timestamp)).resolves.toBe(true);
  }
  for (const input of tx.inputs) {
    const { decoded, token, value } = input;
    // the input will have a negative amount in the address_tx_history table
    await expect(checkAddressTxHistoryTable(mysql, 6, decoded.address, tx.tx_id, token, (-1) * value, tx.timestamp)).resolves.toBe(true);
  }
  // address1 balance has decreased
  await expect(checkAddressBalanceTable(mysql, 4, 'address1', '00', blockReward, 0, null, 3)).resolves.toBe(true);
  // address2 balance is still locked
  await expect(checkAddressBalanceTable(mysql, 4, 'address2', '00', 0, blockReward, null, 1)).resolves.toBe(true);
});

test('receive token creation tx', async () => {
  expect.hasAssertions();

  // we must already have a tx to be used for deposit
  await addToUtxoTable(mysql, [
    [tokenCreationTx.inputs[0].tx_id, tokenCreationTx.inputs[0].index, tokenCreationTx.inputs[0].token,
      tokenCreationTx.inputs[0].decoded.address, tokenCreationTx.inputs[0].value, 0, null, null, false],
  ]);
  await addToAddressBalanceTable(mysql, [[tokenCreationTx.inputs[0].decoded.address,
    tokenCreationTx.inputs[0].token, tokenCreationTx.inputs[0].value, 0, null, 1, 0, 0]]);

  // receive event
  const evt = JSON.parse(JSON.stringify(eventTemplate));
  evt.Records[0].body = tokenCreationTx;
  await txProcessor.onNewTxEvent(evt);

  for (const [index, output] of tokenCreationTx.outputs.entries()) {
    let value = output.value;
    let authorities = 0;
    if ((output.token_data & 0b10000000) > 0) {     // eslint-disable-line no-bitwise
      authorities = value;
      value = 0;
    }
    const { token } = output;
    const { address, timelock } = output.decoded;
    const length = tokenCreationTx.outputs.length;
    const transactions = index === 0 ? 2 : 1;   // this address already has the first tx received
    await expect(
      checkUtxoTable(mysql, length, tokenCreationTx.tx_id, index, token, address, value, authorities, timelock, null, false),
    ).resolves.toBe(true);
    await expect(checkAddressBalanceTable(mysql, length, address, token, value, 0, null, transactions, authorities, 0)).resolves.toBe(true);
  }
  const tokenInfo = await getTokenInformation(mysql, tokenCreationTx.tx_id);
  expect(tokenInfo.id).toBe(tokenCreationTx.tx_id);
  expect(tokenInfo.name).toBe(tokenCreationTx.token_name);
  expect(tokenInfo.symbol).toBe(tokenCreationTx.token_symbol);
});
