import { onHandleOldVoidedTxs } from '@src/mempool';
import { closeDbConnection, getDbConnection } from '@src/utils';
import {
  addToTransactionTable,
  addToUtxoTable,
  checkUtxoTable,
  cleanDatabase,
  ADDRESSES,
  TX_IDS,
} from '@tests/utils';
import * as Utils from '@src/utils';

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
    [TX_IDS[0], 1, 2, false, null],
    [TX_IDS[1], 5, 2, false, null],
    [TX_IDS[2], 10, 2, false, null],
  ];

  const utxos = [
    [TX_IDS[0], 0, '00', ADDRESSES[0], 50, 0, null, null, false],
    [TX_IDS[1], 0, '00', ADDRESSES[1], 100, 0, null, null, false],
    [TX_IDS[2], 0, '00', ADDRESSES[2], 150, 0, null, null, false],
    [TX_IDS[2], 1, '00', ADDRESSES[3], 200, 0, null, null, false],
  ];

  await addToTransactionTable(mysql, transactions);
  await addToUtxoTable(mysql, utxos);

  const timestampSpy = jest.spyOn(Utils, 'getUnixTimestamp');
  const isTxVoidedSpy = jest.spyOn(Utils, 'isTxVoided');

  // we need to mock current timestamp
  timestampSpy.mockReturnValue(15);
  // and the check on the fullnode
  isTxVoidedSpy.mockReturnValue(Promise.resolve(true));
  // we also need to mock the offset
  process.env.VOIDED_TX_OFFSET = '10'; // query will be on timestamp < 5

  await onHandleOldVoidedTxs();

  await expect(checkUtxoTable(mysql, 4, TX_IDS[0], 0, '00', ADDRESSES[0], 50, 0, null, null, false, null, true)).resolves.toBe(true);
});

test('onHandleOldVoidedTxs should fail if the transaction is not voided on the fullnode', async () => {
  expect.hasAssertions();

  const transactions = [
    [TX_IDS[0], 1, 2, false, null],
  ];

  const utxos = [
    [TX_IDS[0], 0, '00', ADDRESSES[0], 50, 0, null, null, false],
  ];

  await addToTransactionTable(mysql, transactions);
  await addToUtxoTable(mysql, utxos);

  const timestampSpy = jest.spyOn(Utils, 'getUnixTimestamp');
  const isTxVoidedSpy = jest.spyOn(Utils, 'isTxVoided');

  // we need to mock current timestamp
  timestampSpy.mockReturnValue(15);
  // and the check on the fullnode
  isTxVoidedSpy.mockReturnValue(Promise.resolve(false));
  // we also need to mock the offset
  process.env.VOIDED_TX_OFFSET = '10'; // query will be on timestamp < 5

  await expect(onHandleOldVoidedTxs()).rejects.toThrow(`Transaction ${TX_IDS[0]} not voided`);
});
