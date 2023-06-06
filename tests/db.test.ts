import { logger } from '@tests/winston.mock';
import { mockedAddAlert } from '@tests/utils/alerting.utils.mock';
import { v4 as uuidv4 } from 'uuid';
import {
  addNewAddresses,
  addUtxos,
  createTxProposal,
  createWallet,
  generateAddresses,
  getAddressWalletInfo,
  getBlockByHeight,
  getLatestHeight,
  getTokenInformation,
  getLockedUtxoFromInputs,
  getTxProposal,
  getUnusedAddresses,
  getUtxos,
  getAuthorityUtxo,
  getUtxosLockedAtHeight,
  getWallet,
  getWalletAddressDetail,
  getWalletAddresses,
  getWalletTokens,
  getWalletBalances,
  getWalletSortedValueUtxos,
  getVersionData,
  getTxOutputsBySpent,
  getTxOutput,
  getTransactionsById,
  getTxsAfterHeight,
  getAddressAtIndex,
  initWalletBalance,
  initWalletTxHistory,
  markUtxosWithProposalId,
  updateTxOutputSpentBy,
  storeTokenInformation,
  unlockUtxos,
  updateAddressLockedBalance,
  updateAddressTablesWithTx,
  updateExistingAddresses,
  updateTxProposal,
  updateWalletLockedBalance,
  updateWalletStatus,
  updateWalletAuthXpub,
  updateWalletTablesWithTx,
  updateVersionData,
  fetchAddressTxHistorySum,
  fetchAddressBalance,
  addOrUpdateTx,
  updateTx,
  fetchTx,
  markTxsAsVoided,
  removeTxsHeight,
  rebuildAddressBalancesFromUtxos,
  markAddressTxHistoryAsVoided,
  deleteBlocksAfterHeight,
  markUtxosAsVoided,
  unspendUtxos,
  filterTxOutputs,
  getTxProposalInputs,
  addMiner,
  getMinersList,
  getTotalSupply,
  getExpiredTimelocksUtxos,
  getTotalTransactions,
  getAvailableAuthorities,
  getAffectedAddressTxCountFromTxList,
  incrementTokensTxCount,
  registerPushDevice,
  existsPushDevice,
  updatePushDevice,
  unregisterPushDevice,
  getTransactionById,
  getPushDevice,
  removeAllPushDevicesByDeviceId,
  existsWallet,
  getPushDeviceSettingsList,
  getTokenSymbols,
  countStalePushDevices,
  deleteStalePushDevices,
  releaseTxProposalUtxos,
  getUnsentTxProposals,
  getLatestBlockByHeight,
  cleanupVoidedTx,
  checkTxWasVoided,
  getWalletTxHistory,
} from '@src/db';
import * as Db from '@src/db';
import { cleanUnsentTxProposalsUtxos } from '@src/db/cronRoutines';
import {
  beginTransaction,
  rollbackTransaction,
  commitTransaction,
} from '@src/db/utils';
import {
  Authorities,
  TokenBalanceMap,
  TokenInfo,
  TxProposalStatus,
  WalletStatus,
  FullNodeVersionData,
  Tx,
  DbTxOutput,
  PushDevice,
  PushProvider,
  Severity,
  Block,
  AddressInfo,
} from '@src/types';
import {
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
  isAuthority,
  getWalletId,
} from '@src/utils';
import {
  ADDRESSES,
  XPUBKEY,
  AUTH_XPUBKEY,
  addToAddressBalanceTable,
  addToAddressTable,
  addToAddressTxHistoryTable,
  addToTokenTable,
  addToUtxoTable,
  addToWalletBalanceTable,
  addToWalletTxHistoryTable,
  addToWalletTable,
  cleanDatabase,
  checkAddressBalanceTable,
  checkAddressTable,
  checkAddressTxHistoryTable,
  checkVersionDataTable,
  checkUtxoTable,
  checkWalletBalanceTable,
  checkWalletTxHistoryTable,
  createOutput,
  createInput,
  countTxOutputTable,
  checkTokenTable,
  checkPushDevicesTable,
  buildPushRegister,
  insertPushDevice,
  daysAgo,
  addToTransactionTable,
} from '@tests/utils';
import { AddressTxHistoryTableEntry } from '@tests/types';

import { constants } from '@hathor/wallet-lib';

const mysql = getDbConnection();

const addrMap = {};
for (const [index, address] of ADDRESSES.entries()) {
  addrMap[address] = index;
}

beforeEach(async () => {
  jest.resetModules();
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
  await addToAddressTable(mysql, [{
    address: address0,
    index: 0,
    walletId: null,
    transactions: 0,
  }]);
  addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap);
  expect(addressesInfo.existingAddresses).toStrictEqual({ [address0]: 0 });
  expect(addressesInfo.lastUsedAddressIndex).toStrictEqual(-1);

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
  expect(addressesInfo.lastUsedAddressIndex).toStrictEqual(0);

  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses)).toHaveLength(totalLength - existingLength);

  // add address with index 1 as used
  usedIndex = 1;
  const address1 = ADDRESSES[1];
  await addToAddressTable(mysql, [{
    address: address1,
    index: usedIndex,
    walletId: null,
    transactions: 1,
  }]);
  addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toStrictEqual({ [address0]: 0, [address1]: 1 });
  expect(addressesInfo.lastUsedAddressIndex).toStrictEqual(1);
  totalLength = Object.keys(addressesInfo.addresses).length;
  existingLength = Object.keys(addressesInfo.existingAddresses).length;
  expect(Object.keys(addressesInfo.newAddresses)).toHaveLength(totalLength - existingLength);

  // add address with index 4 as used
  usedIndex = 4;
  const address4 = ADDRESSES[4];
  await addToAddressTable(mysql, [{
    address: address4,
    index: usedIndex,
    walletId: null,
    transactions: 1,
  }]);
  addressesInfo = await generateAddresses(mysql, XPUBKEY, maxGap);
  expect(addressesInfo.addresses).toHaveLength(maxGap + usedIndex + 1);
  expect(addressesInfo.existingAddresses).toStrictEqual({ [address0]: 0, [address1]: 1, [address4]: 4 });
  expect(addressesInfo.lastUsedAddressIndex).toStrictEqual(4);
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
  const wallet1 = { walletId: 'wallet1', xpubkey: 'xpubkey1', authXpubkey: 'authXpubkey', maxGap: 5 };
  const wallet2 = { walletId: 'wallet2', xpubkey: 'xpubkey2', authXpubkey: 'authXpubkey2', maxGap: 5 };
  const finalMap = {
    addr1: wallet1,
    addr2: wallet1,
    addr3: wallet2,
  };

  // populate address table
  for (const [address, wallet] of Object.entries(finalMap)) {
    await addToAddressTable(mysql, [{
      address,
      index: 0,
      walletId: wallet.walletId,
      transactions: 0,
    }]);
  }
  // add address that won't be requested on walletAddressMap
  await addToAddressTable(mysql, [{
    address: 'addr4',
    index: 0,
    walletId: 'wallet3',
    transactions: 0,
  }]);

  // populate wallet table
  for (const wallet of Object.values(finalMap)) {
    const entry = {
      id: wallet.walletId,
      xpubkey: wallet.xpubkey,
      auth_xpubkey: wallet.authXpubkey,
      status: WalletStatus.READY,
      max_gap: wallet.maxGap,
      created_at: 0,
      ready_at: 0,
    };
    await mysql.query('INSERT INTO `wallet` SET ? ON DUPLICATE KEY UPDATE id=id', [entry]);
  }
  // add wallet that should not be on the results
  await addToWalletTable(mysql, [{
    id: 'wallet3',
    xpubkey: 'xpubkey3',
    authXpubkey: 'authxpubkey3',
    status: WalletStatus.READY,
    maxGap: 5,
    createdAt: 0,
    readyAt: 0,
  }]);

  const addressWalletMap = await getAddressWalletInfo(mysql, Object.keys(finalMap));
  expect(addressWalletMap).toStrictEqual(finalMap);
});

test('updateWalletAuthXpub', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';

  // add the wallet to database
  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 20);
  await updateWalletAuthXpub(mysql, walletId, 'new_auth_xpubkey');

  const wallet = await getWallet(mysql, walletId);
  expect(wallet.authXpubkey).toStrictEqual('new_auth_xpubkey');
});

test('getWallet, createWallet and updateWalletStatus', async () => {
  expect.hasAssertions();
  const walletId = getWalletId(XPUBKEY);
  // if there are no entries, should return null
  let ret = await getWallet(mysql, walletId);
  expect(ret).toBeNull();

  // add entry to database
  let timestamp = getUnixTimestamp();
  const createRet = await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

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
  await addNewAddresses(mysql, walletId, {}, -1);
  await expect(checkAddressTable(mysql, 0)).resolves.toBe(true);

  // add some addresses
  await addNewAddresses(mysql, walletId, addrMap, -1);
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
  await addNewAddresses(mysql, null, newAddrMap, -1);
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
    { address: addr1, txId: txId1, tokenId: token1, balance: 10, timestamp: timestamp1 },
    { address: addr1, txId: txId1, tokenId: token2, balance: 7, timestamp: timestamp1 },
    { address: addr2, txId: txId1, tokenId: token2, balance: 5, timestamp: timestamp1 },
    { address: addr3, txId: txId1, tokenId: token1, balance: 3, timestamp: timestamp1 },
    { address: addr1, txId: txId2, tokenId: token1, balance: -1, timestamp: timestamp2 },
    { address: addr1, txId: txId2, tokenId: token3, balance: 3, timestamp: timestamp2 },
    { address: addr2, txId: txId2, tokenId: token2, balance: -5, timestamp: timestamp2 },
    { address: addr3, txId: txId2, tokenId: token1, balance: 3, timestamp: timestamp2 },
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
    { address: addr1, txId: tx1, tokenId: token1, balance: 10, timestamp: ts1 },
    { address: addr1, txId: tx2, tokenId: token1, balance: -8, timestamp: ts2 },
    { address: addr1, txId: tx1, tokenId: token2, balance: 5, timestamp: ts1 },
    { address: addr2, txId: tx1, tokenId: token1, balance: 3, timestamp: ts1 },
    { address: addr2, txId: tx3, tokenId: token1, balance: 4, timestamp: ts3 },
    { address: addr2, txId: tx2, tokenId: token2, balance: 2, timestamp: ts2 },
    { address: addr3, txId: tx1, tokenId: token1, balance: 1, timestamp: ts1 },
    { address: addr3, txId: tx3, tokenId: token2, balance: 11, timestamp: ts3 },
  ];
  const addressEntries = [
    // address, tokenId, unlocked, locked, lockExpires, transactions
    [addr1, token1, 2, 0, null, 2, 0, 0, 4],
    [addr1, token2, 1, 4, timelock, 1, 0, 0, 5],
    [addr2, token1, 5, 2, null, 2, 0, 0, 20],
    [addr2, token2, 0, 2, null, 1, 0, 0, 2],
    [addr3, token1, 0, 1, null, 1, 0, 0, 1],
    [addr3, token2, 10, 1, null, 1, 0, 0, 11],
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
    { address: 'addr1', index: 0, walletId, transactions: 1 },
    { address: 'addr2', index: 1, walletId, transactions: 1 },
    { address: 'addr3', index: 2, walletId, transactions: 1 },
    { address: 'addr4', index: 0, walletId: walletId2, transactions: 1 },
  ]);

  // add tx1
  const walletBalanceMap1 = {
    walletId: TokenBalanceMap.fromStringMap({ token1: { unlocked: 5, locked: 0, unlockedAuthorities: new Authorities(0b01) } }),
  };
  await updateWalletTablesWithTx(mysql, tx1, ts1, walletBalanceMap1);
  await expect(checkWalletBalanceTable(mysql, 1, walletId, token1, 5, 0, null, 1, 0b01, 0)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 1, walletId, token1, tx1, 5, ts1)).resolves.toBe(true);

  // add tx2
  const walletBalanceMap2 = {
    walletId: TokenBalanceMap.fromStringMap(
      {
        token1: { unlocked: -2, locked: 1, lockExpires: 500, unlockedAuthorities: new Authorities(0b11) },
        token2: { unlocked: 7, locked: 0 },
      },
    ),
  };
  await updateWalletTablesWithTx(mysql, tx2, ts2, walletBalanceMap2);
  await expect(checkWalletBalanceTable(mysql, 2, walletId, token1, 3, 1, 500, 2, 0b11, 0)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 2, walletId, token2, 7, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 3, walletId, token1, tx1, 5, ts1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 3, walletId, token1, tx2, -1, ts2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 3, walletId, token2, tx2, 7, ts2)).resolves.toBe(true);

  // add tx3
  const walletBalanceMap3 = {
    walletId: TokenBalanceMap.fromStringMap({ token1: { unlocked: 1, locked: 2, lockExpires: 200, unlockedAuthorities: new Authorities([-1, -1]) } }),
    walletId2: TokenBalanceMap.fromStringMap({ token2: { unlocked: 10, locked: 0 } }),
  };
  // the tx above removes an authority, which will trigger a "refresh" on the available authorities.
  // Let's pretend there's another utxo with some authorities as well
  await addToAddressTable(mysql, [{
    address: 'address1',
    index: 0,
    walletId,
    transactions: 1,
  }]);
  await addToAddressBalanceTable(mysql, [['address1', token1, 0, 0, null, 1, 0b10, 0, 0]]);

  await updateWalletTablesWithTx(mysql, tx3, ts3, walletBalanceMap3);
  await expect(checkWalletBalanceTable(mysql, 3, walletId, token1, 4, 3, 200, 3, 0b10, 0)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, walletId, token2, 7, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, walletId2, token2, 10, 0, null, 1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx1, 5, ts1)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx2, -1, ts2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token2, tx2, 7, ts2)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId, token1, tx3, 3, ts3)).resolves.toBe(true);
  await expect(checkWalletTxHistoryTable(mysql, 5, walletId2, token2, tx3, 10, ts3)).resolves.toBe(true);
});

test('addUtxos, getUtxos, unlockUtxos, updateTxOutputSpentBy, unspendUtxos, getTxOutput, getTxOutputsBySpent and markUtxosAsVoided', async () => {
  expect.hasAssertions();

  const txId = 'txId';
  const utxos = [
    { value: 5, address: 'address1', tokenId: 'token1', locked: false },
    { value: 15, address: 'address1', tokenId: 'token1', locked: false },
    { value: 25, address: 'address2', tokenId: 'token2', timelock: 500, locked: true },
    { value: 35, address: 'address2', tokenId: 'token1', locked: false },
    // authority utxo
    { value: 0b11, address: 'address1', tokenId: 'token1', locked: false, tokenData: 129 },
  ];

  // empty list should be fine
  await addUtxos(mysql, txId, []);

  // add to utxo table
  const outputs = utxos.map((utxo, index) => createOutput(
    index,
    utxo.value,
    utxo.address,
    utxo.tokenId,
    utxo.timelock || null,
    utxo.locked,
    utxo.tokenData || 0,
  ));
  await addUtxos(mysql, txId, outputs);

  for (const [_, output] of outputs.entries()) {
    let { value } = output;
    const { token, decoded } = output;
    let authorities = 0;
    if (isAuthority(output.token_data)) {
      authorities = value;
      value = 0;
    }
    await expect(
      checkUtxoTable(mysql, utxos.length, txId, output.index, token, decoded.address, value, authorities, decoded.timelock, null, output.locked),
    ).resolves.toBe(true);
  }

  // getUtxos
  let results = await getUtxos(mysql, utxos.map((_utxo, index) => ({ txId, index })));
  expect(results).toHaveLength(utxos.length);
  // fetch only 2
  results = await getUtxos(mysql, [{ txId, index: 0 }, { txId, index: 1 }]);
  expect(results).toHaveLength(2);

  // get an unspent tx output
  expect(await getTxOutput(mysql, txId, 0, true)).toStrictEqual({
    txId: 'txId',
    index: 0,
    tokenId: utxos[0].tokenId,
    address: utxos[0].address,
    value: utxos[0].value,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
    txProposalId: null,
    txProposalIndex: null,
  });

  // empty list should be fine
  await unlockUtxos(mysql, []);

  const inputs = utxos.map((utxo, index) => createInput(utxo.value, utxo.address, txId, index, utxo.tokenId, utxo.timelock));

  // set tx_outputs as spent
  await updateTxOutputSpentBy(mysql, inputs, txId);

  // get a spent tx output
  expect(await getTxOutput(mysql, txId, 0, false)).toStrictEqual({
    txId: 'txId',
    index: 0,
    tokenId: utxos[0].tokenId,
    address: utxos[0].address,
    value: utxos[0].value,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: txId,
    txProposalId: null,
    txProposalIndex: null,
  });

  // if the tx output is not found, it should return null
  expect(await getTxOutput(mysql, 'unknown-tx-id', 0, false)).toBeNull();

  await expect(checkUtxoTable(mysql, 0)).resolves.toBe(true);

  const spentTxOutputs = await getTxOutputsBySpent(mysql, [txId]);
  expect(spentTxOutputs).toHaveLength(5);

  const txOutputs = utxos.map((utxo, index) => ({
    ...utxo,
    txId,
    authorities: 0,
    heightlock: null,
    timelock: null,
    index,
  }));

  await unspendUtxos(mysql, txOutputs);

  for (const [index, output] of outputs.entries()) {
    let { value } = output;
    const { token, decoded } = output;
    let authorities = 0;
    if (isAuthority(output.token_data)) {
      authorities = value;
      value = 0;
    }
    await expect(
      checkUtxoTable(mysql, utxos.length, txId, index, token, decoded.address, value, authorities, decoded.timelock, null, output.locked),
    ).resolves.toBe(true);
  }

  // unlock the locked one
  const first = {
    txId,
    index: 2,
    tokenId: 'token2',
    address: 'address2',
    value: 25,
    authorities: 0,
    timelock: 500,
    heightlock: null,
    locked: true,
  };
  await unlockUtxos(mysql, [first]);
  await expect(checkUtxoTable(
    mysql, utxos.length, first.txId, first.index, first.tokenId, first.address, first.value, 0, first.timelock, first.heightlock, false,
  )).resolves.toBe(true);

  const countBeforeDelete = await countTxOutputTable(mysql);
  expect(countBeforeDelete).toStrictEqual(5);

  await markUtxosAsVoided(mysql, txOutputs);

  const countAfterDelete = await countTxOutputTable(mysql);
  expect(countAfterDelete).toStrictEqual(0);
});

test('getLockedUtxoFromInputs', async () => {
  expect.hasAssertions();
  const txId = 'txId';
  const utxos = [
    { value: 5, address: 'address1', token: 'token1', locked: false },
    { value: 25, address: 'address2', token: 'token2', timelock: 500, locked: true },
    { value: 35, address: 'address2', token: 'token1', locked: false },
  ];

  // add to utxo table
  const outputs = utxos.map((utxo, index) => createOutput(index, utxo.value, utxo.address, utxo.token, utxo.timelock || null, utxo.locked));
  await addUtxos(mysql, txId, outputs);
  for (const [index, output] of outputs.entries()) {
    const { token, decoded, value } = output;
    await expect(checkUtxoTable(mysql, 3, txId, index, token, decoded.address, value, 0, decoded.timelock, null, output.locked)).resolves.toBe(true);
  }

  const inputs = utxos.map((utxo, index) => createInput(utxo.value, utxo.address, txId, index, utxo.token, utxo.timelock));
  const results = await getLockedUtxoFromInputs(mysql, inputs);
  expect(results).toHaveLength(1);
  expect(results[0].value).toBe(25);
});

test('updateAddressTablesWithTx', async () => {
  expect.hasAssertions();
  const address1 = 'address1';
  const address2 = 'address2';
  const token1 = 'token1';
  const token2 = 'token2';
  const token3 = 'token3';
  // we'll add address1 to the address table already, as if it had already received another transaction
  await addToAddressTable(mysql, [
    { address: address1, index: null, walletId: null, transactions: 1 },
  ]);

  const txId1 = 'txId1';
  const timestamp1 = 10;
  const addrMap1 = {
    address1: TokenBalanceMap.fromStringMap({
      token1: { unlocked: 10, locked: 0 },
      token2: { unlocked: 7, locked: 0 },
      token3: { unlocked: 2, locked: 0, unlockedAuthorities: new Authorities(0b01) },
    }),
    address2: TokenBalanceMap.fromStringMap({ token1: { unlocked: 8, locked: 0, unlockedAuthorities: new Authorities(0b01) } }),
  };

  await updateAddressTablesWithTx(mysql, txId1, timestamp1, addrMap1);
  await expect(checkAddressTable(mysql, 2, address1, null, null, 2)).resolves.toBe(true);
  await expect(checkAddressTable(mysql, 2, address2, null, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 4, address1, token1, 10, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 4, address1, token2, 7, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 4, address1, token3, 2, 0, null, 1, 0b01, 0)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 4, address2, token1, 8, 0, null, 1, 0b01, 0)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 4, address1, txId1, token1, 10, timestamp1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 4, address1, txId1, token2, 7, timestamp1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 4, address1, txId1, token3, 2, timestamp1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 4, address2, txId1, token1, 8, timestamp1)).resolves.toBe(true);

  // this tx removes an authority for address1,token3
  const txId2 = 'txId2';
  const timestamp2 = 15;
  const addrMap2 = {
    address1: TokenBalanceMap.fromStringMap({ token1: { unlocked: -5, locked: 0 },
      token3: { unlocked: 6, locked: 0, unlockedAuthorities: new Authorities([-1]) } }),
    address2: TokenBalanceMap.fromStringMap({ token1: { unlocked: 8, locked: 0, unlockedAuthorities: new Authorities(0b10) },
      token2: { unlocked: 3, locked: 0 } }),
  };

  await updateAddressTablesWithTx(mysql, txId2, timestamp2, addrMap2);
  await expect(checkAddressTable(mysql, 2, address1, null, null, 3)).resolves.toBe(true);
  await expect(checkAddressTable(mysql, 2, address2, null, null, 2)).resolves.toBe(true);
  // final balance for each (address,token)
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token1', 5, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token2', 7, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address1, 'token3', 8, 0, null, 2, 0, 0)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address2, 'token1', 16, 0, null, 2, 0b11, 0)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, address2, 'token2', 3, 0, null, 1)).resolves.toBe(true);
  // tx history
  await expect(checkAddressTxHistoryTable(mysql, 8, address1, txId2, token1, -5, timestamp2)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, address1, txId2, token3, 6, timestamp2)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, address2, txId2, token1, 8, timestamp2)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, address2, txId2, token2, 3, timestamp2)).resolves.toBe(true);
  // make sure entries in address_tx_history from txId1 haven't been changed
  await expect(checkAddressTxHistoryTable(mysql, 8, address1, txId1, token1, 10, timestamp1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, address1, txId1, token2, 7, timestamp1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, address1, txId1, token3, 2, timestamp1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, address2, txId1, token1, 8, timestamp1)).resolves.toBe(true);

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

test('getWalletTokens', async () => {
  expect.hasAssertions();
  const wallet1 = 'wallet1';
  const wallet2 = 'wallet2';

  await addToWalletTxHistoryTable(mysql, [
    [wallet1, 'tx1', '00', 5, 1000, false],
    [wallet1, 'tx1', 'token2', 70, 1000, false],
    [wallet1, 'tx2', 'token3', 10, 1001, false],
    [wallet1, 'tx3', 'token4', 25, 1001, false],
    [wallet1, 'tx4', 'token2', 30, 1001, false],
    [wallet2, 'tx5', '00', 35, 1001, false],
    [wallet2, 'tx6', 'token2', 31, 1001, false],
  ]);

  const wallet1Tokens = await getWalletTokens(mysql, wallet1);
  const wallet2Tokens = await getWalletTokens(mysql, wallet2);

  expect(wallet1Tokens).toHaveLength(4);
  expect(wallet2Tokens).toHaveLength(2);
});

test('getWalletAddresses', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';
  const lastIndex = 5;
  // add some addresses into db
  const entries = [];
  for (let i = 0; i < lastIndex; i++) {
    entries.push({
      address: ADDRESSES[i],
      index: i,
      walletId,
      transactions: 0,
    });
  }
  // add entry to beginning of array, to test if method will return addresses ordered
  entries.unshift({
    address: ADDRESSES[lastIndex],
    index: lastIndex,
    walletId,
    transactions: 0,
  });
  await addToAddressTable(mysql, entries);

  const returnedAddresses = await getWalletAddresses(mysql, walletId);
  expect(returnedAddresses).toHaveLength(lastIndex + 1);
  for (const [i, address] of returnedAddresses.entries()) {
    expect(i).toBe(address.index);
    expect(address.address).toBe(ADDRESSES[i]);
  }

  // if we pass the filterAddresses optional parameter, we should receive just these
  const filteredReturnedAddresses = await getWalletAddresses(mysql, walletId, [
    ADDRESSES[0],
    ADDRESSES[2],
    ADDRESSES[3],
  ]);

  expect(filteredReturnedAddresses).toHaveLength(3);
  expect(filteredReturnedAddresses[0].address).toBe(ADDRESSES[0]);
  expect(filteredReturnedAddresses[1].address).toBe(ADDRESSES[2]);
  expect(filteredReturnedAddresses[2].address).toBe(ADDRESSES[3]);
});

test('getWalletAddressDetail', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';
  const lastIndex = 5;
  // add some addresses into db
  const entries = [];
  for (let i = 0; i < lastIndex; i++) {
    entries.push({
      address: ADDRESSES[i],
      index: i,
      walletId,
      transactions: 0,
    });
  }
  await addToAddressTable(mysql, entries);

  const detail0 = await getWalletAddressDetail(mysql, walletId, ADDRESSES[0]);
  expect(detail0.address).toBe(ADDRESSES[0]);
  expect(detail0.index).toBe(0);
  expect(detail0.transactions).toBe(0);

  const detail3 = await getWalletAddressDetail(mysql, walletId, ADDRESSES[3]);
  expect(detail3.address).toBe(ADDRESSES[3]);
  expect(detail3.index).toBe(3);
  expect(detail3.transactions).toBe(0);

  const detailNull = await getWalletAddressDetail(mysql, walletId, ADDRESSES[8]);
  expect(detailNull).toBeNull();
});

test('getWalletBalances', async () => {
  expect.hasAssertions();
  const walletId = 'walletId';
  const token1 = new TokenInfo('token1', 'MyToken1', 'MT1');
  const token2 = new TokenInfo('token2', 'MyToken2', 'MT2');
  const now = 1000;
  // add some balances into db

  await addToWalletBalanceTable(mysql, [{
    walletId,
    tokenId: token1.id,
    unlockedBalance: 10,
    lockedBalance: 4,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: now,
    transactions: 1,
  }, {
    walletId,
    tokenId: token2.id,
    unlockedBalance: 20,
    lockedBalance: 5,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: now,
    transactions: 2,
  }, {
    walletId: 'otherId',
    tokenId: token1.id,
    unlockedBalance: 30,
    lockedBalance: 1,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: now,
    transactions: 3,
  }]);

  await addToTokenTable(mysql, [
    { id: token1.id, name: token1.name, symbol: token1.symbol, transactions: 0 },
    { id: token2.id, name: token2.name, symbol: token2.symbol, transactions: 0 },
  ]);

  // first test fetching all tokens
  let returnedBalances = await getWalletBalances(mysql, walletId);
  expect(returnedBalances).toHaveLength(2);
  for (const balance of returnedBalances) {
    if (balance.token.id === token1.id) {
      expect(balance.token).toStrictEqual(token1);
      expect(balance.balance.unlockedAmount).toBe(10);
      expect(balance.balance.lockedAmount).toBe(4);
      expect(balance.balance.lockExpires).toBe(now);
      expect(balance.transactions).toBe(1);
    } else {
      expect(balance.token).toStrictEqual(token2);
      expect(balance.balance.unlockedAmount).toBe(20);
      expect(balance.balance.lockedAmount).toBe(5);
      expect(balance.transactions).toBe(2);
      expect(balance.balance.lockExpires).toBe(now);
    }
  }

  // fetch both tokens explicitly
  returnedBalances = await getWalletBalances(mysql, walletId, [token1.id, token2.id]);
  expect(returnedBalances).toHaveLength(2);

  // fetch only balance for token2
  returnedBalances = await getWalletBalances(mysql, walletId, [token2.id]);
  expect(returnedBalances).toHaveLength(1);
  expect(returnedBalances[0].token).toStrictEqual(token2);
  expect(returnedBalances[0].balance.unlockedAmount).toBe(20);
  expect(returnedBalances[0].balance.lockedAmount).toBe(5);
  expect(returnedBalances[0].balance.lockExpires).toBe(now);
  expect(returnedBalances[0].transactions).toBe(2);

  // fetch balance for non existing token
  returnedBalances = await getWalletBalances(mysql, walletId, ['otherToken']);
  expect(returnedBalances).toHaveLength(0);
});

test('getUtxosLockedAtHeight', async () => {
  expect.hasAssertions();

  const txId = 'txId';
  const txId2 = 'txId2';
  const utxos = [
    // no locks
    { value: 5, address: 'address1', token: 'token1', locked: false },
    // only timelock
    { value: 25, address: 'address2', token: 'token2', timelock: 50, locked: false },

  ];
  const utxos2 = [
    // only heightlock
    { value: 35, address: 'address2', token: 'token1', timelock: null, locked: true },
    // timelock and heightlock
    { value: 45, address: 'address2', token: 'token1', timelock: 100, locked: true },
    { value: 55, address: 'address2', token: 'token1', timelock: 1000, locked: true },
  ];

  // add to utxo table
  const outputs = utxos.map((utxo, index) => createOutput(index, utxo.value, utxo.address, utxo.token, utxo.timelock, utxo.locked));
  await addUtxos(mysql, txId, outputs, null);
  const outputs2 = utxos2.map((utxo, index) => createOutput(index, utxo.value, utxo.address, utxo.token, utxo.timelock, utxo.locked));
  await addUtxos(mysql, txId2, outputs2, 10);

  // fetch on timestamp=99 and heightlock=10. Should return:
  // { value: 35, address: 'address2', token: 'token1', timelock: null},
  let results = await getUtxosLockedAtHeight(mysql, 99, 10);
  expect(results).toHaveLength(1);
  expect(results[0].value).toBe(35);

  // fetch on timestamp=100 and heightlock=10. Should return:
  // { value: 35, address: 'address2', token: 'token1', timelock: null},
  // { value: 45, address: 'address2', token: 'token1', timelock: 100},
  results = await getUtxosLockedAtHeight(mysql, 100, 10);
  expect(results).toHaveLength(2);
  expect([35, 45]).toContain(results[0].value);
  expect([35, 45]).toContain(results[1].value);

  // fetch on timestamp=100 and heightlock=9. Should return empty
  results = await getUtxosLockedAtHeight(mysql, 1000, 9);
  expect(results).toStrictEqual([]);

  // unlockedHeight < 0. This means the block is still very early after genesis and no blocks have been unlocked
  results = await getUtxosLockedAtHeight(mysql, 1000, -2);
  expect(results).toStrictEqual([]);
});

test('updateAddressLockedBalance', async () => {
  expect.hasAssertions();

  const addr1 = 'address1';
  const addr2 = 'address2';
  const tokenId = 'tokenId';
  const otherToken = 'otherToken';
  const entries = [
    [addr1, tokenId, 50, 20, null, 3, 0, 0b01, 70],
    [addr2, tokenId, 0, 5, null, 1, 0, 0, 10],
    [addr1, otherToken, 5, 5, null, 1, 0, 0, 10],
  ];
  await addToAddressBalanceTable(mysql, entries);

  const addr1Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 10, locked: 0, unlockedAuthorities: new Authorities(0b01) } });
  const addr2Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 5, locked: 0 } });
  await updateAddressLockedBalance(mysql, { [addr1]: addr1Map, [addr2]: addr2Map });
  await expect(checkAddressBalanceTable(mysql, 3, addr1, tokenId, 60, 10, null, 3, 0b01, 0)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, addr2, tokenId, 5, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, addr1, otherToken, 5, 5, null, 1)).resolves.toBe(true);

  // now pretend there's another locked authority, so final balance of locked authorities should be updated accordingly
  await addToUtxoTable(mysql, [{
    txId: 'txId',
    index: 0,
    tokenId,
    address: addr1,
    value: 0,
    authorities: 0b01,
    timelock: 10000,
    heightlock: null,
    locked: true,
    spentBy: null,
  }]);
  const newMap = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 0, locked: 0, unlockedAuthorities: new Authorities(0b10) } });
  await updateAddressLockedBalance(mysql, { [addr1]: newMap });
  await expect(checkAddressBalanceTable(mysql, 3, addr1, tokenId, 60, 10, null, 3, 0b11, 0b01)).resolves.toBe(true);
});

test('updateWalletLockedBalance', async () => {
  expect.hasAssertions();

  const wallet1 = 'wallet1';
  const wallet2 = 'wallet2';
  const tokenId = 'tokenId';
  const otherToken = 'otherToken';
  const now = 1000;

  const entries = [{
    walletId: wallet1,
    tokenId,
    unlockedBalance: 10,
    lockedBalance: 20,
    unlockedAuthorities: 0b01,
    lockedAuthorities: 0,
    timelockExpires: now,
    transactions: 5,
  }, {
    walletId: wallet2,
    tokenId,
    unlockedBalance: 0,
    lockedBalance: 100,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: now,
    transactions: 4,
  }, {
    walletId: wallet1,
    tokenId: otherToken,
    unlockedBalance: 1,
    lockedBalance: 2,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }];
  await addToWalletBalanceTable(mysql, entries);

  const wallet1Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 15, locked: 0, unlockedAuthorities: new Authorities(0b11) } });
  const wallet2Map = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 50, locked: 0 } });
  await updateWalletLockedBalance(mysql, { [wallet1]: wallet1Map, [wallet2]: wallet2Map });
  await expect(checkWalletBalanceTable(mysql, 3, wallet1, tokenId, 25, 5, now, 5, 0b11, 0)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, wallet2, tokenId, 50, 50, now, 4)).resolves.toBe(true);
  await expect(checkWalletBalanceTable(mysql, 3, wallet1, otherToken, 1, 2, null, 1)).resolves.toBe(true);

  // now pretend there's another locked authority, so final balance of locked authorities should be updated accordingly
  await addToAddressTable(mysql, [{
    address: 'address1',
    index: 0,
    walletId: wallet1,
    transactions: 1,
  }]);
  await addToAddressBalanceTable(mysql, [['address1', tokenId, 0, 0, null, 1, 0, 0b01, 0]]);
  const newMap = TokenBalanceMap.fromStringMap({ [tokenId]: { unlocked: 0, locked: 0, unlockedAuthorities: new Authorities(0b10) } });
  await updateWalletLockedBalance(mysql, { [wallet1]: newMap });
  await expect(checkWalletBalanceTable(mysql, 3, wallet1, tokenId, 25, 5, now, 5, 0b11, 0b01)).resolves.toBe(true);
});

test('addOrUpdateTx should add weight to a tx', async () => {
  expect.hasAssertions();

  await addOrUpdateTx(mysql, 'txId1', null, 1, 1, 65.4321);
  const txs = await getTransactionsById(mysql, ['txId1']);

  expect(txs[0].weight).toStrictEqual(65.4321);
});

test('updateTx should add height to a tx', async () => {
  expect.hasAssertions();

  await addOrUpdateTx(mysql, 'txId1', null, 1, 1, 60);
  await updateTx(mysql, 'txId1', 5, 1, 1, 60);

  const txs = await getTransactionsById(mysql, ['txId1']);
  const tx = txs[0];

  expect(tx.txId).toStrictEqual('txId1');
  expect(tx.height).toStrictEqual(5);
});

test('getLatestBlockByHeight', async () => {
  expect.hasAssertions();

  // It should return null when the database has no blocks
  const nullBestBlock: Block = await getLatestBlockByHeight(mysql);
  expect(nullBestBlock).toBeNull();

  await addOrUpdateTx(mysql, 'block0', 0, 0, 0, 60);
  await addOrUpdateTx(mysql, 'block1', 1, 0, 0, 60);
  await addOrUpdateTx(mysql, 'block2', 2, 0, 0, 60);
  await addOrUpdateTx(mysql, 'block3', 3, 0, 0, 60);
  await addOrUpdateTx(mysql, 'tx1', 3, 0, 1, 60); // Tx
  // Confirmed by a block we don't have, this is an impossible situation, but
  // works for the test:
  await addOrUpdateTx(mysql, 'tx2', 4, 0, 1, 60);

  const bestBlock: Block = await getLatestBlockByHeight(mysql);

  expect(bestBlock.height).toStrictEqual(3);
  expect(bestBlock.txId).toStrictEqual('block3');
});

test('getLatestHeight, getTxsAfterHeight, deleteBlocksAfterHeight and removeTxsHeight', async () => {
  expect.hasAssertions();

  await addOrUpdateTx(mysql, 'txId0', 0, 1, 0, 60);

  expect(await getLatestHeight(mysql)).toBe(0);

  await addOrUpdateTx(mysql, 'txId5', 5, 2, 0, 60);

  expect(await getLatestHeight(mysql)).toBe(5);

  await addOrUpdateTx(mysql, 'txId7', 7, 3, 0, 60);

  expect(await getLatestHeight(mysql)).toBe(7);

  await addOrUpdateTx(mysql, 'txId8', 8, 4, 0, 60);
  await addOrUpdateTx(mysql, 'txId9', 9, 5, 0, 60);
  await addOrUpdateTx(mysql, 'txId10', 10, 6, 0, 60);

  const txsAfterHeight = await getTxsAfterHeight(mysql, 6);

  expect(txsAfterHeight).toHaveLength(4);

  expect(await getLatestHeight(mysql)).toBe(10);

  await deleteBlocksAfterHeight(mysql, 7);

  expect(await getLatestHeight(mysql)).toBe(7);

  // add the transactions again
  await addOrUpdateTx(mysql, 'txId8', 8, 4, 0, 60);
  await addOrUpdateTx(mysql, 'txId9', 9, 5, 0, 60);
  await addOrUpdateTx(mysql, 'txId10', 10, 6, 0, 60);

  // remove their height
  const transactions = await getTransactionsById(mysql, ['txId8', 'txId9', 'txId10']);
  await removeTxsHeight(mysql, transactions);

  expect(await getLatestHeight(mysql)).toBe(7);
});

test('getLatestHeight with no blocks on database should return 0', async () => {
  expect.hasAssertions();

  expect(await getLatestHeight(mysql)).toBe(0);
});

test('getBlockByHeight should return null if a block is not found', async () => {
  expect.hasAssertions();

  expect(await getBlockByHeight(mysql, 100000)).toBeNull();
});

test('storeTokenInformation and getTokenInformation', async () => {
  expect.hasAssertions();

  expect(await getTokenInformation(mysql, 'invalid')).toBeNull();

  const info = new TokenInfo('tokenId', 'tokenName', 'TKNS');
  storeTokenInformation(mysql, info.id, info.name, info.symbol);

  expect(info).toStrictEqual(await getTokenInformation(mysql, info.id));
});

test('validateTokenTimestamps', async () => {
  expect.hasAssertions();

  const info = new TokenInfo('tokenId', 'tokenName', 'TKNS');
  storeTokenInformation(mysql, info.id, info.name, info.symbol);
  let result = await mysql.query('SELECT * FROM `token` WHERE `id` = ?', [info.id]);

  expect(result[0].created_at).toStrictEqual(result[0].updated_at);

  await new Promise((r) => setTimeout(r, 1100));
  await mysql.query('UPDATE `token` SET name = ? WHERE `id` = ?', ['newName', info.id]);
  result = await mysql.query('SELECT * FROM `token` WHERE `id` = ?', [info.id]);

  // After updating the entry, the created_at and updated_at must be different
  expect(result[0].created_at).not.toStrictEqual(result[0].updated_at);
});

test('getWalletSortedValueUtxos', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const walletId = 'walletId';
  const tokenId = 'tokenId';
  const txId = 'txId';
  await addToAddressTable(mysql, [{
    address: addr1,
    index: 0,
    walletId,
    transactions: 1,
  }, {
    address: addr2,
    index: 1,
    walletId,
    transactions: 1,
  }]);
  await addToUtxoTable(mysql, [
    // authority utxos should be ignored
    {
      txId,
      index: 0,
      tokenId,
      address: addr1,
      value: 0,
      authorities: 0b01,
      timelock: null,
      heightlock: null,
      locked: false,
      spentBy: null,
    },
    // locked utxos should be ignored
    {
      txId,
      index: 1,
      tokenId,
      address: addr1,
      value: 10,
      authorities: 0,
      timelock: 10000,
      heightlock: null,
      locked: true,
      spentBy: null,
    },
    // another wallet
    {
      txId,
      index: 2,
      tokenId,
      address: 'otherAddr',
      value: 10,
      authorities: 0,
      timelock: null,
      heightlock: null,
      locked: false,
      spentBy: null,
    },
    // another token
    {
      txId,
      index: 3,
      tokenId: 'tokenId2',
      address: addr1,
      value: 5,
      authorities: 0,
      timelock: null,
      heightlock: null,
      locked: false,
      spentBy: null,
    },
    // these sould be fetched
    {
      txId,
      index: 4,
      tokenId,
      address: addr1,
      value: 4,
      authorities: 0,
      timelock: null,
      heightlock: null,
      locked: false,
      spentBy: null,
    },
    {
      txId,
      index: 5,
      tokenId,
      address: addr2,
      value: 1,
      authorities: 0,
      timelock: null,
      heightlock: null,
      locked: false,
      spentBy: null,
    },
    {
      txId,
      index: 6,
      tokenId,
      address: addr1,
      value: 7,
      authorities: 0,
      timelock: null,
      heightlock: null,
      locked: false,
      spentBy: null,
    },
  ]);

  const utxos = await getWalletSortedValueUtxos(mysql, walletId, tokenId);
  expect(utxos).toHaveLength(3);
  expect(utxos[0]).toStrictEqual({
    txId, index: 6, tokenId, address: addr1, value: 7, authorities: 0, timelock: null, heightlock: null, locked: false,
  });
  expect(utxos[1]).toStrictEqual({
    txId, index: 4, tokenId, address: addr1, value: 4, authorities: 0, timelock: null, heightlock: null, locked: false,
  });
  expect(utxos[2]).toStrictEqual({
    txId, index: 5, tokenId, address: addr2, value: 1, authorities: 0, timelock: null, heightlock: null, locked: false,
  });
});

test('getUnusedAddresses', async () => {
  expect.hasAssertions();

  const walletId = 'walletId';
  const walletId2 = 'walletId2';
  await addToAddressTable(mysql, [
    { address: 'addr2', index: 1, walletId, transactions: 0 },
    { address: 'addr3', index: 2, walletId, transactions: 2 },
    { address: 'addr1', index: 0, walletId, transactions: 0 },
    { address: 'addr4', index: 0, walletId: walletId2, transactions: 1 },
    { address: 'addr5', index: 1, walletId: walletId2, transactions: 1 },
  ]);

  let addresses = await getUnusedAddresses(mysql, walletId);
  expect(addresses).toHaveLength(2);
  expect(addresses[0]).toBe('addr1');
  expect(addresses[1]).toBe('addr2');

  addresses = await getUnusedAddresses(mysql, walletId2);
  expect(addresses).toHaveLength(0);
});

test('markUtxosWithProposalId and getTxProposalInputs', async () => {
  expect.hasAssertions();

  const txId = 'txId';
  const tokenId = 'tokenId';
  const address = 'address';
  const txProposalId = 'txProposalId';

  const utxos = [{
    txId,
    index: 0,
    tokenId,
    address,
    value: 5,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  }, {
    txId,
    index: 1,
    tokenId,
    address,
    value: 15,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  }, {
    txId,
    index: 2,
    tokenId,
    address,
    value: 25,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  }];

  // add to utxo table
  const outputs = utxos.map((utxo, index) => createOutput(index, utxo.value, utxo.address, utxo.tokenId, utxo.timelock, utxo.locked));
  await addUtxos(mysql, txId, outputs);

  // we'll only mark utxos with indexes 0 and 2
  await markUtxosWithProposalId(mysql, txProposalId, utxos.filter((utxo) => utxo.index !== 1));
  let proposalIndex = 0;
  utxos.forEach((utxo) => {
    utxo.txProposalId = utxo.index !== 1 ? txProposalId : null;         // eslint-disable-line no-param-reassign
    utxo.txProposalIndex = utxo.index !== 1 ? proposalIndex++ : null;   // eslint-disable-line no-param-reassign
  });

  const finalUtxos = await getUtxos(mysql, utxos.map((utxo) => ({ txId, index: utxo.index })));
  expect(utxos).toStrictEqual(finalUtxos);

  // getTxProposalInputs
  // utxo with index 1 should not be returned
  const inputs = [{ txId, index: 0 }, { txId, index: 2 }];
  expect(await getTxProposalInputs(mysql, txProposalId)).toStrictEqual(inputs);
});

test('createTxProposal, updateTxProposal, getTxProposal, countUnsentTxProposals, releaseTxProposalUtxos', async () => {
  expect.hasAssertions();

  const now = getUnixTimestamp();
  const txProposalId = uuidv4();
  const walletId = 'walletId';

  await createTxProposal(mysql, txProposalId, walletId, now);
  let txProposal = await getTxProposal(mysql, txProposalId);
  expect(txProposal).toStrictEqual({ id: txProposalId, walletId, status: TxProposalStatus.OPEN, createdAt: now, updatedAt: null });

  // update
  await updateTxProposal(mysql, [txProposalId], now + 7, TxProposalStatus.SENT);
  txProposal = await getTxProposal(mysql, txProposalId);
  expect(txProposal).toStrictEqual({ id: txProposalId, walletId, status: TxProposalStatus.SENT, createdAt: now, updatedAt: now + 7 });

  // tx proposal not found
  expect(await getTxProposal(mysql, 'aaa')).toBeNull();

  const txProposalId1: string = uuidv4() as string;
  const txProposalId2: string = uuidv4() as string;
  const txProposalId3: string = uuidv4() as string;
  const txProposalId4: string = uuidv4() as string;

  // Create old tx proposals
  await createTxProposal(mysql, txProposalId1, walletId, 1);
  await createTxProposal(mysql, txProposalId2, walletId, 1);
  await createTxProposal(mysql, txProposalId3, walletId, 1);

  // Create a new tx proposal, that won't be removed
  await createTxProposal(mysql, txProposalId4, walletId, now);

  const txProposalsBefore = now - (5 * 60); // 5 minutes in seconds

  // Fetch the list of unsent tx proposals
  const unsentTxProposals = await getUnsentTxProposals(mysql, txProposalsBefore);
  expect(unsentTxProposals).toContain(txProposalId1);
  expect(unsentTxProposals).toContain(txProposalId2);
  expect(unsentTxProposals).toContain(txProposalId3);

  // The new tx proposal should not be in the unsent list
  expect(unsentTxProposals).not.toContain(txProposalId4);

  // Add utxos for the unsent tx proposals so we can check if they got cleaned up
  await addToUtxoTable(mysql, [{
    txId: 'tx1',
    index: 0,
    tokenId: '00',
    address: 'address1',
    value: 5,
    authorities: 0,
    timelock: 0,
    heightlock: 0,
    locked: false,
    spentBy: null,
    txProposalId: txProposalId1,
    txProposalIndex: 0,
  }, {
    txId: 'tx2',
    index: 0,
    tokenId: '00',
    address: 'address1',
    value: 5,
    authorities: 0,
    timelock: 0,
    heightlock: 0,
    locked: false,
    spentBy: null,
    txProposalId: txProposalId2,
    txProposalIndex: 0,
  }, {
    txId: 'tx3',
    index: 0,
    tokenId: '00',
    address: 'address1',
    value: 5,
    authorities: 0,
    timelock: 0,
    heightlock: 0,
    locked: false,
    spentBy: null,
    txProposalId: txProposalId3,
    txProposalIndex: 0,
  }]);

  // Release txProposalUtxos should properly release the utxos. This method will throw an error if the
  // updated count is different from the sent tx proposals count.
  await releaseTxProposalUtxos(mysql, [txProposalId1, txProposalId2, txProposalId3]);
  await expect(releaseTxProposalUtxos(mysql, ['invalid-tx-proposal'])).rejects.toMatchInlineSnapshot('[AssertionError: Not all utxos were correctly updated]');
});

test('updateVersionData', async () => {
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

  const mockData2: FullNodeVersionData = {
    ...mockData,
    version: '0.39.1',
  };

  const mockData3: FullNodeVersionData = {
    ...mockData,
    version: '0.39.2',
  };

  await updateVersionData(mysql, mockData);
  await updateVersionData(mysql, mockData2);
  await updateVersionData(mysql, mockData3);

  await expect(
    checkVersionDataTable(mysql, mockData3),
  ).resolves.toBe(true);
});

test('getVersionData', async () => {
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

  const versionData: FullNodeVersionData = await getVersionData(mysql);

  expect(Object.entries(versionData).toString()).toStrictEqual(Object.entries(mockData).toString());
});

test('fetchAddressTxHistorySum', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const token1 = 'token1';
  const token2 = 'token2';
  const txId1 = 'txId1';
  const txId2 = 'txId2';
  const txId3 = 'txId3';
  const timestamp1 = 10;
  const timestamp2 = 20;
  const entries = [
    { address: addr1, txId: txId1, tokenId: token1, balance: 10, timestamp: timestamp1 },
    { address: addr1, txId: txId2, tokenId: token1, balance: 20, timestamp: timestamp2 },
    { address: addr1, txId: txId3, tokenId: token1, balance: 30, timestamp: timestamp2 },
    // total: 60
    { address: addr2, txId: txId1, tokenId: token2, balance: 20, timestamp: timestamp1 },
    { address: addr2, txId: txId2, tokenId: token2, balance: 20, timestamp: timestamp2 },
    { address: addr2, txId: txId3, tokenId: token2, balance: 10, timestamp: timestamp2 },
    // total: 50
  ];

  await addToAddressTxHistoryTable(mysql, entries);

  const history = await fetchAddressTxHistorySum(mysql, [addr1, addr2]);

  expect(history[0].balance).toStrictEqual(60);
  expect(history[1].balance).toStrictEqual(50);
});

test('fetchAddressBalance', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const addr3 = 'addr3';
  const token1 = 'token1';
  const token2 = 'token2';
  const timelock = 500;

  const addressEntries = [
    // address, tokenId, unlocked, locked, lockExpires, transactions
    [addr1, token1, 2, 0, null, 2, 0, 0, 4],
    [addr1, token2, 1, 4, timelock, 1, 0, 0, 5],
    [addr2, token1, 5, 2, null, 2, 0, 0, 10],
    [addr2, token2, 0, 2, null, 1, 0, 0, 2],
    [addr3, token1, 0, 1, null, 1, 0, 0, 1],
    [addr3, token2, 10, 1, null, 1, 0, 0, 11],
  ];

  await addToAddressBalanceTable(mysql, addressEntries);

  const addressBalances = await fetchAddressBalance(mysql, [addr1, addr2, addr3]);

  expect(addressBalances[0].address).toStrictEqual('addr1');
  expect(addressBalances[0].tokenId).toStrictEqual('token1');
  expect(addressBalances[0].unlockedBalance).toStrictEqual(2);
  expect(addressBalances[0].lockedBalance).toStrictEqual(0);
  expect(addressBalances[1].address).toStrictEqual('addr1');
  expect(addressBalances[1].tokenId).toStrictEqual('token2');
  expect(addressBalances[1].unlockedBalance).toStrictEqual(1);
  expect(addressBalances[1].lockedBalance).toStrictEqual(4);

  expect(addressBalances[2].address).toStrictEqual('addr2');
  expect(addressBalances[2].tokenId).toStrictEqual('token1');
  expect(addressBalances[2].unlockedBalance).toStrictEqual(5);
  expect(addressBalances[2].lockedBalance).toStrictEqual(2);
  expect(addressBalances[3].address).toStrictEqual('addr2');
  expect(addressBalances[3].tokenId).toStrictEqual('token2');
  expect(addressBalances[3].unlockedBalance).toStrictEqual(0);
  expect(addressBalances[3].lockedBalance).toStrictEqual(2);

  expect(addressBalances[4].address).toStrictEqual('addr3');
  expect(addressBalances[4].tokenId).toStrictEqual('token1');
  expect(addressBalances[4].unlockedBalance).toStrictEqual(0);
  expect(addressBalances[4].lockedBalance).toStrictEqual(1);
  expect(addressBalances[5].address).toStrictEqual('addr3');
  expect(addressBalances[5].tokenId).toStrictEqual('token2');
  expect(addressBalances[5].unlockedBalance).toStrictEqual(10);
  expect(addressBalances[5].lockedBalance).toStrictEqual(1);
});

test('addTx, fetchTx, getTransactionsById and markTxsAsVoided', async () => {
  expect.hasAssertions();

  const txId1 = 'txId1';
  const txId2 = 'txId2';
  const txId3 = 'txId3';
  const txId4 = 'txId4';
  const txId5 = 'txId5';
  const timestamp = 10;

  const tx1: Tx = {
    txId: txId1,
    height: 15,
    timestamp,
    version: 0,
    voided: false,
    weight: 60,
  };

  await addOrUpdateTx(mysql, tx1.txId, tx1.height, tx1.timestamp, tx1.version, tx1.weight);

  expect(await fetchTx(mysql, txId1)).toStrictEqual(tx1);

  const tx2 = { ...tx1, txId: txId2 };
  await addOrUpdateTx(mysql, tx2.txId, tx2.height, tx2.timestamp, tx2.version, tx2.weight);

  const tx3 = { ...tx1, txId: txId3 };
  await addOrUpdateTx(mysql, tx3.txId, tx3.height, tx3.timestamp, tx3.version, tx3.weight);

  const tx4 = { ...tx1, txId: txId4 };
  await addOrUpdateTx(mysql, tx4.txId, tx4.height, tx4.timestamp, tx4.version, tx4.weight);

  const tx5 = { ...tx1, txId: txId5 };
  await addOrUpdateTx(mysql, tx5.txId, tx5.height, tx5.timestamp, tx5.version, tx5.weight);

  const transactions = await getTransactionsById(mysql, [txId1, txId2, txId3, txId4, txId5]);

  expect(transactions).toHaveLength(5);

  await markTxsAsVoided(mysql, [tx1, tx2, tx3, tx4, tx5]);

  expect(await fetchTx(mysql, txId1)).toBeNull();
  expect(await fetchTx(mysql, txId2)).toBeNull();
  expect(await fetchTx(mysql, txId3)).toBeNull();
  expect(await fetchTx(mysql, txId4)).toBeNull();
  expect(await fetchTx(mysql, txId5)).toBeNull();
});

test('checkTxWasVoided', async () => {
  expect.hasAssertions();

  const tx1 = 'tx1';
  const tx2 = 'tx2';
  const address1 = 'address1';
  const address2 = 'address2';

  await addToAddressTxHistoryTable(mysql, [{
    address: address1,
    txId: tx1,
    tokenId: '00',
    balance: 0,
    timestamp: 1,
    voided: true,
  }, {
    address: address2,
    txId: tx2,
    tokenId: '00',
    balance: 0,
    timestamp: 1,
    voided: false,
  }]);

  expect(await checkTxWasVoided(mysql, tx1)).toStrictEqual(true);
  expect(await checkTxWasVoided(mysql, tx2)).toStrictEqual(false);
});

test('cleanupVoidedTx', async () => {
  expect.hasAssertions();
  const txId = 'txId1';
  const txId2 = 'txId2';
  const addr1 = 'addr1';
  const walletId = 'walletid';
  const tokenId = '00';

  await addToUtxoTable(mysql, [{
    txId,
    index: 0,
    tokenId,
    address: addr1,
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
    voided: true,
  }]);

  await addToAddressTxHistoryTable(mysql, [{
    address: addr1,
    txId,
    tokenId,
    balance: 0,
    timestamp: 1,
    voided: true,
  }]);

  await addToWalletTxHistoryTable(mysql, [
    [walletId, txId, tokenId, 0, 0, true],
  ]);

  await cleanupVoidedTx(mysql, txId);

  expect(await getTxOutput(mysql, txId, 0, false)).toBeNull();
  expect(await getWalletTxHistory(mysql, walletId, tokenId, 0, 10)).toHaveLength(0);
  expect(await checkAddressTxHistoryTable(
    mysql,
    0,
    addr1,
    txId,
    tokenId,
    0,
    1,
  )).toStrictEqual(true);

  // It shouldn't do anything on non-voided transactions

  await addToTransactionTable(mysql, [
    [txId2, 0, 1, false, 0, 0],
  ]);

  const utxo2 = {
    txId: txId2,
    index: 0,
    tokenId,
    address: addr1,
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  };

  await addToUtxoTable(mysql, [utxo2]);

  await addToAddressTxHistoryTable(mysql, [{
    txId: txId2,
    timestamp: 1,
    address: addr1,
    tokenId,
    balance: 0,
    voided: false,
  }]);

  await addToWalletTxHistoryTable(mysql, [
    [walletId, txId2, tokenId, 0, 0, false],
  ]);

  await cleanupVoidedTx(mysql, txId2);

  expect(await getWalletTxHistory(mysql, walletId, tokenId, 0, 10)).toHaveLength(1);
  expect(await getTxOutput(mysql, txId2, 0, false)).toStrictEqual(utxo2);
  expect(await checkAddressTxHistoryTable(
    mysql,
    1,
    addr1,
    txId2,
    tokenId,
    0,
    1,
  )).toStrictEqual(true);
});

test('rebuildAddressBalancesFromUtxos', async () => {
  expect.hasAssertions();

  const addr1 = 'address1';
  const addr2 = 'address2';
  const txId = 'tx1';
  const txId2 = 'tx2';
  const txId3 = 'tx3';
  const txId4 = 'tx4';
  const token1 = 'token1';
  const token2 = 'token2';
  const timestamp1 = 10;

  const utxosTx1 = [
    { value: 5, address: addr1, token: token1, locked: false, spentBy: null },
    { value: 15, address: addr1, token: token1, locked: false, spentBy: null },
    { value: 75, address: addr2, token: token1, heightlock: 70, locked: true, spentBy: null },
    { value: 150, address: addr2, token: token1, heightlock: 70, locked: true, spentBy: null },
    { value: 35, address: addr2, token: token1, locked: false, spentBy: null },

    { value: 25, address: addr2, token: token2, timelock: 500, locked: true, spentBy: null },

    // authority utxo
    { value: 0b11, address: addr1, token: token1, locked: false, tokenData: 129, spentBy: null },
  ];

  const utxosTx2 = [
    // spent utxos
    { value: 80, address: addr2, token: token1, heightlock: 70, locked: false, spentBy: null },
    { value: 90, address: addr2, token: token1, heightlock: 70, locked: false, spentBy: null },
  ];

  const utxosTx3 = [
    // spent utxos
    { value: 5, address: addr2, token: token1, heightlock: 70, locked: false, spentBy: null },
    { value: 10, address: addr2, token: token1, heightlock: 70, locked: false, spentBy: null },
  ];

  const utxosTx4 = [
    // spent utxos
    { value: 20, address: addr1, token: token1, heightlock: 70, locked: false, spentBy: null },
    { value: 1, address: addr1, token: token1, heightlock: 70, locked: false, spentBy: null },
  ];

  const mapUtxoListToOutput = (utxoList: any[]) => utxoList.map((utxo, index) => createOutput(
    index,
    utxo.value,
    utxo.address,
    utxo.token,
    utxo.timelock || null,
    utxo.locked,
    utxo.tokenData || 0,
    utxo.spentBy,
  ));

  await addUtxos(mysql, txId, mapUtxoListToOutput(utxosTx1));
  await addUtxos(mysql, txId2, mapUtxoListToOutput(utxosTx2));
  await addUtxos(mysql, txId3, mapUtxoListToOutput(utxosTx3));
  await addUtxos(mysql, txId4, mapUtxoListToOutput(utxosTx4));

  // We need to have a address_balance row before rebuilding as rebuildAddressBalancesFromUtxos will
  // subtract the number of affected transactions from it.
  // Since the actual balances are rebuilt from the utxos and we are only modifying the transactions count,
  // we can safely set all balances and authorities to 0.

  const addressEntries = [
    // address, tokenId, unlocked, locked, lockExpires, transactions, unlocked_authorities, locked_authorities
    [addr1, token1, 0, 0, null, 2, 0, 0, 0],
    [addr2, token1, 0, 0, null, 3, 0, 0, 0],
    [addr2, token2, 0, 0, null, 1, 0, 0, 0],
  ];

  await addToAddressBalanceTable(mysql, addressEntries);

  const txHistory = [
    { address: addr1, txId, tokenId: token1, balance: 20, timestamp: timestamp1 },
    { address: addr1, txId: txId4, tokenId: token1, balance: 21, timestamp: timestamp1, voided: true },

    { address: addr2, txId, tokenId: token1, balance: 260, timestamp: timestamp1 },
    { address: addr2, txId, tokenId: token2, balance: 25, timestamp: timestamp1 },
    { address: addr2, txId: txId2, tokenId: token1, balance: 80, timestamp: timestamp1 },
    { address: addr2, txId: txId3, tokenId: token1, balance: 15, timestamp: timestamp1, voided: true },
  ];

  await addToAddressTxHistoryTable(mysql, txHistory);

  // add to the token table
  await addToTokenTable(mysql, [
    { id: token1, name: 'token1', symbol: 'TKN1', transactions: 2 },
  ]);

  await expect(checkTokenTable(mysql, 1, [{
    tokenId: token1,
    tokenSymbol: 'TKN1',
    tokenName: 'token1',
    transactions: 2,
  }])).resolves.toBe(true);

  // We are only using the txList parameter on `transactions` recalculation, so our balance
  // checks should include txId3 and txId4, but the transaction count should not.
  await rebuildAddressBalancesFromUtxos(mysql, [addr1, addr2], [txId3, txId4]);

  const addressBalances = await fetchAddressBalance(mysql, [addr1, addr2]);

  expect(addressBalances[0].unlockedBalance).toStrictEqual(41);
  expect(addressBalances[0].unlockedAuthorities).toStrictEqual(0b11);
  expect(addressBalances[0].address).toStrictEqual(addr1);
  expect(addressBalances[0].transactions).toStrictEqual(1);
  expect(addressBalances[0].tokenId).toStrictEqual('token1');

  expect(addressBalances[1].unlockedBalance).toStrictEqual(220);
  expect(addressBalances[1].lockedBalance).toStrictEqual(225);
  expect(addressBalances[1].address).toStrictEqual(addr2);
  expect(addressBalances[1].transactions).toStrictEqual(2);
  expect(addressBalances[1].tokenId).toStrictEqual('token1');

  expect(addressBalances[2].lockedBalance).toStrictEqual(25);
  expect(addressBalances[2].address).toStrictEqual(addr2);
  expect(addressBalances[2].transactions).toStrictEqual(1);
  expect(addressBalances[2].tokenId).toStrictEqual('token2');

  await expect(checkTokenTable(mysql, 1, [{
    tokenId: token1,
    tokenSymbol: 'TKN1',
    tokenName: 'token1',
    transactions: 0,
  }])).resolves.toBe(true);
});

test('markAddressTxHistoryAsVoided', async () => {
  expect.hasAssertions();

  const addr1 = 'address1';
  const addr2 = 'address2';
  const txId1 = 'tx1';
  const txId2 = 'tx2';
  const txId3 = 'tx3';
  const token1 = 'token1';
  const token2 = 'token2';
  const timestamp1 = 10;
  const timestamp2 = 20;

  const entries = [
    { address: addr1, txId: txId1, tokenId: token1, balance: 10, timestamp: timestamp1 },
    { address: addr1, txId: txId2, tokenId: token1, balance: 20, timestamp: timestamp2 },
    { address: addr1, txId: txId3, tokenId: token1, balance: 30, timestamp: timestamp2 },
    // total: 60
    { address: addr2, txId: txId1, tokenId: token2, balance: 20, timestamp: timestamp1 },
    { address: addr2, txId: txId2, tokenId: token2, balance: 20, timestamp: timestamp2 },
    { address: addr2, txId: txId3, tokenId: token2, balance: 10, timestamp: timestamp2 },
    // total: 50
  ];

  await addToAddressTxHistoryTable(mysql, entries);

  const history = await fetchAddressTxHistorySum(mysql, [addr1, addr2]);

  expect(history).toHaveLength(2);

  await markAddressTxHistoryAsVoided(mysql, [{
    txId: txId1,
    timestamp: timestamp1,
    version: 0,
    voided: false,
    weight: 60,
  }, {
    txId: txId2,
    timestamp: timestamp1,
    version: 0,
    voided: false,
    weight: 60,
  }, {
    txId: txId3,
    timestamp: timestamp1,
    version: 0,
    voided: false,
    weight: 60,
  }]);

  const history2 = await fetchAddressTxHistorySum(mysql, [addr1, addr2]);

  expect(history2).toHaveLength(0);
});

test('filterTxOutputs', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const walletId = 'walletId';
  const tokenId = 'tokenId';
  const txId = 'txId';
  const txId2 = 'txId2';
  const txId3 = 'txId3';

  await addToAddressTable(mysql, [{
    address: addr1,
    index: 0,
    walletId,
    transactions: 1,
  }, {
    address: addr2,
    index: 1,
    walletId,
    transactions: 1,
  }]);

  await addToUtxoTable(mysql, [{
    txId: txId3,
    index: 0,
    tokenId: '00',
    address: addr1,
    value: 6000,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId,
    index: 0,
    tokenId,
    address: addr1,
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: txId2,
    index: 0,
    tokenId,
    address: addr1,
    value: 500,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: txId2,
    index: 1,
    tokenId,
    address: addr1,
    value: 1000,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    // locked utxo:
    txId: txId2,
    index: 2,
    tokenId,
    address: addr2,
    value: 1500,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    // authority utxo:
    txId: txId2,
    index: 3,
    tokenId,
    address: addr2,
    value: 0,
    authorities: 0b01,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    // another authority utxo:
    txId: txId2,
    index: 4,
    tokenId,
    address: addr2,
    value: 0,
    authorities: 0b01,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }]);

  // filter all hathor utxos from addr1 and addr2
  let utxos = await filterTxOutputs(mysql, { addresses: [addr1, addr2] });
  expect(utxos).toHaveLength(1);

  // filter all 'tokenId' utxos from addr1 and addr2
  utxos = await filterTxOutputs(mysql, { addresses: [addr1, addr2], tokenId });
  expect(utxos).toHaveLength(4);

  // filter all 'tokenId' utxos from addr1 and addr2 that are not locked
  utxos = await filterTxOutputs(mysql, { addresses: [addr1, addr2], tokenId, ignoreLocked: true });
  expect(utxos).toHaveLength(3);

  // filter all authority utxos from addr1 and addr2
  utxos = await filterTxOutputs(mysql, { addresses: [addr1, addr2], tokenId, authority: 0b01 });
  expect(utxos).toHaveLength(2);

  // filter all utxos between 100 and 1500
  utxos = await filterTxOutputs(mysql, { addresses: [addr1, addr2], tokenId, biggerThan: 100, smallerThan: 1500 });
  expect(utxos).toHaveLength(2);
  expect(utxos[0]).toStrictEqual({
    txId: txId2,
    index: 1,
    tokenId,
    address: addr1,
    value: 1000,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });
  expect(utxos[1]).toStrictEqual({
    txId: txId2,
    index: 0,
    tokenId,
    address: addr1,
    value: 500,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });

  // limit to 2 utxos, should return the largest 2 ordered by value
  utxos = await filterTxOutputs(mysql, { addresses: [addr1, addr2], tokenId, maxOutputs: 2 });
  expect(utxos).toHaveLength(2);
  expect(utxos[0]).toStrictEqual({
    txId: txId2,
    index: 2,
    tokenId,
    address: addr2,
    value: 1500,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: true,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });
  expect(utxos[1]).toStrictEqual({
    txId: txId2,
    index: 1,
    tokenId,
    address: addr1,
    value: 1000,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });

  // authorities != 0 and maxOutputs == 1 should return only one authority utxo
  utxos = await filterTxOutputs(mysql, { addresses: [addr1, addr2], biggerThan: 0, smallerThan: 3, authority: 1, tokenId, maxOutputs: 1 });

  expect(utxos).toHaveLength(1);
});

test('filterTxOutputs should throw if addresses are empty', async () => {
  expect.hasAssertions();

  await expect(filterTxOutputs(mysql, { addresses: [] })).rejects.toThrow('Addresses can\'t be empty.');
});

test('beginTransaction, commitTransaction, rollbackTransaction', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const tokenId = 'tokenId';
  const txId = 'txId';

  await beginTransaction(mysql);

  await addToUtxoTable(mysql, [{
    txId,
    index: 0,
    tokenId,
    address: addr1,
    value: 0,
    authorities: 0b01,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId,
    index: 1,
    tokenId,
    address: addr1,
    value: 10,
    authorities: 0,
    timelock: 10000,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    txId,
    index: 2,
    tokenId,
    address: 'otherAddr',
    value: 10,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }]);

  await commitTransaction(mysql);

  await expect(checkUtxoTable(mysql, 3, txId, 0, tokenId, addr1, 0, 0b01, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 3, txId, 1, tokenId, addr1, 10, 0, 10000, null, true)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 3, txId, 2, tokenId, 'otherAddr', 10, 0, null, null, false)).resolves.toBe(true);

  await beginTransaction(mysql);

  await addToUtxoTable(mysql, [{
    txId,
    index: 3,
    tokenId: 'tokenId2',
    address: addr1,
    value: 5,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId,
    index: 4,
    tokenId,
    address: addr1,
    value: 4,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId,
    index: 5,
    tokenId,
    address: addr2,
    value: 1,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId,
    index: 6,
    tokenId,
    address: addr1,
    value: 7,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }]);

  await rollbackTransaction(mysql);

  // check if the database still has 3 elements only
  await expect(checkUtxoTable(mysql, 3, txId, 2, tokenId, 'otherAddr', 10, 0, null, null, false)).resolves.toBe(true);
});

test('getMinersList', async () => {
  expect.hasAssertions();

  await addMiner(mysql, 'address1', 'txId1');
  await addMiner(mysql, 'address2', 'txId2');
  await addMiner(mysql, 'address3', 'txId3');

  let results = await getMinersList(mysql);

  expect(results).toHaveLength(3);
  expect(new Set(results)).toStrictEqual(new Set([
    { address: 'address1', firstBlock: 'txId1', lastBlock: 'txId1', count: 1 },
    { address: 'address2', firstBlock: 'txId2', lastBlock: 'txId2', count: 1 },
    { address: 'address3', firstBlock: 'txId3', lastBlock: 'txId3', count: 1 },
  ]));

  await addMiner(mysql, 'address3', 'txId4');
  await addMiner(mysql, 'address3', 'txId5');

  results = await getMinersList(mysql);

  expect(results).toHaveLength(3);

  expect(new Set(results)).toStrictEqual(new Set([
    { address: 'address1', firstBlock: 'txId1', lastBlock: 'txId1', count: 1 },
    { address: 'address2', firstBlock: 'txId2', lastBlock: 'txId2', count: 1 },
    { address: 'address3', firstBlock: 'txId3', lastBlock: 'txId5', count: 3 },
  ]));
});

test('getTotalSupply', async () => {
  expect.hasAssertions();

  const txId = 'txId';
  const utxos = [
    { value: 500, address: 'HDeadDeadDeadDeadDeadDeadDeagTPgmn', tokenId: '00', locked: false },
    { value: 5, address: 'address1', tokenId: '00', locked: false },
    { value: 15, address: 'address1', tokenId: '00', locked: false },
    { value: 25, address: 'address2', tokenId: 'token2', timelock: 500, locked: true },
    { value: 35, address: 'address2', tokenId: 'token1', locked: false },
    // authority utxo
    { value: 0b11, address: 'address1', tokenId: 'token1', locked: false, tokenData: 129 },
  ];

  // add to utxo table
  const outputs = utxos.map((utxo, index) => createOutput(
    index,
    utxo.value,
    utxo.address,
    utxo.tokenId,
    utxo.timelock || null,
    utxo.locked,
    utxo.tokenData || 0,
  ));

  await addUtxos(mysql, txId, outputs);

  expect(await getTotalSupply(mysql, '00')).toStrictEqual(20);
  expect(await getTotalSupply(mysql, 'token2')).toStrictEqual(25);
  expect(await getTotalSupply(mysql, 'token1')).toStrictEqual(35);

  const mysqlQuerySpy = jest.spyOn(mysql, 'query');
  mysqlQuerySpy.mockImplementationOnce(() => Promise.resolve({ length: null }));

  await expect(getTotalSupply(mysql, 'undefined-token')).rejects.toThrow('Total supply query returned no results');
  expect(mockedAddAlert).toHaveBeenCalledWith(
    'Total supply query returned no results',
    '-',
    Severity.MINOR,
    { tokenId: 'undefined-token' },
  );
});

test('getExpiredTimelocksUtxos', async () => {
  expect.hasAssertions();

  const txId = 'txId';
  const utxos = [
    { value: 5, address: 'address1', tokenId: 'token1', locked: true },
    { value: 15, address: 'address1', tokenId: 'token1', locked: true },
    { value: 25, address: 'address2', tokenId: 'token2', timelock: 100, locked: true },
    { value: 35, address: 'address2', tokenId: 'token1', timelock: 200, locked: true },
    // authority utxo
    { value: 0b11, address: 'address1', tokenId: 'token1', timelock: 300, locked: true, tokenData: 129 },
  ];

  // empty list should be fine
  await addUtxos(mysql, txId, []);

  // add to utxo table
  const outputs = utxos.map((utxo, index) => createOutput(
    index,
    utxo.value,
    utxo.address,
    utxo.tokenId,
    utxo.timelock || null,
    utxo.locked,
    utxo.tokenData || 0,
  ));

  await addUtxos(mysql, txId, outputs);

  const unlockedUtxos0: DbTxOutput[] = await getExpiredTimelocksUtxos(mysql, 100);
  const unlockedUtxos1: DbTxOutput[] = await getExpiredTimelocksUtxos(mysql, 101);
  const unlockedUtxos2: DbTxOutput[] = await getExpiredTimelocksUtxos(mysql, 201);
  const unlockedUtxos3: DbTxOutput[] = await getExpiredTimelocksUtxos(mysql, 301);

  expect(unlockedUtxos0).toHaveLength(0);
  expect(unlockedUtxos1).toHaveLength(1);
  expect(unlockedUtxos1[0].value).toStrictEqual(outputs[2].value);
  expect(unlockedUtxos2).toHaveLength(2);
  expect(unlockedUtxos2[1].value).toStrictEqual(outputs[3].value);
  expect(unlockedUtxos3).toHaveLength(3);
  // last one is an authority utxo
  expect(unlockedUtxos3[2].authorities).toStrictEqual(outputs[4].value);
});

test('getTotalTransactions', async () => {
  expect.hasAssertions();

  await addToAddressTxHistoryTable(mysql, [
    { address: 'address1', txId: 'txId1', tokenId: 'token1', balance: -5, timestamp: 1000 },
    { address: 'address1', txId: 'txId2', tokenId: 'token1', balance: 5, timestamp: 1000 },
    { address: 'address1', txId: 'txId3', tokenId: 'token1', balance: 10, timestamp: 1000 },
    { address: 'address2', txId: 'txId4', tokenId: 'token2', balance: -5, timestamp: 1000 },
    { address: 'address2', txId: 'txId5', tokenId: 'token2', balance: 50, timestamp: 1000 },
  ]);

  expect(await getTotalTransactions(mysql, 'token1')).toStrictEqual(3);
  expect(await getTotalTransactions(mysql, 'token2')).toStrictEqual(2);

  const mysqlQuerySpy = jest.spyOn(mysql, 'query');
  mysqlQuerySpy.mockImplementationOnce(() => Promise.resolve({ length: null }));

  await expect(getTotalTransactions(mysql, 'undefined-token')).rejects.toThrow('Total transactions query returned no results');
  expect(mockedAddAlert).toHaveBeenCalledWith(
    'Total transactions query returned no results',
    '-',
    Severity.MINOR,
    { tokenId: 'undefined-token' },
  );
});

test('getAvailableAuthorities', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr1';
  const tokenId = 'token1';
  const tokenId2 = 'token2';

  await addToUtxoTable(mysql, [{
    txId: 'txId',
    index: 0,
    tokenId,
    address: addr1,
    value: 0,
    authorities: 0b01,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: 'tx1',
  }, {
    txId: 'txId',
    index: 1,
    tokenId,
    address: addr1,
    value: 0,
    authorities: 0b11,
    timelock: 1000,
    heightlock: null,
    locked: true,
    spentBy: null,
  }, {
    txId: 'txId',
    index: 2,
    tokenId,
    address: addr1,
    value: 0,
    authorities: 0b10,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: 'txId',
    index: 3,
    tokenId: tokenId2,
    address: addr2,
    value: 0,
    authorities: 0b01,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }]);

  expect(await getAvailableAuthorities(mysql, 'token1')).toHaveLength(1);
  expect(await getAvailableAuthorities(mysql, 'token2')).toHaveLength(1);
});

test('getUtxo, getAuthorityUtxo', async () => {
  expect.hasAssertions();

  const tokenId = 'tokenId';
  const addr1 = 'addr1';

  await addToUtxoTable(mysql, [{
    txId: 'txId',
    index: 0,
    tokenId,
    address: addr1,
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: 10000,
    heightlock: null,
    locked: true,
    spentBy: null,
  }]);
  await addToUtxoTable(mysql, [{
    txId: 'txId',
    index: 1,
    tokenId,
    address: addr1,
    value: 0,
    authorities: constants.TOKEN_MELT_MASK,
    timelock: 10000,
    heightlock: null,
    locked: true,
    spentBy: null,
  }]);

  const utxo = await getTxOutput(mysql, 'txId', 0, true);
  expect(utxo).toStrictEqual({
    txId: 'txId',
    index: 0,
    tokenId,
    address: addr1,
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: 10000,
    heightlock: null,
    locked: true,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });

  const mintUtxo = await getAuthorityUtxo(mysql, tokenId, constants.TOKEN_MINT_MASK);
  const meltUtxo = await getAuthorityUtxo(mysql, tokenId, constants.TOKEN_MELT_MASK);

  expect(mintUtxo).toStrictEqual({
    txId: 'txId',
    index: 0,
    tokenId,
    address: addr1,
    value: 0,
    authorities: constants.TOKEN_MINT_MASK,
    timelock: 10000,
    heightlock: null,
    locked: true,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });
  expect(meltUtxo).toStrictEqual({
    txId: 'txId',
    index: 1,
    tokenId,
    address: addr1,
    value: 0,
    authorities: constants.TOKEN_MELT_MASK,
    timelock: 10000,
    heightlock: null,
    locked: true,
    txProposalId: null,
    txProposalIndex: null,
    spentBy: null,
  });
});

test('getAffectedAddressTxCountFromTxList', async () => {
  expect.hasAssertions();

  const addr1 = 'addr1';
  const addr2 = 'addr2';
  const addr3 = 'addr3';
  const token1 = 'token1';
  const token2 = 'token2';
  const token3 = 'token3';
  const txId1 = 'txId1';
  const txId2 = 'txId2';
  const txId3 = 'txId3';
  const timestamp1 = 10;
  const timestamp2 = 20;

  const entries: AddressTxHistoryTableEntry[] = [
    { address: addr1, txId: txId1, tokenId: token1, balance: 10, timestamp: timestamp1, voided: true },
    { address: addr1, txId: txId1, tokenId: token2, balance: 7, timestamp: timestamp1, voided: true },
    { address: addr2, txId: txId1, tokenId: token2, balance: 5, timestamp: timestamp1, voided: true },
    { address: addr3, txId: txId1, tokenId: token1, balance: 3, timestamp: timestamp1, voided: true },
    { address: addr1, txId: txId2, tokenId: token1, balance: -1, timestamp: timestamp2, voided: false },
    { address: addr1, txId: txId2, tokenId: token3, balance: 3, timestamp: timestamp2, voided: false },
    { address: addr2, txId: txId3, tokenId: token2, balance: -5, timestamp: timestamp2, voided: true },
    { address: addr3, txId: txId3, tokenId: token1, balance: 3, timestamp: timestamp2, voided: true },
  ];

  await addToAddressTxHistoryTable(mysql, entries);

  expect(await getAffectedAddressTxCountFromTxList(mysql, [txId1, txId3])).toStrictEqual({
    [`${addr1}_${token1}`]: 1,
    [`${addr1}_${token2}`]: 1,
    [`${addr2}_${token2}`]: 2,
    [`${addr3}_${token1}`]: 2,
  });

  // txId2 is not voided, so we should not count them on the address transaction count:
  expect(await getAffectedAddressTxCountFromTxList(mysql, [txId1, txId2, txId3])).toStrictEqual({
    [`${addr1}_${token1}`]: 1,
    [`${addr1}_${token2}`]: 1,
    [`${addr2}_${token2}`]: 2,
    [`${addr3}_${token1}`]: 2,
  });

  // We should get an empty object if no addresses have been affected:
  expect(await getAffectedAddressTxCountFromTxList(mysql, [txId2])).toStrictEqual({});
});

test('incrementTokensTxCount', async () => {
  expect.hasAssertions();

  const htr = new TokenInfo('00', 'Hathor', 'HTR', 5);
  const token1 = new TokenInfo('token1', 'MyToken1', 'MT1', 10);
  const token2 = new TokenInfo('token2', 'MyToken2', 'MT2', 15);

  await addToTokenTable(mysql, [
    { id: htr.id, name: htr.name, symbol: htr.symbol, transactions: htr.transactions },
    { id: token1.id, name: token1.name, symbol: token1.symbol, transactions: token1.transactions },
    { id: token2.id, name: token2.name, symbol: token2.symbol, transactions: token2.transactions },
  ]);

  await incrementTokensTxCount(mysql, ['token1', '00', 'token2']);

  await expect(checkTokenTable(mysql, 3, [{
    tokenId: token1.id,
    tokenSymbol: token1.symbol,
    tokenName: token1.name,
    transactions: token1.transactions + 1,
  }, {
    tokenId: token2.id,
    tokenSymbol: token2.symbol,
    tokenName: token2.name,
    transactions: token2.transactions + 1,
  }, {
    tokenId: htr.id,
    tokenSymbol: htr.symbol,
    tokenName: htr.name,
    transactions: htr.transactions + 1,
  }])).resolves.toBe(true);
});

test('existsPushDevice', async () => {
  expect.hasAssertions();

  const walletId = 'wallet1';
  const deviceId = 'device1';
  const pushProvider = 'android';
  const enablePush = true;
  const enableShowAmounts = false;

  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

  let existsResult = await existsPushDevice(mysql, deviceId, walletId);

  // there is no device registered to a wallet at this stage
  expect(existsResult).toBe(false);

  // register the device to a wallet
  await registerPushDevice(mysql, {
    walletId,
    deviceId,
    pushProvider,
    enablePush,
    enableShowAmounts,
  });

  existsResult = await existsPushDevice(mysql, deviceId, walletId);

  // there is a device registered to a wallet
  expect(existsResult).toBe(true);
});

test('registerPushDevice', async () => {
  expect.hasAssertions();

  const walletId = 'wallet1';
  const deviceId = 'device1';
  const pushProvider = 'android';
  const enablePush = true;
  const enableShowAmounts = false;

  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

  await registerPushDevice(mysql, {
    walletId,
    deviceId,
    pushProvider,
    enablePush,
    enableShowAmounts,
  });

  await expect(checkPushDevicesTable(mysql, 1, {
    walletId,
    deviceId,
    pushProvider,
    enablePush,
    enableShowAmounts,
  })).resolves.toBe(true);
});

describe('updatePushDevice', () => {
  it('should update pushDevice when register exists', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const deviceId = 'device1';
    const pushProvider = 'android';
    const enableShowAmounts = false;

    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    await registerPushDevice(mysql, {
      walletId,
      deviceId,
      pushProvider,
      enablePush: false,
      enableShowAmounts,
    });

    await updatePushDevice(mysql, {
      walletId,
      deviceId,
      enablePush: true,
      enableShowAmounts,
    });

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId,
      pushProvider,
      enablePush: true,
      enableShowAmounts,
    })).resolves.toBe(true);
  });

  it('should update pushDevice when more than 1 wallet is related', async () => {
    expect.hasAssertions();

    const deviceToUpdate = 'device1';
    const deviceToKeep = 'device2';
    const walletId = 'wallet1';
    const pushProvider = 'android';
    const enableShowAmounts = false;

    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    const devicesToAdd = [deviceToUpdate, deviceToKeep];
    devicesToAdd.forEach(async (eachDevice) => {
      await registerPushDevice(mysql, {
        walletId,
        deviceId: eachDevice,
        pushProvider,
        enablePush: false,
        enableShowAmounts,
      });
    });
    await expect(checkPushDevicesTable(mysql, devicesToAdd.length)).resolves.toBe(true);

    await updatePushDevice(mysql, {
      walletId,
      deviceId: deviceToUpdate,
      enablePush: true,
      enableShowAmounts,
    });

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId: deviceToUpdate,
      pushProvider,
      enablePush: true,
      enableShowAmounts,
    })).resolves.toBe(true);

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId: deviceToKeep,
      pushProvider,
      enablePush: false,
      enableShowAmounts,
    })).resolves.toBe(true);
  });

  it('should run update successfuly even when there is no device registered', async () => {
    expect.hasAssertions();

    const deviceId = 'device1';
    const walletId = 'wallet1';
    const enablePush = true;
    const enableShowAmounts = false;

    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    await updatePushDevice(mysql, {
      walletId,
      deviceId,
      enablePush,
      enableShowAmounts,
    });

    await expect(checkPushDevicesTable(mysql, 0)).resolves.toBe(true);
  });
});

test('removeAllPushDeviceByDeviceId', async () => {
  expect.hasAssertions();

  const walletId = 'wallet1';
  const deviceIdOne = 'device_1';
  const deviceIdTwo = 'device_2';
  const pushProvider = 'android';
  const enablePush = true;
  const enableShowAmounts = false;

  // NOTE: Because deviceId is a primary key in push_devices table
  // it is not possible to register more than one device with the same deviceId.
  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);
  await registerPushDevice(mysql, {
    walletId,
    deviceId: deviceIdOne,
    pushProvider,
    enablePush,
    enableShowAmounts,
  });
  await registerPushDevice(mysql, {
    walletId,
    deviceId: deviceIdTwo,
    pushProvider,
    enablePush,
    enableShowAmounts,
  });
  await expect(checkPushDevicesTable(mysql, 2)).resolves.toBe(true);

  // remove all push device registered
  await removeAllPushDevicesByDeviceId(mysql, deviceIdOne);
  await expect(checkPushDevicesTable(mysql, 1)).resolves.toBe(true);
});

test('existsWallet', async () => {
  expect.hasAssertions();

  // wallet do not exists yet
  const walletId = 'wallet1';
  let exists = await existsWallet(mysql, walletId);

  expect(exists).toBe(false);

  // wallet exists
  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);
  exists = await existsWallet(mysql, walletId);

  expect(exists).toBe(true);
});

describe('unregisterPushDevice', () => {
  it('should unregister device', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const deviceId = 'device1';
    const pushProvider = 'android';
    const enablePush = false;
    const enableShowAmounts = false;

    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    await registerPushDevice(mysql, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    });

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    })).resolves.toBe(true);

    await unregisterPushDevice(mysql, deviceId, walletId);

    await expect(checkPushDevicesTable(mysql, 0)).resolves.toBe(true);
  });

  it('should unregister the right device in face of many', async () => {
    expect.hasAssertions();

    const pushProvider = 'android';
    const enablePush = false;
    const enableShowAmounts = false;
    const deviceToUnregister = 'device1';
    const deviceToRemain = 'device2';
    const devicesToAdd = [deviceToUnregister, deviceToRemain];

    const walletId = 'wallet1';
    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    devicesToAdd.forEach(async (eachDevice) => {
      await registerPushDevice(mysql, {
        walletId,
        deviceId: eachDevice,
        pushProvider,
        enablePush,
        enableShowAmounts,
      });
    });
    await expect(checkPushDevicesTable(mysql, 2)).resolves.toBe(true);

    await unregisterPushDevice(mysql, deviceToUnregister, walletId);

    await expect(checkPushDevicesTable(mysql, 1)).resolves.toBe(true);
    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId: deviceToRemain,
      pushProvider,
      enablePush,
      enableShowAmounts,
    })).resolves.toBe(true);
  });

  it('should succeed even when no device exists', async () => {
    expect.hasAssertions();

    const deviceId = 'device-not-exists';
    const walletId = 'wallet-not-exist';

    await expect(checkPushDevicesTable(mysql, 0)).resolves.toBe(true);

    await unregisterPushDevice(mysql, deviceId, walletId);

    await expect(checkPushDevicesTable(mysql, 0)).resolves.toBe(true);
  });

  it('should unregister device when provided only the device id', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const deviceId = 'device1';
    const pushProvider = 'android';
    const enablePush = false;
    const enableShowAmounts = false;

    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    await registerPushDevice(mysql, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    });

    await expect(checkPushDevicesTable(mysql, 1, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    })).resolves.toBe(true);

    await unregisterPushDevice(mysql, deviceId);

    await expect(checkPushDevicesTable(mysql, 0)).resolves.toBe(true);
  });
});

describe('getTransactionById', () => {
  it('should return a tx their tokens and balances', async () => {
    expect.hasAssertions();

    const txId1 = 'txId1';
    const walletId1 = 'wallet1';
    const addr1 = 'addr1';
    const token1 = { id: 'token1', name: 'Token 1', symbol: 'T1' };
    const token2 = { id: 'token2', name: 'Token 2', symbol: 'T2' };
    const timestamp1 = 10;
    const height1 = 1;
    const version1 = 3;
    const weight1 = 65.4321;

    await createWallet(mysql, walletId1, XPUBKEY, AUTH_XPUBKEY, 5);
    await addOrUpdateTx(mysql, txId1, height1, timestamp1, version1, weight1);

    await addToTokenTable(mysql, [
      { id: token1.id, name: token1.name, symbol: token1.symbol, transactions: 0 },
      { id: token2.id, name: token2.name, symbol: token2.symbol, transactions: 0 },
    ]);
    const entries = [
      { address: addr1, txId: txId1, tokenId: token1.id, balance: 10, timestamp: timestamp1 },
      { address: addr1, txId: txId1, tokenId: token2.id, balance: 7, timestamp: timestamp1 },
    ];
    await addToAddressTxHistoryTable(mysql, entries);
    await initWalletTxHistory(mysql, walletId1, [addr1]);

    const txTokens = await getTransactionById(mysql, txId1, walletId1);

    const [firstToken] = txTokens.filter((eachToken) => eachToken.tokenId === 'token1');
    const [secondToken] = txTokens.filter((eachToken) => eachToken.tokenId === 'token2');

    expect(firstToken).toStrictEqual({
      balance: 10,
      timestamp: timestamp1,
      tokenId: token1.id,
      tokenName: token1.name,
      tokenSymbol: token1.symbol,
      txId: txId1,
      version: version1,
      voided: false,
      weight: weight1,
    });
    expect(secondToken).toStrictEqual({
      balance: 7,
      timestamp: timestamp1,
      tokenId: token2.id,
      tokenName: token2.name,
      tokenSymbol: token2.symbol,
      txId: txId1,
      version: version1,
      voided: false,
      weight: weight1,
    });
  });

  it('should return empty list when there is no record', async () => {
    expect.hasAssertions();

    const txId = 'txId1';
    const walletId = 'wallet1';

    const txTokens = await getTransactionById(mysql, txId, walletId);

    expect(txTokens).toHaveLength(0);
  });
});

describe('getPushDevice', () => {
  it('should return PushDevice type object when device found', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const deviceId = 'device1';
    const pushProvider = 'android';
    const enablePush = true;
    const enableShowAmounts = false;

    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    await registerPushDevice(mysql, {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    });

    const result = await getPushDevice(mysql, deviceId);

    const expected = {
      walletId,
      deviceId,
      pushProvider,
      enablePush,
      enableShowAmounts,
    } as PushDevice;
    expect(result).toStrictEqual(expected);
  });

  it('should return null when device not found', async () => {
    expect.hasAssertions();

    const walletId = 'wallet1';
    const deviceId = 'device1';

    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    const result = await getPushDevice(mysql, deviceId);

    expect(result).toBeNull();
  });

  it('should return null when wallet not found', async () => {
    expect.hasAssertions();

    const deviceId = 'device1';

    const result = await getPushDevice(mysql, deviceId);

    expect(result).toBeNull();
  });
});

describe('getPushDeviceSettingsList', () => {
  it('should return an empty list when no device settings are found', async () => {
    expect.hasAssertions();

    // arrange variables
    const deviceCandidates = [
      {
        walletId: 'wallet1',
        deviceId: 'device1',
        pushProvider: PushProvider.ANDROID,
        enablePush: true,
        enableShowAmounts: true,
      },
      {
        walletId: 'wallet2',
        deviceId: 'device2',
        pushProvider: PushProvider.ANDROID,
        enablePush: false,
        enableShowAmounts: true,
      },
      {
        walletId: 'wallet3',
        deviceId: 'device3',
        pushProvider: PushProvider.ANDROID,
        enablePush: true,
        enableShowAmounts: false,
      },
      {
        walletId: 'wallet4',
        deviceId: 'device4',
        pushProvider: PushProvider.ANDROID,
        enablePush: false,
        enableShowAmounts: false,
      },
    ];

    // devices to load on database
    const devicesToLoad = deviceCandidates.filter((each) => each.enablePush === true);
    // devices to not load on database, they will be used on query
    const devicesToNotLoad = deviceCandidates.filter((each) => each.enablePush === false);

    // register wallets that will not be queried
    const loadWallet = (eachDevice) => createWallet(mysql, eachDevice.walletId, XPUBKEY, AUTH_XPUBKEY, 5);
    await devicesToLoad.forEach(loadWallet);

    // register devices related to the loaded wallets
    const loadDevice = (eachDevice) => registerPushDevice(mysql, {
      walletId: eachDevice.walletId,
      deviceId: eachDevice.deviceId,
      pushProvider: eachDevice.pushProvider,
      enablePush: eachDevice.enablePush,
      enableShowAmounts: eachDevice.enableShowAmounts,
    });
    await devicesToLoad.forEach(loadDevice);

    // get settings querying only devices not loaded on database, resulting on empty list
    const notRegisteredWalletIdList = devicesToNotLoad.map((each) => each.walletId);
    const result = await getPushDeviceSettingsList(mysql, notRegisteredWalletIdList);

    // assert settings
    expect(result).toStrictEqual([]);
  });

  it('should return a list of settings even when some wallet ids are not found', async () => {
    expect.hasAssertions();

    // arrange variables
    const deviceCandidates = [
      {
        walletId: 'wallet1',
        deviceId: 'device1',
        pushProvider: PushProvider.ANDROID,
        enablePush: true,
        enableShowAmounts: true,
      },
      {
        walletId: 'wallet2',
        deviceId: 'device2',
        pushProvider: PushProvider.ANDROID,
        enablePush: false,
        enableShowAmounts: true,
      },
      {
        walletId: 'wallet3',
        deviceId: 'device3',
        pushProvider: PushProvider.ANDROID,
        enablePush: true,
        enableShowAmounts: false,
      },
      {
        walletId: 'wallet4',
        deviceId: 'device4',
        pushProvider: PushProvider.ANDROID,
        enablePush: false,
        enableShowAmounts: false,
      },
    ];

    // devices to load on database
    const devicesToLoad = deviceCandidates.filter((each) => each.enablePush === true);
    // devices to not load on database
    const devicesToNotLoad = deviceCandidates.filter((each) => each.enablePush === false);

    // register wallets to be used by registered devices
    const loadWallet = (eachDevice) => createWallet(mysql, eachDevice.walletId, XPUBKEY, AUTH_XPUBKEY, 5);
    await devicesToLoad.forEach(loadWallet);

    // register devices related to the loaded wallets
    const loadDevice = (eachDevice) => registerPushDevice(mysql, {
      walletId: eachDevice.walletId,
      deviceId: eachDevice.deviceId,
      pushProvider: eachDevice.pushProvider,
      enablePush: eachDevice.enablePush,
      enableShowAmounts: eachDevice.enableShowAmounts,
    });
    await devicesToLoad.forEach(loadDevice);

    // get settings, query be all wallets of deviceCandidates, some are loaded on database, some are not
    const walletIdList = deviceCandidates.map((each) => each.walletId);
    const result = await getPushDeviceSettingsList(mysql, walletIdList);

    // assert settings, only devices with loaded wallets on database will be found
    expect(result).toHaveLength(2);

    // verify devices loaded, they should yield a not empty list, equal to the loaded devices
    const expectedPushDeviceSettigsList = deviceCandidates
      .filter((each) => each.enablePush === true)
      .map((each) => ({
        deviceId: each.deviceId,
        walletId: each.walletId,
        enablePush: each.enablePush,
        enableShowAmounts: each.enableShowAmounts,
      }));
    expect(result).toStrictEqual(expectedPushDeviceSettigsList);

    // verify devices not loaded, they should yield an empty list
    const walletIdListForNotRegisteredDevices = devicesToNotLoad.map((each) => each.deviceId);
    const resultNotRegisteredDevices = await getPushDeviceSettingsList(mysql, walletIdListForNotRegisteredDevices);
    expect(resultNotRegisteredDevices).toStrictEqual([]);
  });

  it('should return a list of settings for all the wallet ids', async () => {
    expect.hasAssertions();

    // arrange variables
    const devicesToLoad = [
      {
        walletId: 'wallet1',
        deviceId: 'device1',
        pushProvider: PushProvider.ANDROID,
        enablePush: true,
        enableShowAmounts: true,
      },
      {
        walletId: 'wallet2',
        deviceId: 'device2',
        pushProvider: PushProvider.ANDROID,
        enablePush: false,
        enableShowAmounts: true,
      },
      {
        walletId: 'wallet3',
        deviceId: 'device3',
        pushProvider: PushProvider.ANDROID,
        enablePush: true,
        enableShowAmounts: false,
      },
      {
        walletId: 'wallet4',
        deviceId: 'device4',
        pushProvider: PushProvider.ANDROID,
        enablePush: false,
        enableShowAmounts: false,
      },
    ];

    // register wallets, load all the wallets related to devicesToLoad
    const loadWallet = (eachDevice) => createWallet(mysql, eachDevice.walletId, XPUBKEY, AUTH_XPUBKEY, 5);
    await devicesToLoad.forEach(loadWallet);

    // register devices, register all the devices
    const loadDevice = (eachDevice) => registerPushDevice(mysql, {
      walletId: eachDevice.walletId,
      deviceId: eachDevice.deviceId,
      pushProvider: eachDevice.pushProvider,
      enablePush: eachDevice.enablePush,
      enableShowAmounts: eachDevice.enableShowAmounts,
    });
    await devicesToLoad.forEach(loadDevice);

    // get settings, get every device registered
    const walletIdList = devicesToLoad.map((each) => each.walletId);
    const result = await getPushDeviceSettingsList(mysql, walletIdList);

    // assert settings
    expect(result).toHaveLength(4);

    const expectedPushDeviceSettigsList = devicesToLoad.map((each) => ({
      deviceId: each.deviceId,
      walletId: each.walletId,
      enablePush: each.enablePush,
      enableShowAmounts: each.enableShowAmounts,
    }));
    expect(result).toStrictEqual(expectedPushDeviceSettigsList);
  });
});

describe('getTokenSymbols', () => {
  it('should return a map of token symbol by token id', async () => {
    expect.hasAssertions();

    const tokensToPersist = [
      new TokenInfo('token1', 'tokenName1', 'TKN1'),
      new TokenInfo('token2', 'tokenName2', 'TKN2'),
      new TokenInfo('token3', 'tokenName3', 'TKN3'),
      new TokenInfo('token4', 'tokenName4', 'TKN4'),
      new TokenInfo('token5', 'tokenName5', 'TKN5'),
    ];

    // persist tokens
    for (const eachToken of tokensToPersist) {
      await storeTokenInformation(mysql, eachToken.id, eachToken.name, eachToken.symbol);
    }

    const tokenIdList = tokensToPersist.map((each: TokenInfo) => each.id);
    const tokenSymbolMap = await getTokenSymbols(mysql, tokenIdList);

    expect(tokenSymbolMap).toStrictEqual({
      token1: 'TKN1',
      token2: 'TKN2',
      token3: 'TKN3',
      token4: 'TKN4',
      token5: 'TKN5',
    });
  });

  it('should return null when no token is found', async () => {
    expect.hasAssertions();

    const tokensToPersist = [
      new TokenInfo('token1', 'tokenName1', 'TKN1'),
      new TokenInfo('token2', 'tokenName2', 'TKN2'),
      new TokenInfo('token3', 'tokenName3', 'TKN3'),
      new TokenInfo('token4', 'tokenName4', 'TKN4'),
      new TokenInfo('token5', 'tokenName5', 'TKN5'),
    ];

    // no token persistence

    let tokenIdList = tokensToPersist.map((each: TokenInfo) => each.id);
    let tokenSymbolMap = await getTokenSymbols(mysql, tokenIdList);

    expect(tokenSymbolMap).toBeNull();

    tokenIdList = [];
    tokenSymbolMap = await getTokenSymbols(mysql, tokenIdList);

    expect(tokenSymbolMap).toBeNull();
  });
});

describe('countStalePushDevices', () => {
  it('should return the number of stale push devices', async () => {
    expect.hasAssertions();

    /**
     * Before any push device is registered, there should be no stale push devices
     */
    await expect(countStalePushDevices(mysql)).resolves.toBe(0);

    const walletId = 'wallet1';
    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    const pushRegister = buildPushRegister({
      walletId: 'wallet1',
      updatedAt: daysAgo(32), // it must be 32 because there are months with 31 days
    });
    await insertPushDevice(mysql, pushRegister);

    await expect(countStalePushDevices(mysql)).resolves.toBe(1);
  });
});

describe('deleteStalePushDevices', () => {
  it('should delete stale push devices', async () => {
    expect.hasAssertions();

    /**
     * Before any push device is registered, deleteStalePushDevices should not fail
     */
    await expect(deleteStalePushDevices(mysql)).resolves.toBeUndefined();

    const walletId = 'wallet1';
    await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, 5);

    const pushRegister = buildPushRegister({
      walletId: 'wallet1',
      updatedAt: daysAgo(32), // it must be 32 because there are months with 31 days
    });
    await insertPushDevice(mysql, pushRegister);

    await expect(countStalePushDevices(mysql)).resolves.toBe(1);

    await deleteStalePushDevices(mysql);

    await expect(countStalePushDevices(mysql)).resolves.toBe(0);
  });
});

describe('Clear unsent txProposals utxos', () => {
  it('should unset txProposal and txProposalId from unsent txProposals', async () => {
    expect.hasAssertions();

    const walletId = 'wallet-id';

    const txProposalId1: string = uuidv4() as string;
    const txProposalId2: string = uuidv4() as string;
    const txProposalId3: string = uuidv4() as string;

    // count unsent tx proposals
    await createTxProposal(mysql, txProposalId1, walletId, 1);
    await createTxProposal(mysql, txProposalId2, walletId, 1);
    await createTxProposal(mysql, txProposalId3, walletId, 1);

    await addToUtxoTable(mysql, [{
      txId: 'tx1',
      index: 0,
      tokenId: '00',
      address: 'address1',
      value: 5,
      authorities: 0,
      timelock: 0,
      heightlock: 0,
      locked: false,
      spentBy: null,
      txProposalId: txProposalId1,
      txProposalIndex: 0,
    }, {
      txId: 'tx2',
      index: 0,
      tokenId: '00',
      address: 'address1',
      value: 5,
      authorities: 0,
      timelock: 0,
      heightlock: 0,
      locked: false,
      spentBy: null,
      txProposalId: txProposalId2,
      txProposalIndex: 0,
    }, {
      txId: 'tx3',
      index: 0,
      tokenId: '00',
      address: 'address1',
      value: 5,
      authorities: 0,
      timelock: 0,
      heightlock: 0,
      locked: false,
      spentBy: null,
      txProposalId: txProposalId3,
      txProposalIndex: 0,
    }]);

    let utxo1 = await getTxOutput(mysql, 'tx1', 0, false);
    let utxo2 = await getTxOutput(mysql, 'tx2', 0, false);
    let utxo3 = await getTxOutput(mysql, 'tx3', 0, false);

    expect(utxo1.txProposalId).toStrictEqual(txProposalId1);
    expect(utxo2.txProposalId).toStrictEqual(txProposalId2);
    expect(utxo3.txProposalId).toStrictEqual(txProposalId3);

    await cleanUnsentTxProposalsUtxos();

    utxo1 = await getTxOutput(mysql, 'tx1', 0, false);
    utxo2 = await getTxOutput(mysql, 'tx2', 0, false);
    utxo3 = await getTxOutput(mysql, 'tx3', 0, false);

    expect(utxo1.txProposalId).toBeNull();
    expect(utxo2.txProposalId).toBeNull();
    expect(utxo3.txProposalId).toBeNull();

    const txProposals = await Promise.all([
      getTxProposal(mysql, txProposalId1),
      getTxProposal(mysql, txProposalId2),
      getTxProposal(mysql, txProposalId3),
    ]);

    expect(txProposals[0].status).toStrictEqual(TxProposalStatus.CANCELLED);
    expect(txProposals[1].status).toStrictEqual(TxProposalStatus.CANCELLED);
    expect(txProposals[2].status).toStrictEqual(TxProposalStatus.CANCELLED);

    const spy = jest.spyOn(Db, 'releaseTxProposalUtxos');
    spy.mockImplementationOnce(() => {
      throw new Error('error-releasing-tx-proposal');
    });

    await cleanUnsentTxProposalsUtxos();

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to release unspent tx proposals: ',
      expect.anything(),
      expect.anything(),
    );
  });

  it('should not fail when there is nothing to clear', async () => {
    expect.hasAssertions();

    await cleanUnsentTxProposalsUtxos();

    expect(logger.debug).toHaveBeenCalledWith('No txproposals utxos to clean.');
  });
});

describe('getAddressByIndex', () => {
  it('should find a wallets address from its index', async () => {
    expect.hasAssertions();

    const address = 'address';
    const walletId = 'walletId';
    const index = 0;
    const transactions = 0;

    await addToAddressTable(mysql, [{
      address,
      index,
      walletId,
      transactions,
    }]);

    await expect(getAddressAtIndex(mysql, walletId, index))
      .resolves
      .toStrictEqual({
        address,
        index,
        transactions,
      });
  });

  it('should return null if an address couldnt be found', async () => {
    expect.hasAssertions();

    const walletId = 'walletId';

    await expect(getAddressAtIndex(mysql, walletId, 1))
      .resolves
      .toBeNull();
  });
});
