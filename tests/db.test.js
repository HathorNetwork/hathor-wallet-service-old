import {
  addNewAddresses,
  addUtxos,
  generateAddresses,
  getWalletAddressInfo,
  getWalletAddresses,
  getWalletBalances,
  getWalletStatus,
  initWalletBalance,
  initWalletTxHistory,
  removeUtxos,
  updateAddressTables,
  updateExistingAddresses,
  updateWalletStatus,
  updateWalletTables,
} from '../db';
import {
  xpubkey,
  addresses,
  cleanDatabase,
  checkAddressBalanceTable,
  checkAddressTable,
  checkAddressTxHistoryTable,
  checkUtxoTable,
  checkWalletBalanceTable,
  checkWalletTxHistoryTable,
  createOutput,
  createInput
} from './utils';
import { getDbConnection, getUnixTimestamp } from '../utils';

const mysql = getDbConnection();


const addrMap = {};
for (const [index, address] of addresses.entries()) {
  addrMap[address] = index;
}

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await mysql.quit();
});

test('generateAddresses', async () => {
  const maxGap = 5;
  const address0 = addresses[0];

  // check first with no addresses on database, so it should return only maxGap addresses
  let addressesInfo = await generateAddresses(mysql, xpubkey, maxGap);
  expect(addressesInfo.highestUsedIndex).toBe(-1);
  expect(addressesInfo.addresses.length).toBe(maxGap);
  expect(addressesInfo.existingAddresses).toEqual({});
  expect(Object.keys(addressesInfo.newAddresses).length).toBe(maxGap);
  expect(addressesInfo.addresses[0]).toBe(address0);

  // add first address with no transactions. As it's not used, we should still only generate maxGap addresses
  let entry = {address: address0, index: 0, transactions: 0};
  await mysql.query('INSERT INTO `address` SET ?', [entry]);
  addressesInfo = await generateAddresses(mysql, xpubkey, maxGap);
  expect(addressesInfo.highestUsedIndex).toBe(-1);
  expect(addressesInfo.addresses.length).toBe(maxGap);
  expect(addressesInfo.existingAddresses).toEqual({[address0]: 0});
  let totalLength = Object.keys(addressesInfo.addresses).length;
  let existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses).length).toBe(totalLength - existingLength);
  expect(addressesInfo.addresses[0]).toBe(address0);

  // mark address as used and check again
  let usedIndex = 0;
  await mysql.query('UPDATE `address` SET `transactions` = ? WHERE `address` = ?', [1, address0]);
  addressesInfo = await generateAddresses(mysql, xpubkey, maxGap);
  expect(addressesInfo.highestUsedIndex).toBe(usedIndex);
  expect(addressesInfo.addresses.length).toBe(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toEqual({[address0]: 0});
  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses).length).toBe(totalLength - existingLength);

  // add address with index 1 as used
  usedIndex = 1;
  const address1 = addresses[1];
  entry = {address: addresses[usedIndex], index: usedIndex, transactions: 1};
  await mysql.query('INSERT INTO `address` SET ?', [entry]);
  addressesInfo = await generateAddresses(mysql, xpubkey, maxGap);
  expect(addressesInfo.highestUsedIndex).toBe(usedIndex);
  expect(addressesInfo.addresses.length).toBe(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toEqual({[address0]: 0, [address1]: 1});
  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses).length).toBe(totalLength - existingLength);

  // add address with index 4 as used
  usedIndex = 4;
  const address4 = addresses[4];
  entry = {address: addresses[usedIndex], index: usedIndex, transactions: 1};
  await mysql.query('INSERT INTO `address` SET ?', [entry]);
  addressesInfo = await generateAddresses(mysql, xpubkey, maxGap);
  expect(addressesInfo.highestUsedIndex).toBe(usedIndex);
  expect(addressesInfo.addresses.length).toBe(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toEqual({[address0]: 0, [address1]: 1, [address4]: 4});
  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses).length).toBe(totalLength - existingLength);

  // make sure no address was skipped from being generated
  for (const [index, address] of addressesInfo.addresses.entries()) {
    expect(addresses[index]).toBe(address);
  }
}, 10000);

test('getWalletAddressInfo', async () => {
  const finalWalletAddressMap = {
    'addr1': 'wallet1',
    'addr2': 'wallet1',
    'addr3': 'wallet2',
  };
  const finalWalletInfoMap = {
    wallet1: {xpubkey: 'xpubkey1', maxGap: 5, addresses: ['addr1', 'addr2']},
    wallet2: {xpubkey: 'xpubkey2', maxGap: 5, addresses: ['addr3']},
  };

  // populate address table
  for (const [address, wallet] of Object.entries(finalWalletAddressMap)) {
    const entry = {address, index: 0, wallet_id: wallet, transactions: 0};
    await mysql.query('INSERT INTO `address` SET ?', [entry]);
  }
  // add address that won't be requested on walletAddressMap
  let entry = {address: 'addr4', index: 0, wallet_id: 'wallet3', transactions: 0};
  await mysql.query('INSERT INTO `address` SET ?', [entry]);

  // populate wallet table
  for (const [wallet, info] of Object.entries(finalWalletInfoMap)) {
    const entry = {id: wallet, xpubkey: info.xpubkey, status: 'ready', max_gap: info.maxGap, created_at: 0, ready_at: 0};
    await mysql.query('INSERT INTO `wallet` SET ?', [entry]);
  }
  // add wallet that should not be on the results
  entry = {id: 'wallet3', xpubkey: 'xpubkey3', status: 'ready', max_gap: 5, created_at: 0, ready_at: 0};
  await mysql.query('INSERT INTO `wallet` SET ?', [entry]);

  const {walletAddressMap, walletInfoMap} = await getWalletAddressInfo(mysql, Object.keys(finalWalletAddressMap));
  expect(walletAddressMap).toEqual(finalWalletAddressMap);
  expect(walletInfoMap).toEqual(finalWalletInfoMap);
});

test('getWalletStatus and updateWalletStatus', async () => {
  const walletId = 'walletId';
  const xpubkey = 'xpub';
  // if there are no entries, should return null
  let ret = await getWalletStatus(mysql, walletId);
  expect(ret).toBeNull();

  // add entry to database
  let timestamp = getUnixTimestamp();
  await updateWalletStatus(mysql, walletId, 'creating', xpubkey, 5);

  // get status
  ret = await getWalletStatus(mysql, walletId);
  expect(ret.status).toBe('creating');
  expect(ret.xpubkey).toBe(xpubkey);
  expect(ret.maxGap).toBe(5);
  expect(ret.createdAt).toBeGreaterThanOrEqual(timestamp);
  expect(ret.readyAt).toBeNull();

  // update wallet status to ready
  timestamp = ret.createdAt;
  await updateWalletStatus(mysql, walletId, 'ready');
  ret = await getWalletStatus(mysql, walletId);
  expect(ret.status).toBe('ready');
  expect(ret.xpubkey).toBe(xpubkey);
  expect(ret.maxGap).toBe(5);
  expect(ret.createdAt).toBe(timestamp);
  expect(ret.readyAt).toBeGreaterThanOrEqual(timestamp);
});

test('addNewAddresses', async () => {
  const walletId = 'walletId';

  // test adding empty dict
  await addNewAddresses(mysql, walletId, {});
  await checkAddressTable(mysql, 0);

  // add some addresses
  await addNewAddresses(mysql, walletId, addrMap);
  for (const [index, address] of addresses.entries()) {
    await checkAddressTable(mysql, addresses.length, address, index, walletId, 0);
  }
});

test('updateExistingAddresses', async () => {
  const walletId = 'walletId';

  // test adding empty dict
  await updateExistingAddresses(mysql, walletId, {});
  await checkAddressTable(mysql, 0);

  // first add some addresses to database, without walletId and index
  const newAddrMap = {};
  for (const address of addresses) {
    newAddrMap[address] = null;
  }
  await addNewAddresses(mysql, null, newAddrMap);
  for (const address of addresses) {
    await checkAddressTable(mysql, addresses.length, address, null, null, 0);
  }

  // now update addresses with walletId
  await updateExistingAddresses(mysql, walletId, addrMap);
  for (const [index, address] of addresses.entries()) {
    await checkAddressTable(mysql, addresses.length, address, index, walletId, 0);
  }
});

test('initWalletTxHistory', async () => {
  const walletId = 'walletId';
  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const addr3 = 'addr3';
  const token1 = 'token1';
  const token2 = 'token2';
  const token3 = 'token3';
  const txId1 = 'txId1';
  const txId2 = 'txId2';
  const timestamp1 = 10;
  const timestamp2 = 20;

  /*
   * addr1 and addr2 belong to our wallet, while addr3 does not. We are adding this last
   * address to make sure the wallet history will only get the balance from its own addresses
   *
   * These transactions are not valid under network rules, but here we only want to test the
   * database updates and final values
   *
   * tx1:
   *  . addr1: receive 10 token1 and 7 token2 (+10 token1, +7 token2);
   *  . addr2: receive 5 token2 (+5 token2);
   *  . addr3: receive 3 token1 (+3 token1);
   * tx2:
   *  . addr1: send 1 token1 and receive 3 token3 (-1 token1, +3 token3);
   *  . addr2: send 5 token2 (-5 token2);
   *  . addr3: receive 3 token1 (+3 token1);
   *
   *  Final entries for wallet_tx_history will be:
   *    . txId1 token1 +10
   *    . txId1 token2 +12
   *    . txId2 token1 -1
   *    . txId2 token2 -5
   *    . txId2 token3 +3
   */

  const entries = [
    [addr1, txId1, token1, 10, timestamp1],
    [addr1, txId1, token2, 7, timestamp1],
    [addr2, txId1, token2, 5, timestamp1],
    [addr3, txId1, token1, 3, timestamp1],
    [addr1, txId2, token1, -1, timestamp2],
    [addr1, txId2, token3, 3, timestamp2],
    [addr2, txId2, token2, -5, timestamp2],
    [addr3, txId2, token1, 3, timestamp2],
  ];
  await mysql.query(
    'INSERT INTO `address_tx_history`(`address`, `tx_id`, `token_id`, `balance`, `timestamp`) VALUES ?',
    [entries]
  );

  await initWalletTxHistory(mysql, walletId, [addr1, addr2]);

  // check wallet_tx_history entries
  await checkWalletTxHistoryTable(mysql, 5, walletId, token1, txId1, 10, timestamp1);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token2, txId1, 12, timestamp1);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token1, txId2, -1, timestamp2);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token2, txId2, -5, timestamp2);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token3, txId2, 3, timestamp2);
});

test('initWalletBalance', async () => {
  const walletId = 'walletId';
  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const addr3 = 'addr3';
  const token1 = 'token1';
  const token2 = 'token2';
  const tx1 = 'tx1';
  const tx2 = 'tx2';
  const tx3 = 'tx3';
  const ts1 = 0;
  const ts2 = 10;
  const ts3 = 20;

  /*
   * addr1 and addr2 belong to our wallet, while addr3 does not. We are adding this last
   * address to make sure the wallet will only get the balance from its own addresses
   */
  
  // addr1 and addr2 belong to the wallet
  const entries = [
    [addr1, tx1, token1, 10, ts1],
    [addr2, tx1, token1, 3, ts1],
    [addr1, tx2, token1, -8, ts2],
    [addr2, tx3, token1, 4, ts3],
    [addr1, tx1, token2, 5, ts1],
    [addr2, tx2, token2, 2, ts2],
    [addr3, tx1, token1, -1, ts1],
    [addr3, tx3, token2, 11, ts3],
  ];

  await mysql.query(
    'INSERT INTO `address_tx_history`(`address`, `tx_id`,`token_id`, `balance`, `timestamp`) VALUES ?',
    [entries]
  );

  await initWalletBalance(mysql, walletId, [addr1, addr2]);

  // check balance entries
  await checkWalletBalanceTable(mysql, 2, walletId, token1, 9, 3);
  await checkWalletBalanceTable(mysql, 2, walletId, token2, 7, 2);
});

test('updateWalletTables', async () => {
  const walletId = 'walletId';
  const walletId2 = 'walletId2';
  const token1 = 'token1';
  const token2 = 'token2';
  const tx1 = 'txId1';
  const tx2 = 'txId2';
  const tx3 = 'txId3';
  const ts1 = 10;
  const ts2 = 20;
  const ts3 = 30;

  // add tx1
  let walletBalanceMap = {
    walletId: {token1: 5}
  };
  await updateWalletTables(mysql, tx1, ts1, walletBalanceMap);
  await checkWalletBalanceTable(mysql, 1, walletId, token1, 5, 1);
  await checkWalletTxHistoryTable(mysql, 1, walletId, token1, tx1, 5, ts1);

  // add tx2
  walletBalanceMap = {
    walletId: {token1: -2, token2: 7}
  };
  await updateWalletTables(mysql, tx2, ts2, walletBalanceMap);
  await checkWalletBalanceTable(mysql, 2, walletId, token1, 3, 2);
  await checkWalletBalanceTable(mysql, 2, walletId, token2, 7, 1);
  await checkWalletTxHistoryTable(mysql, 3, walletId, token1, tx1, 5, ts1);
  await checkWalletTxHistoryTable(mysql, 3, walletId, token1, tx2, -2, ts2);
  await checkWalletTxHistoryTable(mysql, 3, walletId, token2, tx2, 7, ts2);

  // add tx3
  walletBalanceMap = {
    walletId: {token1: 1},
    walletId2: {token2: 10}
  };
  await updateWalletTables(mysql, tx3, ts3, walletBalanceMap);
  await checkWalletBalanceTable(mysql, 3, walletId, token1, 4, 3);
  await checkWalletBalanceTable(mysql, 3, walletId, token2, 7, 1);
  await checkWalletBalanceTable(mysql, 3, walletId2, token2, 10, 1);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx1, 5, ts1);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx2, -2, ts2);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token2, tx2, 7, ts2);
  await checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx3, 1, ts3);
  await checkWalletTxHistoryTable(mysql, 5, walletId2, token2, tx3, 10, ts3);
});

test('addUtxos and removeUtxos', async () => {
  const txId = 'txId';
  const utxos = [
    {value: 5, address: 'address1', token: 'token1'},
    {value: 15, address: 'address1', token: 'token1'},
    {value: 25, address: 'address2', token: 'token2', timelock: 500},
    {value: 35, address: 'address2', token: 'token1'},
  ];

  // add to utxo table
  const outputs = utxos.map(utxo => createOutput(utxo));
  await addUtxos(mysql, txId, outputs);
  for (const [index, output] of outputs.entries()) {
    await checkUtxoTable(mysql, 4, txId, index, output.token, output.decoded.address, output.value, output.decoded.timelock)
  }

  // remove from utxo table
  const inputs = utxos.map((utxo, index) => createInput({value: utxo.value, address: utxo.address, txId, index, token: utxo.token, timelock: utxo.timelock}));
  for (const input of inputs) {
    await checkUtxoTable(mysql, 4, txId, input.index, input.token, input.decoded.address, input.value, input.decoded.timelock)
  }
});

test('updateAddressTables', async () => {
  const address1 = 'address1';
  const address2 = 'address2';
  // we'll add address1 to the address table already, as if it had already received another transaction
  let entry = {address: address1, index: null, wallet_id: null, transactions: 1};
  await mysql.query('INSERT INTO `address` SET ?', [entry]);

  const txId1 = 'txId1';
  const timestamp1 = 10;
  const addrMap1 = {
    address1: {token1: 10, token2: 7, token3: 2},
    address2: {token1: 8},
  };

  await updateAddressTables(mysql, txId1, timestamp1, addrMap1);
  for (const [address, tokenMap] of Object.entries(addrMap1)) { 
    const transactions = (address === address1 ? 2 : 1);
    await checkAddressTable(mysql, 2, address, null, null, transactions);
    for (const [token, tokenBalance] of Object.entries(tokenMap)) {
      await checkAddressBalanceTable(mysql, 4, address, token, tokenBalance, 1);
      await checkAddressTxHistoryTable(mysql, 4, address, txId1, token, tokenBalance, timestamp1);
    }
  }

  const txId2 = 'txId2';
  const timestamp2 = 15;
  const addrMap2 = {
    address1: {token1: -5, token3: 6},
    address2: {token1: 8, token2: 3},
  };

  await updateAddressTables(mysql, txId2, timestamp2, addrMap2);
  for (const [address, tokenMap] of Object.entries(addrMap2)) { 
    for (const [token, tokenBalance] of Object.entries(tokenMap)) {
      const transactions = (address === address1 ? 3 : 2);
      await checkAddressTable(mysql, 2, address, null, null, transactions);
      await checkAddressTxHistoryTable(mysql, 8, address, txId2, token, tokenBalance, timestamp2);
    }
  }
  // final balance for each (address,token)
  await checkAddressBalanceTable(mysql, 5, address1, 'token1', 5, 2);
  await checkAddressBalanceTable(mysql, 5, address1, 'token2', 7, 1);
  await checkAddressBalanceTable(mysql, 5, address1, 'token3', 8, 2);
  await checkAddressBalanceTable(mysql, 5, address2, 'token1', 16, 2);
  await checkAddressBalanceTable(mysql, 5, address2, 'token2', 3, 1);
  // make sure entries in address_tx_history from txId1 haven't been changed
  for (const [address, tokenMap] of Object.entries(addrMap1)) { 
    for (const [token, tokenBalance] of Object.entries(tokenMap)) {
      await checkAddressTxHistoryTable(mysql, 8, address, txId1, token, tokenBalance, timestamp1);
    }
  }
});

test('getWalletAddresses', async () => {
  const walletId = 'walletId';
  const lastIndex = 5;
  // add some addresses into db
  const entries = [];
  for (let i = 0; i < lastIndex; i++) {
    entries.push([addresses[i], i, walletId, 0]);
  }
  // add entry to beginning of array, to make sure method will return addresses ordered
  entries.unshift([addresses[lastIndex], lastIndex, walletId, 0]);
  await mysql.query(
    'INSERT INTO `address`(`address`, `index`, `wallet_id`, `transactions`) VALUES ?',
    [entries]
  );

  const returnedAddresses = await getWalletAddresses(mysql, walletId);
  expect(returnedAddresses.length).toBe(lastIndex + 1);
  for (const [i, address] of returnedAddresses.entries()) {
    expect(i).toBe(address.index);
    expect(address.address).toBe(addresses[i]);
  }
});

test('getWalletBalances', async () => {
  const walletId = 'walletId';
  const token1 = 'token1';
  const token2 = 'token2';
  // add some balances into db
  const entries = [
    [walletId, token1, 10, 1],
    [walletId, token2, 20, 2],
    ['otherId', token1, 30, 3],
  ];
  await mysql.query(
    'INSERT INTO `wallet_balance`(`wallet_id`, `token_id`, `balance`, `transactions`) VALUES ?',
    [entries]
  );

  // first test fetching all tokens
  let returnedBalances = await getWalletBalances(mysql, walletId);
  expect(returnedBalances.length).toBe(2);
  for (const balance of returnedBalances) {
    if (balance.tokenId === token1) {
      expect(balance.balance).toBe(10);
      expect(balance.transactions).toBe(1);
    } else {
      expect(balance.balance).toBe(20);
      expect(balance.transactions).toBe(2);
    }
  }

  // fetch only balance for token2
  returnedBalances = await getWalletBalances(mysql, walletId, token2);
  expect(returnedBalances.length).toBe(1);
  expect(returnedBalances[0].balance).toBe(20);
  expect(returnedBalances[0].transactions).toBe(2);

  // fetch balance for non existing token
  returnedBalances = await getWalletBalances(mysql, walletId, 'otherToken');
  expect(returnedBalances.length).toBe(0);
});
