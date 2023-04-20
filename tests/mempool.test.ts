import { onHandleOldVoidedTxs } from '@src/mempool';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToAddressTxHistoryTable,
  addToAddressBalanceTable,
  addToTransactionTable,
  addToUtxoTable,
  checkUtxoTable,
  cleanDatabase,
  ADDRESSES,
  TX_IDS,
} from '@tests/utils';
import * as Utils from '@src/utils';
import * as Db from '@src/db';

const mysql = getDbConnection();
const OLD_ENV = process.env;

beforeEach(async () => {
  process.env = { ...OLD_ENV };
  await cleanDatabase(mysql);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

test('onHandleOldVoidedTxs', async () => {
  expect.hasAssertions();

  const transactions = [
    [TX_IDS[0], 1, 2, false, null, 60],
    [TX_IDS[1], 601, 2, false, null, 60],
    [TX_IDS[2], 1000, 2, false, null, 60],
    // This should be our best block:
    [TX_IDS[3], 20 * 60, 0, false, 10, 60],
  ];

  const utxos = [{
    txId: TX_IDS[0],
    index: 0,
    tokenId: '00',
    address: ADDRESSES[0],
    value: 50,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: TX_IDS[1],
    index: 0,
    tokenId: '00',
    address: ADDRESSES[1],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: TX_IDS[2],
    index: 0,
    tokenId: '00',
    address: ADDRESSES[2],
    value: 150,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: TX_IDS[2],
    index: 1,
    tokenId: '00',
    address: ADDRESSES[3],
    value: 200,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  const txHistory = [
    { address: ADDRESSES[0], txId: TX_IDS[0], tokenId: '00', balance: 50, timestamp: 10 },
    { address: ADDRESSES[1], txId: TX_IDS[1], tokenId: '00', balance: 100, timestamp: 10 },
    { address: ADDRESSES[2], txId: TX_IDS[2], tokenId: '00', balance: 150, timestamp: 10 },
    { address: ADDRESSES[3], txId: TX_IDS[2], tokenId: '00', balance: 200, timestamp: 10 },
  ];

  const addressEntries = [
    // address, tokenId, unlocked, locked, lockExpires, transactions, unlocked_authorities, locked_authorities, total_received
    [ADDRESSES[0], '00', 0, 0, null, 1, 0, 0, 100],
    [ADDRESSES[1], '00', 0, 0, null, 1, 0, 0, 200],
    [ADDRESSES[2], '00', 0, 0, null, 1, 0, 0, 300],
    [ADDRESSES[3], '00', 0, 0, null, 1, 0, 0, 400],
  ];

  await addToAddressBalanceTable(mysql, addressEntries);
  await addToAddressTxHistoryTable(mysql, txHistory);
  await addToTransactionTable(mysql, transactions);
  await addToUtxoTable(mysql, utxos);

  const isTxVoidedSpy = jest.spyOn(Utils, 'isTxVoided');

  // and the check on the fullnode
  isTxVoidedSpy.mockReturnValue(Promise.resolve([true, {}]));
  // we also need to mock the offset
  process.env.VOIDED_TX_OFFSET = '10'; // query will be on timestamp < 600

  await onHandleOldVoidedTxs();

  await expect(checkUtxoTable(mysql, 4, TX_IDS[0], 0, '00', ADDRESSES[0], 50, 0, null, null, false, null, true)).resolves.toBe(true);
});

test('onHandleOldVoidedTxs should try to confirm the block by fetching the first_block', async () => {
  expect.hasAssertions();

  const transactions = [
    [TX_IDS[0], 1, 2, false, null, 60],
    // This is the block tx:
    [TX_IDS[3], 15 * 60, 0, false, 10, 60],
  ];

  const utxos = [{
    txId: TX_IDS[0],
    index: 0,
    tokenId: '00',
    address: ADDRESSES[0],
    value: 50,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToTransactionTable(mysql, transactions);
  await addToUtxoTable(mysql, utxos);

  const isTxVoidedSpy = jest.spyOn(Utils, 'isTxVoided');
  const fetchBlockHeightSpy = jest.spyOn(Utils, 'fetchBlockHeight');
  const updateTxSpy = jest.spyOn(Db, 'updateTx');

  // also the fetchBlockHeight that goes to the fullnode
  fetchBlockHeightSpy.mockReturnValue(Promise.resolve([5, {}] as [number, any]));
  // also the check on the fullnode
  isTxVoidedSpy.mockReturnValue(Promise.resolve([false, {
    meta: {
      first_block: TX_IDS[1],
    },
  }]));
  // and finally, the updateTx so we can expect it to be called
  const updateTxMock = updateTxSpy.mockReturnValue(Promise.resolve());

  // we also need to mock the offset
  process.env.VOIDED_TX_OFFSET = '10'; // query will be on timestamp < 5

  await onHandleOldVoidedTxs();
  expect(updateTxMock).toHaveBeenCalledTimes(1);
});
