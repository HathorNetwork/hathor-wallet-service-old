import { initFirebaseAdminMock } from '@tests/utils/firebase-admin.mock';
import eventTemplate from '@events/eventTemplate.json';
import { loadWallet } from '@src/api/wallet';
import { createWallet, getMinersList } from '@src/db';
import * as txProcessor from '@src/txProcessor';
import { Transaction, WalletStatus, TxInput } from '@src/types';
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
  addToUtxoTable,
} from '@tests/utils';

const mysql = getDbConnection();

initFirebaseAdminMock();
const blockReward = 6400;
const htrToken = '00';
const walletId = getWalletId(XPUBKEY);
const now = getUnixTimestamp();
const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);
const OLD_ENV = process.env;

/*
 * xpubkey first addresses are: [
 *   'HBCQgVR8Xsyv1BLDjf9NJPK1Hwg4rKUh62',
 *   'HPDWdurEygcubNMUUnTDUAzngrSXFaqGQc',
 *   'HEYCNNZZYrimD97AtoRcgcNFzyxtkgtt9Q',
 *   'HPTtSRrDd4ekU4ZQ2jnSLYayL8hiToE5D4',
 *   'HTYymKpjyXnz4ssEAnywtwnXnfneZH1Dbh',
 *   'HUp754aDZ7yKndw2JchXEiMvgzKuXasUmF',
 *   'HLfGaQoxssGbZ4h9wbLyiCafdE8kPm6Fo4',
 *   'HV3ox5B1Dai6Jp5EhV8DvUiucc1z3WJHjL',
 * ]
 */

const blockEvent = JSON.parse(JSON.stringify(eventTemplate));
const block: Transaction = blockEvent.Records[0].body;
const txId1 = 'txId1';
block.tx_id = txId1;
block.timestamp = now;
block.height = 1;
block.outputs = [createOutput(0, blockReward, ADDRESSES[0])];

// receive another block. Reward from first block should now be unlocked
const blockEvent2 = JSON.parse(JSON.stringify(eventTemplate));
const block2: Transaction = blockEvent2.Records[0].body;
const txId2 = 'txId2';
block2.tx_id = txId2;
block2.timestamp = block.timestamp + 30;
block2.height = block.height + 1;
block2.outputs = [createOutput(0, blockReward, ADDRESSES[0])];

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
tx.inputs = [createInput(blockReward, ADDRESSES[0], txId1, 0)];
tx.outputs = [
  createOutput(0, blockReward - 5000, ADDRESSES[1]),
  createOutput(1, 5000, ADDRESSES[2]),
];

// tx sends one of last tx's outputs to 2 addresses, one of which is not from this wallet. Also, output sent to this wallet is locked
const txEvent2 = JSON.parse(JSON.stringify(eventTemplate));
const tx2: Transaction = txEvent2.Records[0].body;
const timelock = now + 90000;
tx2.version = 1;
const txId4 = 'txId4';
tx2.tx_id = txId4;
tx2.timestamp += 20;
tx2.inputs = [
  createInput(5000, ADDRESSES[2], txId2, 1),
];
tx2.outputs = [
  createOutput(0, 1000, ADDRESSES[6], '00', timelock),   // belongs to this wallet
  createOutput(1, 4000, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch'),   // other wallet
];

// tx2Inputs on the format addToUtxoTable expects
const tx2Inputs = tx2.inputs.map((input: TxInput) => ({
  txId: input.tx_id,
  index: input.index,
  tokenId: input.token,
  address: input.decoded.address,
  value: input.value,
  authorities: null,
  timelock: null,
  heightlock: null,
  locked: false,
  spentBy: null,
}));

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

  // txEvent2 uses utxos that are not from the received blocks, so we must add them to the database
  await addToUtxoTable(mysql, tx2Inputs);

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

  // txEvent2 uses utxos that are not from the received blocks, so we must add them to the database
  await addToUtxoTable(mysql, tx2Inputs);

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

  // txEvent2 uses utxos that are not from the received blocks, so we must add them to the database
  await addToUtxoTable(mysql, tx2Inputs);

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

  // txEvent2 uses utxos that are not from the received blocks, so we must add them to the database
  await addToUtxoTable(mysql, tx2Inputs);

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
  await expect(
    checkUtxoTable(mysql, 1, txId1, 0, htrToken, ADDRESSES[0], blockReward, 0, null, block.height + blockRewardLock, true),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, ADDRESSES[0], htrToken, 0, blockReward, null, 1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 1, ADDRESSES[0], txId1, htrToken, blockReward, block.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 1, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, 0, blockReward, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[0], 0, walletId, 1)).resolves.toBe(true);
    // addresses other than the used on must have been added to address table
    for (let i = 1; i < maxGap + 1; i++) {
      await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[i], i, walletId, 0)).resolves.toBe(true);
    }
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 1, ADDRESSES[0], null, null, 1)).resolves.toBe(true);
  }
};

/*
 * After receiving second block, rewards from the first block are unlocked
 */
const checkAfterReceivingSecondBlock = async (walletStarted = false) => {
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);
  await expect(
    checkUtxoTable(mysql, 2, txId2, 0, htrToken, ADDRESSES[0], blockReward, 0, null, block2.height + blockRewardLock, true),
  ).resolves.toBe(true);
  // first block utxo is unlocked
  await expect(
    checkUtxoTable(mysql, 2, txId1, 0, htrToken, ADDRESSES[0], blockReward, 0, null, block.height + blockRewardLock, false),
  ).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, ADDRESSES[0], htrToken, blockReward, blockReward, null, 2)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 2, ADDRESSES[0], txId1, htrToken, blockReward, block.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 2, ADDRESSES[0], txId2, htrToken, blockReward, block2.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId2, blockReward, block2.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, blockReward, null, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[0], 0, walletId, 2)).resolves.toBe(true);
    // addresses other than the used on must have been added to address table
    for (let i = 1; i < maxGap + 1; i++) {
      await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[i], i, walletId, 0)).resolves.toBe(true);
    }
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 1, ADDRESSES[0], null, null, 2)).resolves.toBe(true);
  }
};

/*
 * This tx sends the block output to 2 addresses on the same wallet, so we have 3 used addresses
 */
const checkAfterReceivingTx1 = async (walletStarted = false) => {
  await expect(checkUtxoTable(mysql, 3, txId3, 0, htrToken, ADDRESSES[1], blockReward - 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 3, txId3, 1, htrToken, ADDRESSES[2], 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, ADDRESSES[0], htrToken, 0, blockReward, null, 3)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, ADDRESSES[1], htrToken, blockReward - 5000, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, ADDRESSES[2], htrToken, 5000, 0, null, 1)).resolves.toBe(true);
  // 3 new entries must have been address to address_tx_history
  await expect(checkAddressTxHistoryTable(mysql, 5, ADDRESSES[0], txId3, htrToken, (-1) * blockReward, tx.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 5, ADDRESSES[1], txId3, htrToken, blockReward - 5000, tx.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 5, ADDRESSES[2], txId3, htrToken, 5000, tx.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId2, blockReward, block2.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId3, 0, tx.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, blockReward, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, ADDRESSES[0], 0, walletId, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, ADDRESSES[1], 1, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, ADDRESSES[2], 2, walletId, 1)).resolves.toBe(true);
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, ADDRESSES[0], null, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, ADDRESSES[1], null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, ADDRESSES[2], null, null, 1)).resolves.toBe(true);
  }
};

/*
 * This tx sends the 5000 HTR output to 2 addresses, one on the same wallet (1000 HTR, locked) and another that's not (4000 HTR)
 */
const checkAfterReceivingTx2 = async (walletStarted = false) => {
  await expect(checkUtxoTable(mysql, 5, txId3, 0, htrToken, ADDRESSES[1], blockReward - 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 5, txId4, 0, htrToken, ADDRESSES[6], 1000, 0, timelock, null, true)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 5, txId4, 1, htrToken, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', 4000, 0, null, null, false)).resolves.toBe(true);
  // we now have 5 addresses total
  await expect(checkAddressBalanceTable(mysql, 5, ADDRESSES[0], htrToken, 0, blockReward, null, 3)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, ADDRESSES[1], htrToken, blockReward - 5000, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, ADDRESSES[2], htrToken, 0, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, ADDRESSES[6], htrToken, 0, 1000, timelock, 1)).resolves.toBe(true);   // locked
  await expect(checkAddressBalanceTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', htrToken, 4000, 0, null, 1)).resolves.toBe(true);
  // 3 new entries must have been address to address_tx_history
  await expect(checkAddressTxHistoryTable(mysql, 8, ADDRESSES[2], txId4, htrToken, -5000, tx2.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, ADDRESSES[6], txId4, htrToken, 1000, tx2.timestamp)).resolves.toBe(true);
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
    // HLfGaQoxssGbZ4h9wbLyiCafdE8kPm6Fo4 has index 6, so we have 12 addresses from the wallet plus the other one
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, ADDRESSES[0], 0, walletId, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, ADDRESSES[1], 1, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, ADDRESSES[2], 2, walletId, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, ADDRESSES[6], 6, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1)).resolves.toBe(true);
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, ADDRESSES[0], null, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, ADDRESSES[1], null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, ADDRESSES[2], null, null, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, ADDRESSES[6], null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1)).resolves.toBe(true);
  }
};
