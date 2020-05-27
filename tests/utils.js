// we'll use this xpubkey and corresponding addresses in some tests
export const xpubkey = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';

export const addresses = [
  'H7GtjbWcpd8fcE4KV1QJAiLPsXN4KRMasA',
  'H9QwruQByN4qiprTAWAjBR9fDXBadFtou4',
  'HGXziPZxoTK27FuabRQbHMsav2ZBKdNBZK',
  'HQ2PjhE8ocyGgA17mGn8ny913iVpR6FBAm',
  'HKghT5LSxtZHa4Z2VYYBW4WDMnQHSVEBHA',
  'HGx6zgR96ubefHcAGgEv48NJp6ccVxMYJo',
  'HKobFkfTBqRSCHpbL6cydS6geVg44CHrRL',
  'HMmFLoWSagfvSUiEbE2mVDY7BYx1HPdXGf',
  'HQcnzbpCHKqhDm8Hd8mikVyb4oK2qoadPJ',
  'HEfqUBf4Rd4A35uhdtv7fuUtthGtjptYQC',
  'HLUjnbbgxzgDTLAU7TjsTHzuZpeYY2xezw',
  'HBYRWYMpDQzkBPCdAJMix4dGNVi81CC855',
  'HJVq5DKPTeJ73UpuivJURdhfWnTLG7WAjo',
  'HGJFqxUw6ntRxLjcEbvFz9GHsLxHzR9hQs',
  'HPapaHpBZArxt2EK9WUy9HT9H3PgfidBgN',
  'HJdAEBVMKygzntrw7Q3Qr8osLXLGUe8M65',
  'HGgSipJMLrHxGHambXtVc9Y9Lf9hxLxRVk',
  'HGgatY7US4cSPDppzrKUYdp2V1r7LWGyVf',
];

export const cleanDatabase = async (mysql) => {
  const TABLES = ['address', 'address_balance', 'address_tx_history', 'utxo', 'wallet', 'wallet_balance', 'wallet_tx_history'];
  for (const table of TABLES) {
    await mysql.query(`DELETE FROM ${table}`);
  }
};

export const checkUtxoTable = async (mysql, totalResults, txId, index, tokenId, address, value, timelock) => {
  // first check the total number of rows in the table
  let results = await mysql.query('SELECT * FROM `utxo`');
  expect(results.length).toBe(totalResults);

  // now fetch the exact entry
  results = await mysql.query(
    'SELECT * FROM `utxo` WHERE `tx_id` = ? AND `index` = ? AND `token_id` = ? AND `address` = ? AND `value` = ? AND `timelock` ' + (timelock ? '= ?' : 'IS ?'),
    [txId, index, tokenId, address, value, timelock]
  );
  expect(results.length).toBe(1);
};

export const checkAddressTable = async (mysql, totalResults, address, index, walletId, transactions) => {
  // first check the total number of rows in the table
  let results = await mysql.query('SELECT * FROM `address`');
  expect(results.length).toBe(totalResults);

  if (totalResults === 0) return;

  // now fetch the exact entry
  results = await mysql.query(
    'SELECT * FROM `address` WHERE `address` = ? AND `transactions` = ? AND `index` ' + (index !== null ? '= ?' : 'IS ?') + ' AND `wallet_id` ' + (walletId ? '= ?' : 'IS ?'),
    [address, transactions, index, walletId]
  );
  if (results.length !== 1) {
    const error = `checkAddressTable, address = ${address}, index = ${index}, walletId = ${walletId}, transactions = ${transactions}`;
    fail(error);
  }
  //TODO
  //expect(results.length).toBe(1, '***** SOME MESSAGE');
};

export const checkAddressBalanceTable = async (mysql, totalResults, address, tokenId, balance, transactions) => {
  // first check the total number of rows in the table
  let results = await mysql.query('SELECT * FROM `address_balance`');
  expect(results.length).toBe(totalResults);

  // now fetch the exact entry
  results = await mysql.query(
    'SELECT * FROM `address_balance` WHERE `address` = ? AND `token_id` = ? AND `balance` = ? AND `transactions` = ?',
    [address, tokenId, balance, transactions]
  );
  expect(results.length).toBe(1);
};

export const checkAddressTxHistoryTable = async (mysql, totalResults, address, txId, tokenId, balance, timestamp) => {
  // first check the total number of rows in the table
  let results = await mysql.query('SELECT * FROM `address_tx_history`');
  expect(results.length).toBe(totalResults);

  // now fetch the exact entry
  results = await mysql.query(
    'SELECT * FROM `address_tx_history` WHERE `address` = ? AND `tx_id` = ? AND `token_id` = ? AND `balance` = ? AND timestamp = ?',
    [address, txId, tokenId, balance, timestamp]
  );
  expect(results.length).toBe(1);
};

export const checkWalletTable = async (mysql, totalResults, id, status) => {
  // first check the total number of rows in the table
  let results = await mysql.query('SELECT * FROM `wallet`');
  expect(results.length).toBe(totalResults);

  if (totalResults === 0) return;

  // now fetch the exact entry
  results = await mysql.query(
    'SELECT * FROM `wallet` WHERE `id` = ? AND `status` = ?',
    [id, status]
  );
  expect(results.length).toBe(1);
};

export const checkWalletTxHistoryTable = async (mysql, totalResults, walletId, tokenId, txId, balance, timestamp) => {
  // first check the total number of rows in the table
  let results = await mysql.query('SELECT * FROM `wallet_tx_history`');
  expect(results.length).toBe(totalResults);

  if (totalResults === 0) return;

  // now fetch the exact entry
  results = await mysql.query(
    'SELECT * FROM `wallet_tx_history` WHERE `wallet_id` = ? AND `token_id` = ? AND `tx_id` = ? AND `balance` = ? AND `timestamp` = ?',
    [walletId, tokenId, txId, balance, timestamp]
  );
  expect(results.length).toBe(1);
};

export const checkWalletBalanceTable = async (mysql, totalResults, walletId, tokenId, balance, transactions) => {
  // first check the total number of rows in the table
  let results = await mysql.query('SELECT * FROM `wallet_balance`');
  expect(results.length).toBe(totalResults);

  if (totalResults === 0) return;

  // now fetch the exact entry
  results = await mysql.query(
    'SELECT * FROM `wallet_balance` WHERE `wallet_id` = ? AND `token_id` = ? AND `balance` = ? AND `transactions` = ?',
    [walletId, tokenId, balance, transactions]
  );
  expect(results.length).toBe(1);
};

export const createOutput = ({value, address, token = '00', timelock = null, tokenData = 0}) => {
  return {
    'value': value,
    'token_data': tokenData,
    'script': 'dqkUH70YjKeoKdFwMX2TOYvGVbXOrKaIrA==',
    'decoded': {
      'type': 'P2PKH',
      'address': address,
      'timelock': timelock
    },
    'token': token,
    'spent_by': null
  };
}

export const createInput = ({value, address, txId, index, token = '00', timelock = null, tokenData = 0}) => {
  return {
    'value': value,
    'token_data': tokenData,
    'script': 'dqkUCEboPJo9txn548FA/NLLaMLsfsSIrA==',
    'decoded': {
      'type': 'P2PKH',
      'address': address,
      'timelock': timelock
    },
    'token': token,
    'tx_id': txId,
    'index': index
  }
};
