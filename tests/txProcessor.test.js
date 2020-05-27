import * as txProcessor from '../txProcessor';

import eventTemplate from '../events/eventTemplate.json';

import {
  cleanDatabase,
  checkUtxoTable,
  checkAddressTable,
  checkAddressBalanceTable,
  checkAddressTxHistoryTable,
  createOutput,
  createInput,
} from './utils';
import { getDbConnection } from '../utils';

const mysql = getDbConnection();
const blockReward = 6400;


beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await mysql.quit();
});


test('getAddressBalanceMap', () => {
  const evt = JSON.parse(JSON.stringify(eventTemplate));
  const tx = evt.Records[0].body;
  tx.tx_id = 'txId1';
  tx.timestamp = 200000;
  tx.inputs = [
    createInput({value: 10, address: 'address1', txId: 'inputTx', index: 0, token: 'token1'}),
    createInput({value: 5, address: 'address1', txId: 'inputTx', index: 0, token: 'token1'}),
    createInput({value: 7, address: 'address1', txId: 'inputTx', index: 1, token: 'token2'}),
    createInput({value: 3, address: 'address2', txId: 'inputTx', index: 2, token: 'token1'}),
  ];
  tx.outputs = [
    createOutput({value: 5, address: 'address1', token: 'token1'}),
    createOutput({value: 2, address: 'address1', token: 'token3'}),
    createOutput({value: 11, address: 'address2', token: 'token1'}),
  ];
  const expectedAddrMap = {
    address1: {token1: -10, token2: -7, token3: 2},
    address2: {token1: 8},
  };
  const addrMap = txProcessor.getAddressBalanceMap(tx);
  expect(addrMap).toEqual(expectedAddrMap);
});


test('getWalletBalanceMap', () => {
  const addressBalanceMap = {
    address1: {token1: -10, token2: -7, token3: 2},
    address2: {token1: 8},
    address3: {token2: 2, token3: 6},
    address4: {token1: 2, token2: 9},
  };
  const walletAddressMap = {
    address1: 'wallet1',
    address2: 'wallet1',
    address4: 'wallet1',
    address3: 'wallet2',
  };
  const expectedWalletBalanceMap = {
    wallet1: {token1: 0, token2: 2, token3: 2},
    wallet2: {token2: 2, token3: 6},
  };
  const walletBalanceMap = txProcessor.getWalletBalanceMap(walletAddressMap, addressBalanceMap);
  expect(walletBalanceMap).toEqual(expectedWalletBalanceMap);

  // if walletAddressMap is empty, should also return an empty object
  const walletBalanceMap2 = txProcessor.getWalletBalanceMap({}, addressBalanceMap);
  expect(walletBalanceMap2).toEqual({});
});

/*
 * receive some transactions and blocks and make sure database is correct
 */
test('test txProcessor', async () => {
  //checkAddressTable = async (mysql, totalResults, address, index, walletId, transactions)
  //checkAddressBalanceTable = async (mysql, totalResults, address, tokenId, balance, transactions)
  // receive a block
  const evt = JSON.parse(JSON.stringify(eventTemplate));
  const block = evt.Records[0].body;
  block.tx_id = 'txId1';
  block.inputs = [];
  block.outputs = [createOutput({value: blockReward, address: 'address1'})];
  await txProcessor.onNewTxEvent(evt);
  // check databases
  await checkUtxoTable(mysql, 1, 'txId1', 0, '00', 'address1', blockReward, null);
  await checkAddressTable(mysql, 1, 'address1', null, null, 1);
  await checkAddressBalanceTable(mysql, 1, 'address1', '00', blockReward, 1);
  await checkAddressTxHistoryTable(mysql, 1, 'address1', 'txId1', '00', blockReward, block.timestamp);

  // receive another block, for the same address
  block.tx_id = 'txId2';
  block.timestamp += 10;
  await txProcessor.onNewTxEvent(evt);
  // we now have 2 blocks, still only 1 address
  await checkUtxoTable(mysql, 2, 'txId2', 0, '00', 'address1', blockReward, null);
  await checkAddressTable(mysql, 1, 'address1', null, null, 2);
  await checkAddressBalanceTable(mysql, 1, 'address1', '00', 2*blockReward, 2);
  await checkAddressTxHistoryTable(mysql, 2, 'address1', 'txId2', '00', blockReward, block.timestamp);

  // receive another block, for a different address
  block.tx_id = 'txId3';
  block.timestamp += 10;
  block.outputs = [createOutput({value: blockReward, address: 'address2'})];
  await txProcessor.onNewTxEvent(evt);
  // we now have 3 blocks and 2 addresses
  await checkUtxoTable(mysql, 3, 'txId3', 0, '00', 'address2', blockReward, null);
  await checkAddressTable(mysql, 2, 'address2', null, null, 1);
  await checkAddressBalanceTable(mysql, 2, 'address2', '00', blockReward, 1);
  await checkAddressTxHistoryTable(mysql, 3, 'address2', 'txId3', '00', blockReward, block.timestamp);
  // address1 still has the same balance
  await checkAddressBalanceTable(mysql, 2, 'address1', '00', 2*blockReward, 2);

  // spend first block to 2 other addresses
  const tx = evt.Records[0].body;
  tx.tx_id = 'txId4';
  tx.timestamp += 10;
  tx.inputs = [createInput({value: blockReward, address: 'address1', txId: 'txId1', index: 0})];
  tx.outputs = [
    createOutput({value: 5, address: 'address3'}),
    createOutput({value: blockReward - 5, address: 'address4'}),
  ];
  await txProcessor.onNewTxEvent(evt);
  for (const [index, output] of tx.outputs.entries()) {
    // we now have 4 utxos (had 3, 2 added and 1 removed)
    await checkUtxoTable(mysql, 4, tx.tx_id, index, output.token, output.decoded.address, output.value, output.decoded.timelock);
    // the 2 addresses on the outputs have been added to the address table, with null walletId and index
    await checkAddressTable(mysql, 4, output.decoded.address, null, null, 1);
    // there are 4 different addresses with some balance
    await checkAddressBalanceTable(mysql, 4, output.decoded.address, output.token, output.value, 1);
    await checkAddressTxHistoryTable(mysql, 6, output.decoded.address, tx.tx_id, output.token, output.value, tx.timestamp);
  }
  for (const input of tx.inputs) {
    // the input will have a negative amount in the address_tx_history table
    await checkAddressTxHistoryTable(mysql, 6, input.decoded.address, tx.tx_id, input.token, (-1)*input.value, tx.timestamp);
  }
  // address1 balance has decreased
  await checkAddressBalanceTable(mysql, 4, 'address1', '00', blockReward, 3);
});
