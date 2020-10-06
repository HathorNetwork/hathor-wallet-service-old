import {
  addNewAddresses,
  addUtxos,
  createWallet,
  generateAddresses,
  getAddressWalletInfo,
  getLatestHeight,
  getTxLockedInputs,
  getUtxosLockedAtHeight,
  getWalletAddresses,
  getWalletBalances,
  getWallet,
  initWalletBalance,
  initWalletTxHistory,
  maybeUpdateLatestHeight,
  removeUtxos,
  unlockUtxos,
  updateAddressLockedBalance,
  updateAddressTablesWithTx,
  updateExistingAddresses,
  updateWalletLockedBalance,
  updateWalletStatus,
  updateWalletTablesWithTx,
} from '@src/db';
import { TokenBalanceMap, WalletStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
import {
  ADDRESSES,
  XPUBKEY,
  addToAddressBalanceTable,
  addToAddressTable,
  addToAddressTxHistoryTable,
  addToWalletBalanceTable,
  addToWalletTable,
  cleanDatabase,
  checkAddressBalanceTable,
  checkAddressTable,
  checkAddressTxHistoryTable,
  checkUtxoTable,
  checkWalletBalanceTable,
  checkWalletTxHistoryTable,
  createOutput,
  createInput,
} from '@tests/utils';

const mysql = getDbConnection();

const addrMap = {};
for (const [index, address] of ADDRESSES.entries()) {
  addrMap[address] = index;
}

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('generateAddresses', async () => {
  expect.hasAssertions();
  const maxGap = 5;
  const address0 = ADDRESSES[0];

  // check first with no addresses on database, so it should return only maxGap addresses
  let addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap);
  expect(addressesInfo.existingAddresses).toStrictEqual({});
  expect(Object.keys(addressesInfo.newAddresses)).toHaveLength(maxGap);
  expect(addressesInfo.addresses[0]).toBe(address0);

  // add first address with no transactions. As it's not used, we should still only generate maxGap addresses
  await addToAddressTable(mysql, [[address0, 0, null, 0]]);
  addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap);
  expect(addressesInfo.existingAddresses).toStrictEqual({ [address0]: 0 });
  let totalLength = Object.keys(addressesInfo.addresses).length;
  let existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses)).toHaveLength(totalLength - existingLength);
  expect(addressesInfo.addresses[0]).toBe(address0);

  // mark address as used and check again
  let usedIndex = 0;
  await mysql.query('UPDATE `address` SET `transactions` = ? WHERE `address` = ?', [1, address0]);
  addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toStrictEqual({ [address0]: 0 });
  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses)).toHaveLength(totalLength - existingLength);

  // add address with index 1 as used
  usedIndex = 1;
  const address1 = ADDRESSES[1];
  await addToAddressTable(mysql, [[address1, usedIndex, null, 1]]);
  addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toStrictEqual({ [address0]: 0, [address1]: 1 });
  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses)).toHaveLength(totalLength - existingLength);

  // add address with index 4 as used
  usedIndex = 4;
  const address4 = ADDRESSES[4];
  await addToAddressTable(mysql, [[address4, usedIndex, null, 1]]);
  addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toStrictEqual({ [address0]: 0, [address1]: 1, [address4]: 4 });
  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses)).toHaveLength(totalLength - existingLength);

  // make sure no address was skipped from being generated
  for (const [index, address] of addressesInfo.addresses.entries()) {
    expect(ADDRESSES[index]).toBe(address);
  }
}, 25000);

test('getAddressWalletInfo', async () => {
  expect.hasAssertions();
  const wallet1 = { walletId: 'wallet1', xpubkey: 'xpubkey1', maxGap: 5 };
  const wallet2 = { walletId: 'wallet2', xpubkey: 'xpubkey2', maxGap: 5 };
  const finalMap = {
    addr1: wallet1,
    addr2: wallet1,
    addr3: wallet2,
  };

  // populate address table
  for (const [address, wallet] of Object.entries(finalMap)) {
    await addToAddressTable(mysql, [[address, 0, wallet.walletId, 0]]);
  }
  // add address that won't be requested on walletAddressMap
  await addToAddressTable(mysql, [['addr4', 0, 'wallet3', 0]]);

  // populate wallet table
  for (const wallet of Object.values(finalMap)) {
    const entry = { id: wallet.walletId, xpubkey: wallet.xpubkey, status: WalletStatus.READY, max_gap: wallet.maxGap, created_at: 0, ready_at: 0 };
    await mysql.query('INSERT INTO `wallet` SET ? ON DUPLICATE KEY UPDATE id=id', [entry]);
  }
  // add wallet that should not be on the results
  await addToWalletTable(mysql, [['wallet3', 'xpubkey3', WalletStatus.READY, 5, 0, 0]]);

  const addressWalletMap = await getAddressWalletInfo(mysql, Object.keys(finalMap));
  expect(addressWalletMap).toStrictEqual(finalMap);
});

test('getWallet, createWallet and updateWalletStatus', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';
  // if there are no entries, should return null
  let ret = await getWallet(mysql, walletId);
  expect(ret).toBeNull();

  // add entry to database
  let timestamp = getUnixTimestamp();
  const createRet = await createWallet(mysql, walletId, XPUBKEY, 5);

  // get status
  ret = await getWallet(mysql, walletId);
  expect(ret).toStrictEqual(createRet);
  expect(ret.status).toBe(WalletStatus.CREATING);
  expect(ret.xpubkey).toBe(XPUBKEY);
  expect(ret.maxGap).toBe(5);
  expect(ret.createdAt).toBeGreaterThanOrEqual(timestamp);
  expect(ret.readyAt).toBeNull();

  // update wallet status to ready
  timestamp = ret.createdAt;
  await updateWalletStatus(mysql, walletId, WalletStatus.READY);
  ret = await getWallet(mysql, walletId);
  expect(ret.status).toBe(WalletStatus.READY);
  expect(ret.xpubkey).toBe(XPUBKEY);
  expect(ret.maxGap).toBe(5);
  expect(ret.createdAt).toBe(timestamp);
  expect(ret.readyAt).toBeGreaterThanOrEqual(timestamp);
});

test('addNewAddresses', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';

  // test adding empty dict
  await addNewAddresses(mysql, walletId, {});
  await expect(checkAddressTable(mysql, 0)).resolves.toBe(true);

  // add some addresses
  await addNewAddresses(mysql, walletId, addrMap);
  for (const [index, address] of ADDRESSES.entries()) {
    await expect(checkAddressTable(mysql, ADDRESSES.length, address, index, walletId, 0)).resolves.toBe(true);
  }
});

test('updateExistingAddresses', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';

  // test adding empty dict
  await updateExistingAddresses(mysql, walletId, {});
  await expect(checkAddressTable(mysql, 0)).resolves.toBe(true);

  // first add some addresses to database, without walletId and index
  const newAddrMap = {};
  for (const address of ADDRESSES) {
    newAddrMap[address] = null;
  }
  await addNewAddresses(mysql, null, newAddrMap);
  for (const address of ADDRESSES) {
    await expect(checkAddressTable(mysql, ADDRESSES.length, address, null, null, 0)).resolves.toBe(true);
  }

  // now update addresses with walletId
  await updateExistingAddresses(mysql, walletId, addrMap);
  for (const [index, address] of ADDRESSES.entries()) {
    await expect(checkAddressTable(mysql, ADDRESSES.length, address, index, walletId, 0)).resolves.toBe(true);
  }
});

test('initWalletTxHistory', async () => {
  expect.hasAssertions();
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

  // with empty addresses it shouldn't add anything
  await initWalletTxHistory(mysql, walletId, []);
  await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);

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
  await addToAddressTxHistoryTable(mysql, entries);

  await initWalletTxHistory(mysql, walletId, [addr1, addr2]);

  // check wallet_tx_history entries
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, txId1, 10, timestamp1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token2, txId1, 12, timestamp1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, txId2, -1, timestamp2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token2, txId2, -5, timestamp2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token3, txId2, 3, timestamp2)).resolves.toBe(true);
});

test('initWalletBalance', async () => {
  expect.hasAssertions();
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
  const timelock = 500;

  /*
   * addr1 and addr2 belong to our wallet, while addr3 does not. We are adding this last
   * address to make sure the wallet will only get the balance from its own addresses
   */
  const historyEntries = [
    [addr1, tx1, token1, 10, ts1],
    [addr1, tx2, token1, -8, ts2],
    [addr1, tx1, token2, 5, ts1],
    [addr2, tx1, token1, 3, ts1],
    [addr2, tx3, token1, 4, ts3],
    [addr2, tx2, token2, 2, ts2],
    [addr3, tx1, token1, 1, ts1],
    [addr3, tx3, token2, 11, ts3],
  ];
  const addressEntries = [
    // address, tokenId, unlocked, locked, lockExpires, transactions
    [addr1, token1, 2, 0, null, 2],
    [addr1, token2, 1, 4, timelock, 1],
    [addr2, token1, 5, 2, null, 2],
    [addr2, token2, 0, 2, null, 1],
    [addr3, token1, 0, 1, null, 1],
    [addr3, token2, 10, 1, null, 1],
  ];

  await addToAddressTxHistoryTable(mysql, historyEntries);
  await addToAddressBalanceTable(mysql, addressEntries);

  await initWalletBalance(mysql, walletId, [addr1, addr2]);

  // check balance entries
  await expect(checkWalletBalanceTable(mysql, 2, walletId, token1, 7, 2, null, 3)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 2, walletId, token2, 1, 6, timelock, 2)).resolves.toBe(true);
});

test('updateWalletTablesWithTx', async () => {
  expect.hasAssertions();
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

  await addToAddressTable(mysql, [
    ['addr1', 0, walletId, 1],
    ['addr2', 1, walletId, 1],
    ['addr3', 2, walletId, 1],
    ['addr4', 0, walletId2, 1],
  ]);

  // add tx1
  const walletBalanceMap1 = {
    walletId: TokenBalanceMap.fromStringMap({ token1: { unlocked: 5, locked: 0 } }),
  };
  await updateWalletTablesWithTx(mysql, tx1, ts1, walletBalanceMap1);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token1, 5, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 1, walletId, token1, tx1, 5, ts1)).resolves.toBe(true);

  // add tx2
  const walletBalanceMap2 = {
    walletId: TokenBalanceMap.fromStringMap({ token1: { unlocked: -2, locked: 1, lockExpires: 500 }, token2: { unlocked: 7, locked: 0 } }),
  };
  await updateWalletTablesWithTx(mysql, tx2, ts2, walletBalanceMap2);
  await expect(checkWalletBalanceTable(mysql, 2, walletId, token1, 3, 1, 500, 2)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 2, walletId, token2, 7, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 3, walletId, token1, tx1, 5, ts1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 3, walletId, token1, tx2, -1, ts2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 3, walletId, token2, tx2, 7, ts2)).resolves.toBe(true);

  // add tx3
  const walletBalanceMap3 = {
    walletId: TokenBalanceMap.fromStringMap({ token1: { unlocked: 1, locked: 2, lockExpires: 200 } }),
    walletId2: TokenBalanceMap.fromStringMap({ token2: { unlocked: 10, locked: 0 } }),
  };
  await updateWalletTablesWithTx(mysql, tx3, ts3, walletBalanceMap3);
  await expect(checkWalletBalanceTable(mysql, 3, walletId, token1, 4, 3, 200, 3)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, walletId, token2, 7, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, walletId2, token2, 10, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx1, 5, ts1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx2, -1, ts2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token2, tx2, 7, ts2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx3, 3, ts3)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId2, token2, tx3, 10, ts3)).resolves.toBe(true);
});

test('addUtxos, unlockUtxos and removeUtxos', async () => {
  expect.hasAssertions();
  const txId = 'txId';
  const utxos = [
    { value: 5, address: 'address1', token: 'token1', locked: false },
    { value: 15, address: 'address1', token: 'token1', locked: false },
    { value: 25, address: 'address2', token: 'token2', timelock: 500, locked: true },
    { value: 35, address: 'address2', token: 'token1', locked: false },
  ];

  // add to utxo table
  const outputs = utxos.map((utxo) => createOutput(utxo.value, utxo.address, utxo.token, utxo.timelock || null, utxo.locked));
  await addUtxos(mysql, txId, outputs);
  for (const [index, output] of outputs.entries()) {
    const { token, decoded, value } = output;
    await expect(checkUtxoTable(mysql, 4, txId, index, token, decoded.address, value, decoded.timelock, null, output.locked)).resolves.toBe(true);
  }

  // unlock the locked one
  const first = {
    txId,
    index: 2,
    tokenId: 'token2',
    address: 'address2',
    value: 25,
    timelock: 500,
    heightlock: null,
    locked: true,
  };
  await unlockUtxos(mysql, [first]);
  await expect(checkUtxoTable(
    mysql, 4, first.txId, first.index, first.tokenId, first.address, first.value, first.timelock, first.heightlock, false,
  )).resolves.toBe(true);

  // empty list should be fine
  await unlockUtxos(mysql, []);

  // remove from utxo table
  const inputs = utxos.map((utxo, index) => createInput(utxo.value, utxo.address, txId, index, utxo.token, utxo.timelock, null));
  await removeUtxos(mysql, inputs);
  await expect(checkUtxoTable(mysql, 0)).resolves.toBe(true);
});

test('getTxLockedInputs', async () => {
  expect.hasAssertions();
  const txId = 'txId';
  const utxos = [
    { value: 5, address: 'address1', token: 'token1', locked: false },
    { value: 25, address: 'address2', token: 'token2', timelock: 500, locked: true },
    { value: 35, address: 'address2', token: 'token1', locked: false },
  ];

  // add to utxo table
  const outputs = utxos.map((utxo) => createOutput(utxo.value, utxo.address, utxo.token, utxo.timelock || null, utxo.locked));
  await addUtxos(mysql, txId, outputs);
  for (const [index, output] of outputs.entries()) {
    const { token, decoded, value } = output;
    await expect(checkUtxoTable(mysql, 3, txId, index, token, decoded.address, value, decoded.timelock, null, output.locked)).resolves.toBe(true);
  }

  const inputs = utxos.map((utxo, index) => createInput(utxo.value, utxo.address, txId, index, utxo.token, utxo.timelock, null));
  const results = await getTxLockedInputs(mysql, inputs);
  expect(results).toHaveLength(1);
  expect(results[0].value).toBe(25);
});

test('updateAddressTablesWithTx', async () => {
  expect.hasAssertions();
  const address1 = 'address1';
  const address2 = 'address2';
  // we'll add address1 to the address table already, as if it had already received another transaction
  await addToAddressTable(mysql, [[address1, null, null, 1]]);

  const txId1 = 'txId1';
  const timestamp1 = 10;
  const addrMap1 = {
    address1: TokenBalanceMap.fromStringMap({
      token1: { unlocked: 10, locked: 0 }, token2: { unlocked: 7, locked: 0 }, token3: { unlocked: 2, locked: 0 },
    }),
    address2: TokenBalanceMap.fromStringMap({ token1: { unlocked: 8, locked: 0 } }),
  };

  await updateAddressTablesWithTx(mysql, txId1, timestamp1, addrMap1);
  for (const [address, tokenMap] of Object.entries(addrMap1)) {
    const transactions = (address === address1 ? 2 : 1);
    await expect(checkAddressTable(mysql, 2, address, null, null, transactions)).resolves.toBe(true);
    for (const [token, tokenBalance] of tokenMap.iterator()) {
      await expect(checkAddressBalanceTable(mysql, 4, address, token, tokenBalance.unlocked, tokenBalance.locked, null, 1)).resolves.toBe(true);
      await expect(checkAddressTxHistoryTable(mysql, 4, address, txId1, token, tokenBalance.total(), timestamp1)).resolves.toBe(true);
    }
  }

  const txId2 = 'txId2';
  const timestamp2 = 15;
  const addrMap2 = {
    address1: TokenBalanceMap.fromStringMap({ token1: { unlocked: -5, locked: 0 }, token3: { unlocked: 6, locked: 0 } }),
    address2: TokenBalanceMap.fromStringMap({ token1: { unlocked: 8, locked: 0 }, token2: { unlocked: 3, locked: 0 } }),
  };

  await updateAddressTablesWithTx(mysql, txId2, timestamp2, addrMap2);
  for (const [address, tokenMap] of Object.entries(addrMap2)) {
    for (const [token, tokenBalance] of tokenMap.iterator()) {
      const transactions = (address === address1 ? 3 : 2);
      await expect(checkAddressTable(mysql, 2, address, null, null, transactions)).resolves.toBe(true);
      await expect(checkAddressTxHistoryTable(mysql, 8, address, txId2, token, tokenBalance.total(), timestamp2)).resolves.toBe(true);
    }
  }
  // final balance for each (address,token)
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token1', 5, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token2', 7, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token3', 8, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address2, 'token1', 16, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address2, 'token2', 3, 0, null, 1)).resolves.toBe(true);
  // make sure entries in address_tx_history from txId1 haven't been changed
  for (const [address, tokenMap] of Object.entries(addrMap1)) {
    for (const [token, tokenBalance] of tokenMap.iterator()) {
      await expect(checkAddressTxHistoryTable(mysql, 8, address, txId1, token, tokenBalance.total(), timestamp1)).resolves.toBe(true);
    }
  }

  // a tx with timelock
  const txId3 = 'txId3';
  const timestamp3 = 20;
  const lockExpires = 5000;
  const addrMap3 = {
    address1: TokenBalanceMap.fromStringMap({ token1: { unlocked: 0, locked: 3, lockExpires } }),
  };
  await updateAddressTablesWithTx(mysql, txId3, timestamp3, addrMap3);
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token1', 5, 3, lockExpires, 3)).resolves.toBe(true);

  // another tx, with higher timelock
  const txId4 = 'txId4';
  const timestamp4 = 25;
  const addrMap4 = {
    address1: TokenBalanceMap.fromStringMap({ token1: { unlocked: 0, locked: 2, lockExpires: lockExpires + 1 } }),
  };
  await updateAddressTablesWithTx(mysql, txId4, timestamp4, addrMap4);
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token1', 5, 5, lockExpires, 4)).resolves.toBe(true);

  // another tx, with lower timelock
  const txId5 = 'txId5';
  const timestamp5 = 25;
  const addrMap5 = {
    address1: TokenBalanceMap.fromStringMap({ token1: { unlocked: 0, locked: 2, lockExpires: lockExpires - 1 } }),
  };
  await updateAddressTablesWithTx(mysql, txId5, timestamp5, addrMap5);
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token1', 5, 7, lockExpires - 1, 5)).resolves.toBe(true);
});

test('getWalletAddresses', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';
  const lastIndex = 5;
  // add some addresses into db
  const entries = [];
  for (let i = 0; i < lastIndex; i++) {
    entries.push([ADDRESSES[i], i, walletId, 0]);
  }
  // add entry to beginning of array, to test if method will return addresses ordered
  entries.unshift([ADDRESSES[lastIndex], lastIndex, walletId, 0]);
  await addToAddressTable(mysql, entries);

  const returnedAddresses = await getWalletAddresses(mysql, walletId);
  expect(returnedAddresses).toHaveLength(lastIndex + 1);
  for (const [i, address] of returnedAddresses.entries()) {
    expect(i).toBe(address.index);
    expect(address.address).toBe(ADDRESSES[i]);
  }
});

test('getWalletBalances', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';
  const token1 = 'token1';
  const token2 = 'token2';
  const now = 1000;
  // add some balances into db
  const entries = [
    [walletId, token1, 10, 4, now, 1],
    [walletId, token2, 20, 5, now, 2],
    ['otherId', token1, 30, 1, now, 3],
  ];
  await addToWalletBalanceTable(mysql, entries);

  // first test fetching all tokens
  let returnedBalances = await getWalletBalances(mysql, walletId);
  expect(returnedBalances).toHaveLength(2);
  for (const balance of returnedBalances) {
    if (balance.tokenId === token1) {
      expect(balance.balance.unlocked).toBe(10);
      expect(balance.balance.locked).toBe(4);
      expect(balance.balance.lockExpires).toBe(now);
      expect(balance.transactions).toBe(1);
    } else {
      expect(balance.balance.unlocked).toBe(20);
      expect(balance.balance.locked).toBe(5);
      expect(balance.transactions).toBe(2);
      expect(balance.balance.lockExpires).toBe(now);
    }
  }

  // fetch only balance for token2
  returnedBalances = await getWalletBalances(mysql, walletId, token2);
  expect(returnedBalances).toHaveLength(1);
  expect(returnedBalances[0].balance.unlocked).toBe(20);
  expect(returnedBalances[0].balance.locked).toBe(5);
  expect(returnedBalances[0].balance.lockExpires).toBe(now);
  expect(returnedBalances[0].transactions).toBe(2);

  // fetch balance for non existing token
  returnedBalances = await getWalletBalances(mysql, walletId, 'otherToken');
  expect(returnedBalances).toHaveLength(0);
});

test('getUtxosLockedAtHeight', async () => {
  expect.hasAssertions();

  const txId = 'txId';
  const txId2 = 'txId2';
  const txId3 = 'txId3';
  const now = 100;
  const heightLock = 10;

  const utxos = [
    // no locks
    { value: 5, address: 'address1', token: 'token1', locked: false },
    // only timelock
    { value: 25, address: 'address2', token: 'token2', timelock: now - 1, locked: false },

  ];
  const utxos2 = [
    // only heightlock
    { value: 35, address: 'address2', token: 'token1', timelock: null, locked: true },
    // timelock and heightlock
    { value: 45, address: 'address2', token: 'token1', timelock: now + 1, locked: true },
    { value: 55, address: 'address2', token: 'token1', timelock: now * 10, locked: true },
  ];

  // add to utxo table
  const outputs = utxos.map((utxo) => createOutput(utxo.value, utxo.address, utxo.token, utxo.timelock, utxo.locked));
  await addUtxos(mysql, txId, outputs, null);
  const outputs2 = utxos2.map((utxo) => createOutput(utxo.value, utxo.address, utxo.token, utxo.timelock, utxo.locked));
  await addUtxos(mysql, txId2, outputs2, heightLock);

  // fetch on timestamp=now and heightlock=heightLock. Should return:
  // { value: 35, address: 'address2', token: 'token1', timelock: null},
  let results = await getUtxosLockedAtHeight(mysql, now, heightLock);
  expect(results).toHaveLength(1);
  expect(results[0].value).toBe(35);

  // fetch on timestamp=now+1 and heightlock=heightLock. Should return:
  // { value: 35, address: 'address2', token: 'token1', timelock: null},
  // { value: 45, address: 'address2', token: 'token1', timelock: 100},
  results = await getUtxosLockedAtHeight(mysql, now + 1, heightLock);
  expect(results).toHaveLength(2);
  expect([35, 45]).toContain(results[0].value);
  expect([35, 45]).toContain(results[1].value);

  // fetch on timestamp=now + 1 and heightlock=heightLock-1. Should return empty
  results = await getUtxosLockedAtHeight(mysql, now + 1, heightLock - 1);
  expect(results).toStrictEqual([]);

  // unlockedHeight < 0. This means the block is still very early after genesis and no blocks have been unlocked
  results = await getUtxosLockedAtHeight(mysql, 1000, -2);
  expect(results).toStrictEqual([]);

  // add 2 other utxos with heightlock, but 1 is already unlocked (not a real situation)
  const utxos3 = [
    // no locks
    { value: 65, address: 'address1', token: 'token1', locked: false },
    // only timelock
    { value: 75, address: 'address2', token: 'token2', locked: true },
  ];
  const outputs3 = utxos3.map((utxo) => createOutput(utxo.value, utxo.address, utxo.token, null, utxo.locked));
  await addUtxos(mysql, txId3, outputs3, heightLock - 1);
  // should fetch 2 utxos, ignoring the one already unlocked
  results = await getUtxosLockedAtHeight(mysql, now, heightLock);
  expect(results).toHaveLength(2);
  expect([35, 75]).toContain(results[0].value);
  expect([35, 75]).toContain(results[1].value);
});

test('updateAddressLockedBalance', async () => {
  expect.hasAssertions();

  const addr1 = 'address1';
  const addr2 = 'address2';
  const tokenId = 'tokenId';
  const otherToken = 'otherToken';
  const entries = [
    [addr1, tokenId, 50, 20, null, 3],
    [addr2, tokenId, 0, 5, null, 1],
    [addr1, otherToken, 5, 5, null, 1],
  ];
  await addToAddressBalanceTable(mysql, entries);

  const addr1Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 10, locked: 0 } });
  const addr2Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 5, locked: 0 } });
  await updateAddressLockedBalance(mysql, { [addr1]: addr1Map, [addr2]: addr2Map });
  await expect(checkAddressBalanceTable(mysql, 3, addr1, tokenId, 60, 10, null, 3)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, addr2, tokenId, 5, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, addr1, otherToken, 5, 5, null, 1)).resolves.toBe(true);
});

test('updateWalletLockedBalance', async () => {
  expect.hasAssertions();

  const wallet1 = 'wallet1';
  const wallet2 = 'wallet2';
  const tokenId = 'tokenId';
  const otherToken = 'otherToken';
  const now = 1000;
  const entries = [
    [wallet1, tokenId, 10, 20, now, 5],
    [wallet2, tokenId, 0, 100, now, 4],
    [wallet1, otherToken, 1, 2, null, 1],
  ];
  await addToWalletBalanceTable(mysql, entries);

  const wallet1Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 15, locked: 0 } });
  const wallet2Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 50, locked: 0 } });
  await updateWalletLockedBalance(mysql, { [wallet1]: wallet1Map, [wallet2]: wallet2Map });
  await expect(checkWalletBalanceTable(mysql, 3, wallet1, tokenId, 25, 5, now, 5)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, wallet2, tokenId, 50, 50, now, 4)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, wallet1, otherToken, 1, 2, null, 1)).resolves.toBe(true);
});

test('maybeUpdateLatestHeight and getLatestHeight', async () => {
  expect.hasAssertions();

  expect(await getLatestHeight(mysql)).toBe(0);

  await maybeUpdateLatestHeight(mysql, 5);
  expect(await getLatestHeight(mysql)).toBe(5);

  await maybeUpdateLatestHeight(mysql, 3);
  expect(await getLatestHeight(mysql)).toBe(5);
});
