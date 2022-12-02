import {
  getTxsFromDBResult,
  getTxFromDBResult,
} from '@src/db/utils';

test('getTxsFromDBResult should transform DB Result to array of Tx', async () => {
  expect.hasAssertions();

  // Simulate Row Data Packets
  const dbResult = [
    {
      tx_id: 'txId10',
      timestamp: 6,
      version: 0,
      voided: 0,
      height: 10,
      weight: 60,
    },
    {
      tx_id: 'txId8',
      timestamp: 4,
      version: 0,
      voided: 0,
      height: 8,
      weight: 60,
    },
    {
      tx_id: 'txId9',
      timestamp: 5,
      version: 0,
      voided: 0,
      height: 9,
      weight: 60,
    },
  ];

  const txs = getTxsFromDBResult(dbResult);

  // txId is an attribute of Tx interface
  expect(txs[0].txId).toBe('txId10');
  expect(txs[1].txId).toBe('txId8');
  expect(txs[2].txId).toBe('txId9');
});

test('getTxFromDBResult should transform DB Result to Tx', async () => {
  expect.hasAssertions();

  // Simulate Row Data Packets
  const dbResult = [
    {
      tx_id: 'txId10',
      timestamp: 6,
      version: 0,
      voided: 0,
      height: 10,
      weight: 60,
    },
  ];

  const tx = getTxFromDBResult(dbResult);

  // txId is an attribute of Tx interface
  expect(tx.txId).toBe('txId10');
});
