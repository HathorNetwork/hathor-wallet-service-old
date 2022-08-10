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
  ];

  const utxos = [
    [TX_IDS[0], 0, '00', ADDRESSES[0], 50, 0, null, null, false, null],
    [TX_IDS[1], 0, '00', ADDRESSES[1], 100, 0, null, null, false, null],
    [TX_IDS[2], 0, '00', ADDRESSES[2], 150, 0, null, null, false, null],
    [TX_IDS[2], 1, '00', ADDRESSES[3], 200, 0, null, null, false, null],
  ];

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

  const timestampSpy = jest.spyOn(Utils, 'getUnixTimestamp');
  const isTxVoidedSpy = jest.spyOn(Utils, 'isTxVoided');

  // we need to mock current timestamp
  timestampSpy.mockReturnValue(20 * 60);
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
  ];

  const utxos = [
    [TX_IDS[0], 0, '00', ADDRESSES[0], 50, 0, null, null, false, null],
  ];

  await addToTransactionTable(mysql, transactions);
  await addToUtxoTable(mysql, utxos);

  const timestampSpy = jest.spyOn(Utils, 'getUnixTimestamp');
  const isTxVoidedSpy = jest.spyOn(Utils, 'isTxVoided');
  const fetchBlockHeightSpy = jest.spyOn(Utils, 'fetchBlockHeight');
  const updateTxSpy = jest.spyOn(Db, 'updateTx');

  // we need to mock current timestamp
  timestampSpy.mockReturnValue(15 * 60);
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
