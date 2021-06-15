import eventTemplate from '@events/eventTemplate.json';
import tokenCreationTx from '@events/tokenCreationTx.json';
import { getLatestHeight, getTokenInformation } from '@src/db';
import * as txProcessor from '@src/txProcessor';
import { closeDbConnection, getDbConnection, isAuthority } from '@src/utils';
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

test('Genesis transactions should throw', async () => {
  expect.hasAssertions();

  const evt = JSON.parse(JSON.stringify(eventTemplate));
  const tx = evt.Records[0].body;

  tx.inputs = [];
  tx.outputs = [];
  tx.parents = [];

  process.env.NETWORK = 'mainnet';

  tx.tx_id = txProcessor.IGNORE_TXS.mainnet[0];

  await expect(() => txProcessor.onNewTxEvent(evt)).rejects.toThrow('Rejecting tx as it is part of the genesis transactions.');

  tx.tx_id = txProcessor.IGNORE_TXS.mainnet[1];

  await expect(() => txProcessor.onNewTxEvent(evt)).rejects.toThrow('Rejecting tx as it is part of the genesis transactions.');

  tx.tx_id = txProcessor.IGNORE_TXS.mainnet[2];

  await expect(() => txProcessor.onNewTxEvent(evt)).rejects.toThrow('Rejecting tx as it is part of the genesis transactions.');

  process.env.NETWORK = 'testnet';

  tx.tx_id = txProcessor.IGNORE_TXS.testnet[0];

  await expect(() => txProcessor.onNewTxEvent(evt)).rejects.toThrow('Rejecting tx as it is part of the genesis transactions.');

  tx.tx_id = txProcessor.IGNORE_TXS.testnet[1];

  await expect(() => txProcessor.onNewTxEvent(evt)).rejects.toThrow('Rejecting tx as it is part of the genesis transactions.');

  tx.tx_id = txProcessor.IGNORE_TXS.testnet[2];

  await expect(() => txProcessor.onNewTxEvent(evt)).rejects.toThrow('Rejecting tx as it is part of the genesis transactions.');
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
    if (isAuthority(output.token_data)) {     // eslint-disable-line no-bitwise
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
