import eventTemplate from '@events/eventTemplate.json';
import { createWallet } from '@src/api/wallet';
import { createWallet as dbCreateWallet } from '@src/db';
import * as txProcessor from '@src/txProcessor';
import { Transaction, WalletStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp, getWalletId } from '@src/utils';
import {
  ADDRESSES,
  XPUBKEY,
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
 *   H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA,
 *   H9QwruQByN4qiprTAWAjBR9fDXBadFtou4,
 *   HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK,
 *   HQ2PjhE8ocyGgA17mGn8ny913iVpR6FBAm,
 *   HKghT5LSxtZHa4Z2VYYBW4WDMnQHSVEBHA,
 * ]
 */

const blockEvent = JSON.parse(JSON.stringify(eventTemplate));
const block: Transaction = blockEvent.Records[0].body;
const txId1 = 'txId1';
block.tx_id = txId1;
block.timestamp = now;
block.height = 1;
block.outputs = [createOutput(blockReward, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA')];

// receive another block. Reward from first block should now be unlocked
const blockEvent2 = JSON.parse(JSON.stringify(eventTemplate));
const block2: Transaction = blockEvent2.Records[0].body;
const txId2 = 'txId2';
block2.tx_id = txId2;
block2.timestamp = block.timestamp + 30;
block2.height = block.height + 1;
block2.outputs = [createOutput(blockReward, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA')];

// tx sends first block rewards to 2 addresses on the same wallet
const txEvent = JSON.parse(JSON.stringify(eventTemplate));
const tx: Transaction = txEvent.Records[0].body;
const txId3 = 'txId3';
tx.version = 1;
tx.tx_id = txId3;
tx.timestamp += 20;
tx.inputs = [createInput(blockReward, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId1, 0)];
tx.outputs = [
  createOutput(blockReward - 5000, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4'),
  createOutput(5000, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK'),
];

// tx sends one of last tx's outputs to 2 addresses, one of which is not from this wallet. Also, output sent to this wallet is locked
const txEvent2 = JSON.parse(JSON.stringify(eventTemplate));
const tx2: Transaction = txEvent2.Records[0].body;
const timelock = now + 90000;
tx2.version = 1;
const txId4 = 'txId4';
tx2.tx_id = txId4;
tx2.timestamp += 20;
tx2.inputs = [createInput(5000, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', txId2, 1)];
tx2.outputs = [
  createOutput(1000, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', '00', timelock),   // belongs to this wallet
  createOutput(4000, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch'),   // other wallet
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
  await dbCreateWallet(mysql, walletId, XPUBKEY, maxGap);
  await createWallet({ xpubkey: XPUBKEY, maxGap }, null, null);
  await checkAfterReceivingTx2(true);
}, 30000);

// eslint-disable-next-line jest/prefer-expect-assertions, jest/expect-expect
test('start wallet and then receive blocks and txs', async () => {
  /*
   * create wallet
   */
  await dbCreateWallet(mysql, walletId, XPUBKEY, maxGap);
  await createWallet({ xpubkey: XPUBKEY, maxGap }, null, null);

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
}, 30000);

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
  await dbCreateWallet(mysql, walletId, XPUBKEY, maxGap);
  await createWallet({ xpubkey: XPUBKEY, maxGap }, null, null);

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
  await dbCreateWallet(mysql, walletId, XPUBKEY, maxGap);
  await createWallet({ xpubkey: XPUBKEY, maxGap }, null, null);

  /*
   * add transaction that sends block reward to 2 different addresses, one of which is not in this wallet
   */
  await txProcessor.onNewTxEvent(txEvent2);
  await checkAfterReceivingTx2(true);
}, 35000);

/*
 * After receiving the block, we only have 1 used address and block rewards are locked
 */
const checkAfterReceivingFirstBlock = async (walletStarted = false) => {
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);
  await expect(checkUtxoTable(mysql, 1, txId1, 0, htrToken, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', blockReward, 0, null, block.height + blockRewardLock, true)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', htrToken, 0, blockReward, null, 1)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId1, htrToken, blockReward, block.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 1, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, 0, blockReward, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', 0, walletId, 1)).resolves.toBe(true);
    // addresses other than the used on must have been added to address table
    for (let i = 1; i < maxGap + 1; i++) {
      await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[i], i, walletId, 0)).resolves.toBe(true);
    }
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', null, null, 1)).resolves.toBe(true);
  }
};

/*
 * After receiving second block, rewards from the first block are unlocked
 */
const checkAfterReceivingSecondBlock = async (walletStarted = false) => {
  const blockRewardLock = parseInt(process.env.BLOCK_REWARD_LOCK, 10);
  await expect(checkUtxoTable(mysql, 2, txId2, 0, htrToken, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', blockReward, 0, null, block2.height + blockRewardLock, true)).resolves.toBe(true);
  // first block utxo is unlocked
  await expect(checkUtxoTable(mysql, 2, txId1, 0, htrToken, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', blockReward, 0, null, block.height + blockRewardLock, false)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', htrToken, blockReward, blockReward, null, 2)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 2, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId1, htrToken, blockReward, block.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 2, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId2, htrToken, blockReward, block2.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId2, blockReward, block2.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, blockReward, null, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', 0, walletId, 2)).resolves.toBe(true);
    // addresses other than the used on must have been added to address table
    for (let i = 1; i < maxGap + 1; i++) {
      await expect(checkAddressTable(mysql, maxGap + 1, ADDRESSES[i], i, walletId, 0)).resolves.toBe(true);
    }
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', null, null, 2)).resolves.toBe(true);
  }
};

/*
 * This tx sends the block output to 2 addresses on the same wallet, so we have 3 used addresses
 */
const checkAfterReceivingTx1 = async (walletStarted = false) => {
  await expect(checkUtxoTable(mysql, 3, txId3, 0, htrToken, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', blockReward - 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 3, txId3, 1, htrToken, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', htrToken, 0, blockReward, null, 3)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', htrToken, blockReward - 5000, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 3, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', htrToken, 5000, 0, null, 1)).resolves.toBe(true);
  // 3 new entries must have been address to address_tx_history
  await expect(checkAddressTxHistoryTable(mysql, 5, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId3, htrToken, (-1) * blockReward, tx.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 5, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', txId3, htrToken, blockReward - 5000, tx.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 5, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', txId3, htrToken, 5000, tx.timestamp)).resolves.toBe(true);
  if (walletStarted) {
    await expect(checkWalletTable(mysql, 1, walletId, WalletStatus.READY)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId1, blockReward, block.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId2, blockReward, block2.timestamp)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId3, 0, tx.timestamp)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, blockReward, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', 0, walletId, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', 1, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 3, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', 2, walletId, 1)).resolves.toBe(true);
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', null, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 3, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', null, null, 1)).resolves.toBe(true);
  }
};

/*
 * This tx sends the 5000 HTR output to 2 addresses, one on the same wallet (1000 HTR, locked) and another that's not (4000 HTR)
 */
const checkAfterReceivingTx2 = async (walletStarted = false) => {
  await expect(checkUtxoTable(mysql, 5, txId3, 0, htrToken, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', blockReward - 5000, 0, null, null, false)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 5, txId4, 0, htrToken, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', 1000, 0, timelock, null, true)).resolves.toBe(true);
  await expect(checkUtxoTable(mysql, 5, txId4, 1, htrToken, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', 4000, 0, null, null, false)).resolves.toBe(true);
  // we now have 5 addresses total
  await expect(checkAddressBalanceTable(mysql, 5, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', htrToken, 0, blockReward, null, 3)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', htrToken, blockReward - 5000, 0, null, 1)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', htrToken, 0, 0, null, 2)).resolves.toBe(true);
  await expect(checkAddressBalanceTable(mysql, 5, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', htrToken, 0, 1000, timelock, 1)).resolves.toBe(true);   // locked
  await expect(checkAddressBalanceTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', htrToken, 4000, 0, null, 1)).resolves.toBe(true);
  // 3 new entries must have been address to address_tx_history
  await expect(checkAddressTxHistoryTable(mysql, 8, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', txId4, htrToken, -5000, tx2.timestamp)).resolves.toBe(true);
  await expect(checkAddressTxHistoryTable(mysql, 8, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', txId4, htrToken, 1000, tx2.timestamp)).resolves.toBe(true);
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
    // HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL has index 6, so we have 12 addresses from the wallet plus the other one
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', 0, walletId, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', 1, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', 2, walletId, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', 6, walletId, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, maxGap + 7 + 1, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1)).resolves.toBe(true);
  } else {
    await expect(checkWalletTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletTxHistoryTable(mysql, 0)).resolves.toBe(true);
    await expect(checkWalletBalanceTable(mysql, 0)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', null, null, 3)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', null, null, 2)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', null, null, 1)).resolves.toBe(true);
    await expect(checkAddressTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1)).resolves.toBe(true);
  }
};
