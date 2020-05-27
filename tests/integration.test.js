import * as txProcessor from '../txProcessor';
import { loadWallet } from '../api/wallet';

import eventTemplate from '../events/eventTemplate.json';

import {
  xpubkey,
  addresses,
  cleanDatabase,
  checkAddressTable,
  checkAddressBalanceTable,
  checkAddressTxHistoryTable,
  checkUtxoTable,
  checkWalletBalanceTable,
  checkWalletTable,
  checkWalletTxHistoryTable,
  createOutput,
  createInput
} from './utils';
import { getDbConnection, getWalletId } from '../utils';

const mysql = getDbConnection();


const blockReward = 6400;
const htrToken = '00';
const maxGap = 5;
const walletId = getWalletId(xpubkey);

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
const block = blockEvent.Records[0].body;
const txId1 = 'txId1';
block.tx_id = txId1;
block.outputs = [createOutput({value: blockReward, address: 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA'})];

// tx sends block rewards to 2 addresses on the same wallet
const txEvent = JSON.parse(JSON.stringify(eventTemplate));
const tx = txEvent.Records[0].body;
const txId2 = 'txId2';
tx.tx_id = txId2;
tx.timestamp += 20;
tx.inputs = [createInput({value: blockReward, address: 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId: txId1, index: 0})];
tx.outputs = [
  createOutput({value: blockReward - 5000, address: 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4'}),
  createOutput({value: 5000, address: 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK'}),
];

// tx sends one of last tx's outputs to 2 addresses, one of which is not from this wallet
const txEvent2 = JSON.parse(JSON.stringify(eventTemplate));
const tx2 = txEvent2.Records[0].body;
const txId3 = 'txId3';
tx2.tx_id = txId3;
tx2.timestamp += 20;
tx2.inputs = [createInput({value: 5000, address: 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', txId: txId2, index: 1})];
tx2.outputs = [
  createOutput({value: 1000, address: 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL'}),
  createOutput({value: 4000, address: 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch'}),
];

beforeEach(async () => {
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await mysql.quit();
});


test('receive txs and then start wallet', async () => {
  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingBlock(false);

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
   * load wallet
   */
  await loadWallet({xpubkey, maxGap});
  await checkAfterReceivingTx2(true);
}, 20000);


test('start wallet and then receive transactions', async () => {
  /*
   * load wallet
   */
  await loadWallet({xpubkey, maxGap});

  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingBlock(true);

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
}, 20000);


test('receive block, start wallet and then receive transactions', async () => {
  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingBlock(false);

  /*
   * load wallet
   */
  await loadWallet({xpubkey, maxGap});

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
}, 20000);


test('receive block and tx1, start wallet and then receive tx2', async () => {
  /*
   * receive a block
   */
  await txProcessor.onNewTxEvent(blockEvent);
  await checkAfterReceivingBlock(false);

  /*
   * add transaction that sends block reward to 2 different addresses on same wallet
   */
  await txProcessor.onNewTxEvent(txEvent);
  await checkAfterReceivingTx1(false);

  /*
   * load wallet
   */
  await loadWallet({xpubkey, maxGap});

  /*
   * add transaction that sends block reward to 2 different addresses, one of which is not in this wallet
   */
  await txProcessor.onNewTxEvent(txEvent2);
  await checkAfterReceivingTx2(true);
}, 20000);


/*
 * After receiving the block, we only have 1 used address
 */
const checkAfterReceivingBlock = async (walletStarted = false) => {
  await checkUtxoTable(mysql, 1, txId1, 0, htrToken, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', blockReward, null);
  await checkAddressBalanceTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', htrToken, blockReward, 1);
  await checkAddressTxHistoryTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId1, htrToken, blockReward, block.timestamp);
  if (walletStarted) {
    await checkWalletTable(mysql, 1, walletId, 'ready');
    await checkWalletTxHistoryTable(mysql, 1, walletId, htrToken, txId1, blockReward, block.timestamp);
    await checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, 1);
    await checkAddressTable(mysql, maxGap + 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', 0, walletId, 1);
    // addresses other than the used on must have been added to address table
    for (let i = 1; i < maxGap + 1; i++) {
      await checkAddressTable(mysql, maxGap + 1, addresses[i], i, walletId, 0);
    }
  } else {
    await checkWalletTable(mysql, 0);
    await checkWalletTxHistoryTable(mysql, 0);
    await checkWalletBalanceTable(mysql, 0);
    await checkAddressTable(mysql, 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', null, null, 1);
  }
};

/*
 * This tx sends the block output to 2 addresses on the same wallet, so we have 3 used
 * addresses (the block output address has balance 0)
 */
const checkAfterReceivingTx1 = async (walletStarted = false) => {
  await checkUtxoTable(mysql, 2, txId2, 0, htrToken, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', blockReward - 5000, null);
  await checkUtxoTable(mysql, 2, txId2, 1, htrToken, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', 5000, null);
  await checkAddressBalanceTable(mysql, 3, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', htrToken, 0, 2);
  await checkAddressBalanceTable(mysql, 3, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', htrToken, blockReward - 5000, 1);
  await checkAddressBalanceTable(mysql, 3, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', htrToken, 5000, 1);
  await checkAddressTxHistoryTable(mysql, 4, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId1, htrToken, blockReward, block.timestamp);
  await checkAddressTxHistoryTable(mysql, 4, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', txId2, htrToken, (-1)*blockReward, tx.timestamp);
  await checkAddressTxHistoryTable(mysql, 4, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', txId2, htrToken, blockReward - 5000, tx.timestamp);
  await checkAddressTxHistoryTable(mysql, 4, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', txId2, htrToken, 5000, tx.timestamp);
  if (walletStarted) {
    await checkWalletTable(mysql, 1, walletId, 'ready');
    await checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId1, blockReward, block.timestamp);
    await checkWalletTxHistoryTable(mysql, 2, walletId, htrToken, txId2, 0, tx.timestamp);
    await checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward, 2);
    await checkAddressTable(mysql, maxGap + 3, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', 0, walletId, 2);
    await checkAddressTable(mysql, maxGap + 3, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', 1, walletId, 1);
    await checkAddressTable(mysql, maxGap + 3, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', 2, walletId, 1);
  } else {
    await checkWalletTable(mysql, 0);
    await checkWalletTxHistoryTable(mysql, 0);
    await checkWalletBalanceTable(mysql, 0);
    await checkAddressTable(mysql, 3, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', null, null, 2);
    await checkAddressTable(mysql, 3, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', null, null, 1);
    await checkAddressTable(mysql, 3, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', null, null, 1);
  }
};

/*
 * This tx sends the 5000 HTR output to 2 addresses, one on the same wallet and another that's not
 */
const checkAfterReceivingTx2 = async (walletStarted = false) => {
  await checkUtxoTable(mysql, 3, txId2, 0, htrToken, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', blockReward - 5000, null);
  await checkUtxoTable(mysql, 3, txId3, 0, htrToken, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', 1000, null);
  await checkUtxoTable(mysql, 3, txId3, 1, htrToken, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', 4000, null);
  // we now have 5 addresses total
  await checkAddressBalanceTable(mysql, 5, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', htrToken, 0, 2);
  await checkAddressBalanceTable(mysql, 5, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', htrToken, blockReward - 5000, 1);
  await checkAddressBalanceTable(mysql, 5, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', htrToken, 0, 2);
  await checkAddressBalanceTable(mysql, 5, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', htrToken, 1000, 1);
  await checkAddressBalanceTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', htrToken, 4000, 1);
  // 3 new entries must have been address to address_tx_history
  await checkAddressTxHistoryTable(mysql, 7, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', txId3, htrToken, -5000, tx2.timestamp);
  await checkAddressTxHistoryTable(mysql, 7, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', txId3, htrToken, 1000, tx2.timestamp);
  await checkAddressTxHistoryTable(mysql, 7, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', txId3, htrToken, 4000, tx2.timestamp);
  if (walletStarted) {
    await checkWalletTable(mysql, 1, walletId, 'ready');
    await checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId1, blockReward, block.timestamp);
    await checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId2, 0, tx.timestamp);
    await checkWalletTxHistoryTable(mysql, 3, walletId, htrToken, txId3, -4000, tx2.timestamp);
    await checkWalletBalanceTable(mysql, 1, walletId, htrToken, blockReward - 4000, 3);
    //HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL has index 6, so we have 12 addresses from the wallet plus the other one
    await checkAddressTable(mysql, maxGap + 7 + 1, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', 0, walletId, 2);
    await checkAddressTable(mysql, maxGap + 7 + 1, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', 1, walletId, 1);
    await checkAddressTable(mysql, maxGap + 7 + 1, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', 2, walletId, 2);
    await checkAddressTable(mysql, maxGap + 7 + 1, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', 6, walletId, 1);
    await checkAddressTable(mysql, maxGap + 7 + 1, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1);
  } else {
    await checkWalletTable(mysql, 0);
    await checkWalletTxHistoryTable(mysql, 0);
    await checkWalletBalanceTable(mysql, 0);
    await checkAddressTable(mysql, 5, 'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA', null, null, 2);
    await checkAddressTable(mysql, 5, 'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4', null, null, 1);
    await checkAddressTable(mysql, 5, 'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK', null, null, 2);
    await checkAddressTable(mysql, 5, 'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL', null, null, 1);
    await checkAddressTable(mysql, 5, 'HCuWC2qgNP47BtWtsTM48PokKitVdR6pch', null, null, 1);
  }
};
