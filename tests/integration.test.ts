import eventTemplate from '@events/eventTemplate.json';
import { loadWallet } from '@src/api/wallet';
import { createWallet, getMinersList } from '@src/db';
import * as txProcessor from '@src/txProcessor';
import { Transaction, WalletStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp, getWalletId } from '@src/utils';
import {
  ADDRESSES,
  XPUBKEY,
  AUTH_XPUBKEY,
  cleanDatabase,
  checkAddressTable,
  checkAddressBalanceTable,
  checkAddressTxHistoryTable,
  checkUtxoTable,
  checkWalletBalanceTable,
  checkWalletTable,
  checkWalletTxHistoryTable,
  createOutput,
  createInput,
} from '@tests/utils';

const mysql = getDbConnection();

const blockReward = 6400;
const htrToken = '00';
const walletId = getWalletId(XPUBKEY);
const now = getUnixTimestamp();
const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);
const OLD_ENV = process.env;

/*
 * xpubkey first addresses are: [
 *   HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci,
 *   HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4,
 *   H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag,
 *   HNgJXBgj8UtZK4GD97yvDZhyjCLFoLBdDf,
 *   HGfwgmn86RSQ1gNG6ceiKeiALwL84FuBf8
 * ]
 */

const blockEvent = JSON.parse(JSON.stringify(eventTemplate));
const block: Transaction = blockEvent.Records[0].body;
const txId1 = 'txId1';
block.tx_id = txId1;
block.timestamp = now;
block.height = 1;
block.outputs = [createOutput(0, blockReward, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci')];

// receive another block. Reward from first block should now be unlocked
const blockEvent2 = JSON.parse(JSON.stringify(eventTemplate));
const block2: Transaction = blockEvent2.Records[0].body;
const txId2 = 'txId2';
block2.tx_id = txId2;
block2.timestamp = block.timestamp + 30;
block2.height = block.height + 1;
block2.outputs = [createOutput(0, blockReward, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci')];

// block3 is from another miner
const blockEvent3 = JSON.parse(JSON.stringify(eventTemplate));
const block3: Transaction = blockEvent3.Records[0].body;
const anotherMinerTx = 'another_miner_tx';
block3.tx_id = anotherMinerTx;
block3.timestamp = block.timestamp + 60;
block3.height = block2.height + 1;
block3.outputs = [createOutput(0, blockReward, 'HTRuXktQiHvrfrwCZCPPBXNZK5SejgPneE')];

// block4 is from yet another miner
const blockEvent4 = JSON.parse(JSON.stringify(eventTemplate));
const block4: Transaction = blockEvent4.Records[0].body;
const yetAnotherMinerTx = 'yet_another_miner_tx';
block4.tx_id = yetAnotherMinerTx;
block4.timestamp = block.timestamp + 90;
block4.height = block3.height + 1;
block4.outputs = [createOutput(0, blockReward, 'HJPcaSncHGhzasvbbWP5yfZ6XSixwLHdHu')];

// tx sends first block rewards to 2 addresses on the same wallet
const txEvent = JSON.parse(JSON.stringify(eventTemplate));
const tx: Transaction = txEvent.Records[0].body;
const txId3 = 'txId3';
tx.version = 1;
tx.tx_id = txId3;
tx.timestamp += 20;
tx.inputs = [createInput(blockReward, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', txId1, 0)];
tx.outputs = [
  createOutput(0, blockReward - 5000, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4'),
  createOutput(1, 5000, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag'),
];

// tx sends one of last tx's outputs to 2 addresses, one of which is not from this wallet. Also, output sent to this wallet is locked
const txEvent2 = JSON.parse(JSON.stringify(eventTemplate));
const tx2: Transaction = txEvent2.Records[0].body;
const timelock = now + 90000;
tx2.version = 1;
const txId4 = 'txId4';
tx2.tx_id = txId4;
tx2.timestamp += 20;
tx2.inputs = [createInput(5000, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', txId2, 1)];
tx2.outputs = [
  createOutput(0, 1000, 'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr', '00', timelock),   // belongs to this wallet
  createOutput(1, 4000, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch'),   // other wallet
];

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

// eslint-disable-next-line jest/prefer-expect-assertions, jest/expect-expect
test('receive blocks and txs and then start wallet', async () => {
  /*
   * receive first block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingFirstBlock(false);

  /*
   * receive second block
   */
  await txProcessor.onNewTxEvent(blockEvent2);
  await checkAfterReceivingSecondBlock(false);

  /*
   * add transaction that sends block reward to 2 different addresses on same wallet
   */
  await txProcessor.onNewTxEvent(txEvent);
  await checkAfterReceivingTx1(false);

  /*
   * add transaction that sends block reward to 2 different addresses, one of which is not in this wallet
   */
  await txProcessor.onNewTxEvent(txEvent2);
  await checkAfterReceivingTx2(false);

  /*
   * create wallet
   */
  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, maxGap);
  await loadWallet({ xpubkey: XPUBKEY, maxGap }, null, null);

  await checkAfterReceivingTx2(true);
}, 60000);

// eslint-disable-next-line jest/prefer-expect-assertions, jest/expect-expect
test('start wallet and then receive blocks and txs', async () => {
  /*
   * create wallet
   */
  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, maxGap);
  await loadWallet({ xpubkey: XPUBKEY, maxGap }, null, null);

  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingFirstBlock(true);

  /*
   * receive second block
   */
  await txProcessor.onNewTxEvent(blockEvent2);
  await checkAfterReceivingSecondBlock(true);

  /*
   * add transaction that sends block reward to 2 different addresses on same wallet
   */
  await txProcessor.onNewTxEvent(txEvent);
  await checkAfterReceivingTx1(true);

  /*
   * add transaction that sends block reward to 2 different addresses, one of which is not in this wallet
   */
  await txProcessor.onNewTxEvent(txEvent2);
  await checkAfterReceivingTx2(true);
}, 60000);

// eslint-disable-next-line jest/prefer-expect-assertions, jest/expect-expect
test('receive blocks, start wallet and then receive transactions', async () => {
  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingFirstBlock(false);

  /*
   * receive second block
   */
  await txProcessor.onNewTxEvent(blockEvent2);
  await checkAfterReceivingSecondBlock(false);

  /*
   * create wallet
   */
  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, maxGap);
  await loadWallet({ xpubkey: XPUBKEY, maxGap }, null, null);

  /*
   * add transaction that sends block reward to 2 different addresses on same wallet
   */
  await txProcessor.onNewTxEvent(txEvent);
  await checkAfterReceivingTx1(true);

  /*
   * add transaction that sends block reward to 2 different addresses, one of which is not in this wallet
   */
  await txProcessor.onNewTxEvent(txEvent2);
  await checkAfterReceivingTx2(true);
}, 35000);

// eslint-disable-next-line jest/prefer-expect-assertions, jest/expect-expect
test('receive blocks and tx1, start wallet and then receive tx2', async () => {
  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingFirstBlock(false);

  /*
   * receive second block
   */
  await txProcessor.onNewTxEvent(blockEvent2);
  await checkAfterReceivingSecondBlock(false);

  /*
   * add transaction that sends block reward to 2 different addresses on same wallet
   */
  await txProcessor.onNewTxEvent(txEvent);
  await checkAfterReceivingTx1(false);

  /*
   * create wallet
   */
  await createWallet(mysql, walletId, XPUBKEY, AUTH_XPUBKEY, maxGap);
  await loadWallet({ xpubkey: XPUBKEY, maxGap }, null, null);

  /*
   * add transaction that sends block reward to 2 different addresses, one of which is not in this wallet
   */
  await txProcessor.onNewTxEvent(txEvent2);
  await checkAfterReceivingTx2(true);
}, 35000);

// eslint-disable-next-line jest/prefer-expect-assertions, jest/expect-expect
test('receive blocks fom 3 different miners, check miners list', async () => {
  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);

  /*
   * receive second block
   */
  await txProcessor.onNewTxEvent(blockEvent2);

  /*
   * receive the third block
   */
  await txProcessor.onNewTxEvent(blockEvent3);

  /*
   * receive the fourth block
   */
  await txProcessor.onNewTxEvent(blockEvent4);

  const minerList = await getMinersList(mysql);

  expect(minerList).toHaveLength(3);
}, 35000);

/*
 * After receiving the block, we only have 1 used address and block rewards are locked
 */
const checkAfterReceivingFirstBlock = async (walletStarted = false) => {
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);
  await expect(checkUtxoTable(mysql, 1, txId1, 0, htrToken, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', blockReward, 0, null, block.height + blockRewardLock, true)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', htrToken, 0, blockReward, null, 1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', txId1, htrToken, blockReward, block.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 1, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, 0, blockReward, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', 0, walletId, 1)).resolves.toBe(true);
    // addresses other than the used on must have been added to address table
    for (let i = 1; i < maxGap + 1; i++) {
      await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[i], i, walletId, 0)).resolves.toBe(true);
    }
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', null, null, 1)).resolves.toBe(true);
  }
};

/*
 * After receiving second block, rewards from the first block are unlocked
 */
const checkAfterReceivingSecondBlock = async (walletStarted = false) => {
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);
  await expect(checkUtxoTable(mysql, 2, txId2, 0, htrToken, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', blockReward, 0, null, block2.height + blockRewardLock, true)).resolves.toBe(true);
  // first block utxo is unlocked
  await expect(checkUtxoTable(mysql, 2, txId1, 0, htrToken, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', blockReward, 0, null, block.height + blockRewardLock, false)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', htrToken, blockReward, blockReward, null, 2)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 2, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', txId1, htrToken, blockReward, block.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 2, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', txId2, htrToken, blockReward, block2.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId2, blockReward, block2.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, blockReward, null, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', 0, walletId, 2)).resolves.toBe(true);
    // addresses other than the used on must have been added to address table
    for (let i = 1; i < maxGap + 1; i++) {
      await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[i], i, walletId, 0)).resolves.toBe(true);
    }
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', null, null, 2)).resolves.toBe(true);
  }
};

/*
 * This tx sends the block output to 2 addresses on the same wallet, so we have 3 used addresses
 */
const checkAfterReceivingTx1 = async (walletStarted = false) => {
  await expect(checkUtxoTable(mysql, 3, txId3, 0, htrToken, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', blockReward - 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 3, txId3, 1, htrToken, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', htrToken, 0, blockReward, null, 3)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', htrToken, blockReward - 5000, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', htrToken, 5000, 0, null, 1)).resolves.toBe(true);
  // 3 new entries must have been address to address_tx_history
  await expect(checkAddressTxHistoryTable(mysql, 5, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', txId3, htrToken, (-1) * blockReward, tx.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 5, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', txId3, htrToken, blockReward - 5000, tx.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 5, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', txId3, htrToken, 5000, tx.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId2, blockReward, block2.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId3, 0, tx.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, blockReward, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', 0, walletId, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', 1, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', 2, walletId, 1)).resolves.toBe(true);
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', null, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', null, null, 1)).resolves.toBe(true);
  }
};

/*
 * This tx sends the 5000 HTR output to 2 addresses, one on the same wallet (1000 HTR, locked) and another that's not (4000 HTR)
 */
const checkAfterReceivingTx2 = async (walletStarted = false) => {
  await expect(checkUtxoTable(mysql, 5, txId3, 0, htrToken, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', blockReward - 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 5, txId4, 0, htrToken, 'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr', 1000, 0, timelock, null, true)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 5, txId4, 1, htrToken, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', 4000, 0, null, null, false)).resolves.toBe(true);
  // we now have 5 addresses total
  await expect(checkAddressBalanceTable(mysql, 5, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', htrToken, 0, blockReward, null, 3)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', htrToken, blockReward - 5000, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', htrToken, 0, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, 'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr', htrToken, 0, 1000, timelock, 1)).resolves.toBe(true);   // locked
  await expect(checkAddressBalanceTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', htrToken, 4000, 0, null, 1)).resolves.toBe(true);
  // 3 new entries must have been address to address_tx_history
  await expect(checkAddressTxHistoryTable(mysql, 8, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', txId4, htrToken, -5000, tx2.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, 'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr', txId4, htrToken, 1000, tx2.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', txId4, htrToken, 4000, tx2.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 4, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 4, walletId, htrToken, txId2, blockReward, block2.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 4, walletId, htrToken, txId3, 0, tx.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 4, walletId, htrToken, txId4, -4000, tx2.timestamp)).resolves.toBe(true);
    await expect(
      checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward - 4000 - 1000, blockReward + 1000, timelock, 4),
    ).resolves.toBe(true);
    // HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr has index 6, so we have 12 addresses from the wallet plus the other one
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', 0, walletId, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', 1, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', 2, walletId, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr', 6, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1)).resolves.toBe(true);
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci', null, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4', null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag', null, null, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr', null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1)).resolves.toBe(true);
  }
};
