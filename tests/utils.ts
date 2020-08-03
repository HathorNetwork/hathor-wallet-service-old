import { APIGatewayProxyEvent } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';

import { DbSelectResult, TxInput, TxOutput } from '@src/types';

import { WalletBalanceEntry, AddressTableEntry } from '@tests/types';

// we'll use this xpubkey and corresponding addresses in some tests
export const XPUBKEY = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';

export const ADDRESSES = [
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

export const cleanDatabase = async (mysql: ServerlessMysql): Promise<void> => {
  const TABLES = [
    'address',
    'address_balance',
    'address_tx_history',
    'metadata',
    'token',
    'utxo',
    'wallet',
    'wallet_balance',
    'wallet_tx_history'
  ];

  for (const table of TABLES) {
    await mysql.query(`DELETE FROM ${table}`);
  }
};

export const createOutput = (value: number, address: string, token = '00', timelock: number = null, locked = false, tokenData = 0): TxOutput => (
  {
    value,
    token,
    locked,
    decoded: {
      type: 'P2PKH',
      address,
      timelock,
    },
    token_data: tokenData,
    script: 'dqkUH70YjKeoKdFwMX2TOYvGVbXOrKaIrA==',
    spent_by: null,
  }
);

export const createInput = (value: number, address: string, txId: string, index: number, token = '00', timelock = null, tokenData = 0): TxInput => (
  {
    value,
    token_data: tokenData,
    script: 'dqkUCEboPJo9txn548FA/NLLaMLsfsSIrA==',
    decoded: {
      type: 'P2PKH',
      address,
      timelock,
    },
    token,
    tx_id: txId,
    index,
  }
);

export const checkUtxoTable = async (
  mysql: ServerlessMysql,
  totalResults: number,
  txId?: string,
  index?: number,
  tokenId?: string,
  address?: string,
  value?: number,
  authorities?: number,
  timelock?: number | null,
  heightlock?: number | null,
  locked?: boolean,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query('SELECT * FROM `utxo`');
  if (results.length !== totalResults) {
    return {
      error: 'checkUtxoTable total results',
      expected: totalResults,
      received: results.length,
      results,
    };
  }

  if (totalResults === 0) return true;

  // now fetch the exact entry
  const baseQuery = `
    SELECT *
      FROM \`utxo\`
     WHERE \`tx_id\` = ?
       AND \`index\` = ?
       AND \`token_id\` = ?
       AND \`address\` = ?
       AND \`value\` = ?
       AND \`authorities\` = ?
       AND \`locked\` = ?
       AND \`timelock\``;
  results = await mysql.query(
    `${baseQuery} ${timelock ? '= ?' : 'IS ?'} AND \`heightlock\` ${heightlock ? '= ?' : 'IS ?'}`,
    [txId, index, tokenId, address, value, authorities, locked, timelock, heightlock],
  );
  if (results.length !== 1) {
    return {
      error: 'checkUtxoTable query',
      params: { txId, index, tokenId, address, value, authorities, timelock, heightlock, locked },
      results,
    };
  }
  return true;
};

export const checkAddressTable = async (
  mysql: ServerlessMysql,
  totalResults: number,
  address?: string,
  index?: number | null,
  walletId?: string | null,
  transactions?: number,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query('SELECT * FROM `address`');
  if (results.length !== totalResults) {
    return {
      error: 'checkAddressTable total results',
      expected: totalResults,
      received: results.length,
      results,
    };
  }

  if (totalResults === 0) return true;

  // now fetch the exact entry
  const baseQuery = `
    SELECT *
      FROM \`address\`
     WHERE \`address\` = ?
       AND \`transactions\` = ?
       AND \`index\`
  `;
  const query = `${baseQuery} ${index !== null ? '= ?' : 'IS ?'} AND wallet_id ${walletId ? '= ?' : 'IS ?'}`;
  results = await mysql.query(
    query,
    [address, transactions, index, walletId],
  );
  if (results.length !== 1) {
    return {
      error: 'checkAddressTable query',
      params: { address, transactions, index, walletId },
      results,
    };
  }
  return true;
};

export const checkAddressBalanceTable = async (
  mysql: ServerlessMysql,
  totalResults: number,
  address: string,
  tokenId: string,
  unlocked: number,
  locked: number,
  lockExpires: number | null,
  transactions: number,
  unlockedAuthorities = 0,
  lockedAuthorities = 0,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query(`
    SELECT *
      FROM \`address_balance\`
  `);
  if (results.length !== totalResults) {
    return {
      error: 'checkAddressBalanceTable total results',
      expected: totalResults,
      received: results.length,
      results,
    };
  }

  // now fetch the exact entry
  const baseQuery = `
    SELECT *
      FROM \`address_balance\`
     WHERE \`address\` = ?
       AND \`token_id\` = ?
       AND \`unlocked_balance\` = ?
       AND \`locked_balance\` = ?
       AND \`transactions\` = ?
       AND \`unlocked_authorities\` = ?
       AND \`locked_authorities\` = ?`;

  results = await mysql.query(
    `${baseQuery} AND timelock_expires ${lockExpires === null ? 'IS' : '='} ?`, [
      address,
      tokenId,
      unlocked,
      locked,
      transactions,
      unlockedAuthorities,
      lockedAuthorities,
      lockExpires,
    ],
  );
  if (results.length !== 1) {
    return {
      error: 'checkAddressBalanceTable query',
      params: { address, tokenId, unlocked, locked, lockExpires, transactions, unlockedAuthorities, lockedAuthorities },
      results,
    };
  }
  return true;
};

export const checkAddressTxHistoryTable = async (
  mysql: ServerlessMysql,
  totalResults: number,
  address: string,
  txId: string,
  tokenId: string,
  balance: number,
  timestamp: number,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query('SELECT * FROM `address_tx_history`');
  expect(results).toHaveLength(totalResults);
  if (results.length !== totalResults) {
    return {
      error: 'checkAddressTxHistoryTable total results',
      expected: totalResults,
      received: results.length,
      results,
    };
  }

  // now fetch the exact entry
  results = await mysql.query(
    `SELECT *
       FROM \`address_tx_history\`
      WHERE \`address\` = ?
        AND \`tx_id\` = ?
        AND \`token_id\` = ?
        AND \`balance\` = ?
        AND \`timestamp\` = ?`,
    [
      address,
      txId,
      tokenId,
      balance,
      timestamp,
    ],
  );
  if (results.length !== 1) {
    return {
      error: 'checkAddressTxHistoryTable query',
      params: { address, txId, tokenId, balance, timestamp },
      results,
    };
  }
  return true;
};

export const checkWalletTable = async (mysql: ServerlessMysql,
  totalResults: number,
  id?: string,
  status?: string,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query('SELECT * FROM `wallet`');
  expect(results).toHaveLength(totalResults);
  if (results.length !== totalResults) {
    return {
      error: 'checkWalletTable total results',
      expected: totalResults,
      received: results.length,
      results,
    };
  }

  if (totalResults === 0) return true;

  // now fetch the exact entry
  results = await mysql.query(
    `SELECT *
       FROM \`wallet\`
      WHERE \`id\` = ?
        AND \`status\` = ?`,
    [id, status],
  );
  if (results.length !== 1) {
    return {
      error: 'checkWalletTable query',
      params: { id, status },
      results,
    };
  }
  return true;
};

export const checkWalletTxHistoryTable = async (mysql: ServerlessMysql,
  totalResults: number,
  walletId?: string,
  tokenId?: string,
  txId?: string,
  balance?: number,
  timestamp?: number,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query('SELECT * FROM `wallet_tx_history`');
  expect(results).toHaveLength(totalResults);
  if (results.length !== totalResults) {
    return {
      error: 'checkWalletTxHistoryTable total results',
      expected: totalResults,
      received: results.length,
      results,
    };
  }

  if (totalResults === 0) return true;

  // now fetch the exact entry
  results = await mysql.query(
    `SELECT *
       FROM \`wallet_tx_history\`
      WHERE \`wallet_id\` = ?
        AND \`token_id\` = ?
        AND \`tx_id\` = ?
        AND \`balance\` = ?
        AND \`timestamp\` = ?`,
    [
      walletId,
      tokenId,
      txId,
      balance,
      timestamp,
    ],
  );
  if (results.length !== 1) {
    return {
      error: 'checkWalletTxHistoryTable query',
      params: { walletId, tokenId, txId, balance, timestamp },
      results,
    };
  }
  return true;
};

export const checkWalletBalanceTable = async (
  mysql: ServerlessMysql,
  totalResults: number,
  walletId?: string,
  tokenId?: string,
  unlocked?: number,
  locked?: number,
  lockExpires?: number | null,
  transactions?: number,
  unlockedAuthorities = 0,
  lockedAuthorities = 0,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query(`
    SELECT *
      FROM \`wallet_balance\`
  `);
  expect(results).toHaveLength(totalResults);
  if (results.length !== totalResults) {
    return {
      error: 'checkWalletBalanceTable total results',
      expected: totalResults,
      received: results.length,
      results,
    };
  }

  if (totalResults === 0) return true;

  // now fetch the exact entry
  const baseQuery = `
    SELECT *
      FROM \`wallet_balance\`
     WHERE \`wallet_id\` = ?
       AND \`token_id\` = ?
       AND \`unlocked_balance\` = ?
       AND \`locked_balance\` = ?
       AND \`transactions\` = ?
       AND \`unlocked_authorities\` = ?
       AND \`locked_authorities\` = ?
  `;
  results = await mysql.query(
    `${baseQuery} AND timelock_expires ${lockExpires === null ? 'IS' : '='} ?`,
    [walletId, tokenId, unlocked, locked, transactions, unlockedAuthorities, lockedAuthorities, lockExpires],
  );
  if (results.length !== 1) {
    return {
      error: 'checkWalletBalanceTable query',
      params: { walletId, tokenId, unlocked, locked, lockExpires, transactions, unlockedAuthorities, lockedAuthorities },
      results,
    };
  }
  return true;
};

export const addToUtxoTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(
    `INSERT INTO \`utxo\`(\`tx_id\`, \`index\`,
                          \`token_id\`, \`address\`,
                          \`value\`, \`authorities\`,
                          \`timelock\`, \`heightlock\`,
                          \`locked\`)
     VALUES ?`,
    [entries],
  );
};

export const addToWalletTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(`
    INSERT INTO \`wallet\`(\`id\`, \`xpubkey\`,
                           \`status\`, \`max_gap\`,
                           \`created_at\`, \`ready_at\`)
    VALUES ?`,
  [entries]);
};

export const addToWalletBalanceTable = async (
  mysql: ServerlessMysql,
  entries: WalletBalanceEntry[],
): Promise<void> => {
  const payload = entries.map((entry) => ([
    entry.walletId,
    entry.tokenId,
    entry.unlockedBalance,
    entry.lockedBalance,
    entry.unlockedAuthorities,
    entry.lockedAuthorities,
    entry.timelockExpires,
    entry.transactions,
  ]));

  await mysql.query(`
    INSERT INTO \`wallet_balance\`(\`wallet_id\`, \`token_id\`,
                                   \`unlocked_balance\`, \`locked_balance\`,
                                   \`timelock_expires\`, \`transactions\`)
    VALUES ?`,
  [payload]);
};

export const addToWalletTxHistoryTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(`
    INSERT INTO \`wallet_tx_history\`(\`wallet_id\`, \`tx_id\`,
                                      \`token_id\`, \`balance\`,
                                      \`timestamp\`)
    VALUES ?`,
  [entries]);
};

export const addToAddressTable = async (
  mysql: ServerlessMysql,
  entries: AddressTableEntry[],
): Promise<void> => {
  const payload = entries.map((entry) => ([
    entry.address,
    entry.index,
    entry.walletId,
    entry.transactions,
  ]));

  await mysql.query(`
    INSERT INTO \`address\`(\`address\`, \`index\`,
                            \`wallet_id\`, \`transactions\`)
    VALUES ?`,
  [payload]);
};

export const addToAddressBalanceTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(`
    INSERT INTO \`address_balance\`(\`address\`, \`token_id\`,
                                    \`unlocked_balance\`, \`locked_balance\`,
                                    \`timelock_expires\`, \`transactions\`,
                                    \`unlocked_authorities\`, \`locked_authorities\`)
    VALUES ?`,
  [entries]);
};

export const addToAddressTxHistoryTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(`
    INSERT INTO \`address_tx_history\`(\`address\`, \`tx_id\`,
                                       \`token_id\`, \`balance\`,
                                       \`timestamp\`)
    VALUES ?`,
  [entries]);
};

export const addToTokenTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(
    'INSERT INTO `token`(`id`, `name`, `symbol`) VALUES ?',
    [entries],
  );
};

export const makeGatewayEvent = (queryParams: { [name: string]: string } | null, body = null): APIGatewayProxyEvent => (
  {
    body,
    queryStringParameters: queryParams,
    headers: {},
    multiValueHeaders: {},
    httpMethod: '',
    isBase64Encoded: false,
    path: '',
    pathParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: null,
    resource: null,
  }
);
