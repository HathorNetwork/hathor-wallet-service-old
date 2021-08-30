import { APIGatewayProxyEvent } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';

import {
  DbSelectResult,
  TxInput,
  TxOutput,
  FullNodeVersionData,
} from '@src/types';

import { WalletBalanceEntry, AddressTableEntry, TokenTableEntry } from '@tests/types';

import { RedisClient } from 'redis';

// we'll use this xpubkey and corresponding addresses in some tests
export const XPUBKEY = 'xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res';

export const TX_IDS = [
  '0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85',
  '000003ae3be32b9df13157a27b77cf8e5fed3c20ad309a843002a10c5430c9cc',
  '000005cbcb8b29f74446a260cd7d36fab3cba1295ac9fe904795d7b064e0e53c',
  '0000000f1fbb4bd8a8e71735af832be210ac9a6c1e2081b21faeea3c0f5797f7',
  '00000649d769de25fcca204faaa23d4974d00fcb01130ab3f736fade4013598d',
  '000002e185a37162bbcb1ec43576056638f0fad43648ae070194d1e1105f339a',
  '00000597288221301f856e245579e7d32cea3e257330f9cb10178bb487b343e5',
];

export const ADDRESSES = [
  'HNwiHGHKBNbeJPo9ToWvFWeNQkJrpicYci',
  'HUxu47MwBYNHG8jWebvzQ2jymV6PcEfWB4',
  'H7ehmrWPqEQWJUqSKAxtQJX99gTPzW3aag',
  'HNgJXBgj8UtZK4GD97yvDZhyjCLFoLBdDf',
  'HGfwgmn86RSQ1gNG6ceiKeiALwL84FuBf8',
  'HPmbgeKJu9DjNsrSHRZe6VEJC9YiLZ8WLx',
  'HGTfVrFshpTD6Dapuq6z9hrRaiwDYxwLcr',
  'H9ke3eZPPWBXCPHemz6ftZHvEHX1KHLTTg',
  'HSrfhXXAz7FxKzbG3VeqLCeUjVcLx3BpFD',
  'HQio5xMencxwWuCnPGEYGfwVunz7BDQoFf',
  'HHVZwDvm7sMXc75foXEceQra1Zbqzp2nHn',
  'HEibGHSs6tFcUbDKLnnY9nSsaaDFsjSg1t',
  'HK2eexidww2LvTF7cbBJZVHQghKc9UXUST',
  'HBh6y1ejjHqfMFxt6VKg8HuE3YGXttWwGh',
  'HHRUPc7H7wSbwwRpsoPP1m3bnBmjc5DNNq',
  'HTYFyEtzE9z4oW42k7DXFVPA6wqwBhKPQZ',
  'HKxw4Am1ecoTbKoVaJNL1xnNxY8dLpPggN',
  'HSUwYnnRYVnm4bLzV5dsBdqoSvZhunxPKr',
];

export const cleanDatabase = async (mysql: ServerlessMysql): Promise<void> => {
  const TABLES = [
    'address',
    'address_balance',
    'address_tx_history',
    'token',
    'tx_proposal',
    'transaction',
    'tx_output',
    'version_data',
    'wallet',
    'wallet_balance',
    'wallet_tx_history',
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
  spentBy?: string | null,
  voided = false,
): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query('SELECT * FROM `tx_output` WHERE spent_by IS NULL');
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
      FROM \`tx_output\`
     WHERE \`tx_id\` = ?
       AND \`index\` = ?
       AND \`token_id\` = ?
       AND \`address\` = ?
       AND \`value\` = ?
       AND \`authorities\` = ?
       AND \`locked\` = ?
       AND \`voided\` = ?
       AND \`timelock\``;
  results = await mysql.query(
    `${baseQuery} ${timelock ? '= ?' : 'IS ?'}
       AND \`heightlock\` ${heightlock ? '= ?' : 'IS ?'}
       AND \`spent_by\` ${spentBy ? '= ?' : 'IS ?'}
    `,
    [txId, index, tokenId, address, value, authorities, locked, voided, timelock, heightlock, spentBy],
  );
  if (results.length !== 1) {
    return {
      error: 'checkUtxoTable query',
      params: { txId, index, tokenId, address, value, authorities, timelock, heightlock, locked, spentBy, voided },
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
  status?: string): Promise<boolean | Record<string, unknown>> => {
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
  timestamp?: number): Promise<boolean | Record<string, unknown>> => {
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

export const countTxOutputTable = async (
  mysql: ServerlessMysql,
): Promise<number> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT COUNT(*) AS count
       FROM \`tx_output\`
      WHERE \`voided\` = FALSE`,
  );

  if (results.length > 0) {
    return results[0].count as number;
  }

  return 0;
};

export const addToTransactionTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(
    `INSERT INTO \`transaction\`(\`tx_id\`, \`timestamp\`,
                          \`version\`, \`voided\`,
                          \`height\`)
     VALUES ?`,
    [entries],
  );
};

export const addToUtxoTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(
    `INSERT INTO \`tx_output\`(\`tx_id\`, \`index\`,
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
                                   \`unlocked_authorities\`, \`locked_authorities\`,
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
                                      \`timestamp\`, \`voided\`)
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
  entries: TokenTableEntry[],
): Promise<void> => {
  const payload = entries.map((entry) => ([
    entry.id,
    entry.name,
    entry.symbol,
  ]));

  await mysql.query(
    'INSERT INTO `token`(`id`, `name`, `symbol`) VALUES ?',
    [payload],
  );
};

export const addToTxProposalTable = async (
  mysql: ServerlessMysql,
  entries: unknown[][],
): Promise<void> => {
  await mysql.query(
    'INSERT INTO tx_proposal (`id`, `wallet_id`, `status`, `created_at`, `updated_at`) VALUES ?',
    [entries],
  );
};

export const makeGatewayEvent = (
  params: { [name: string]: string },
  body = null,
  multiValueQueryStringParameters = null,
): APIGatewayProxyEvent => ({
  body,
  queryStringParameters: params,
  pathParameters: params,
  headers: {},
  multiValueHeaders: {},
  httpMethod: '',
  isBase64Encoded: false,
  path: '',
  multiValueQueryStringParameters,
  stageVariables: null,
  requestContext: null,
  resource: null,
});

/*
 * The views protected by the bearer authorizer may use the `walletIdProxyHandler`
 * function that extracts the walletId from the requestContext and not from parameters.
 */
export const makeGatewayEventWithAuthorizer = (
  walletId: string,
  params: { [name: string]: string },
  body = null,
  multiValueQueryStringParameters: { [name: string]: string[] } = null,
): APIGatewayProxyEvent => ({
  body,
  queryStringParameters: params,
  pathParameters: params,
  headers: {},
  multiValueHeaders: {},
  httpMethod: '',
  isBase64Encoded: false,
  path: '',
  multiValueQueryStringParameters,
  stageVariables: null,
  requestContext: {
    authorizer: { principalId: walletId },
    accountId: '',
    apiId: '',
    httpMethod: '',
    identity: null,
    path: '',
    protocol: '',
    requestId: '',
    requestTimeEpoch: 0,
    resourceId: '',
    resourcePath: '',
    stage: '',
  },
  resource: null,
});

export const addToVersionDataTable = async (mysql: ServerlessMysql, versionData: FullNodeVersionData): Promise<void> => {
  const payload = [[
    1,
    versionData.timestamp,
    versionData.version,
    versionData.network,
    versionData.minWeight,
    versionData.minTxWeight,
    versionData.minTxWeightCoefficient,
    versionData.minTxWeightK,
    versionData.tokenDepositPercentage,
    versionData.rewardSpendMinBlocks,
    versionData.maxNumberInputs,
    versionData.maxNumberOutputs,
  ]];

  await mysql.query(
    `INSERT INTO \`version_data\`(\`id\`, \`timestamp\`,
                          \`version\`, \`network\`,
                          \`min_weight\`, \`min_tx_weight\`,
                          \`min_tx_weight_coefficient\`, \`min_tx_weight_k\`,
                          \`token_deposit_percentage\`, \`reward_spend_min_blocks\`,
                          \`max_number_inputs\`, \`max_number_outputs\`)
     VALUES ?`,
    [payload],
  );
};

export const checkVersionDataTable = async (mysql: ServerlessMysql, versionData: FullNodeVersionData): Promise<boolean | Record<string, unknown>> => {
  // first check the total number of rows in the table
  let results: DbSelectResult = await mysql.query('SELECT * FROM `version_data`');

  if (results.length > 1) {
    return {
      error: 'version_data total results',
      expected: 1,
      received: results.length,
      results,
    };
  }

  // now fetch the exact entry
  const baseQuery = `
    SELECT *
      FROM \`version_data\`
     WHERE \`id\` = 1
  `;

  results = await mysql.query(baseQuery);

  if (results.length !== 1) {
    return {
      error: 'checkVersionDataTable query',
    };
  }

  const dbVersionData: FullNodeVersionData = {
    timestamp: results[0].timestamp as number,
    version: results[0].version as string,
    network: results[0].network as string,
    minWeight: results[0].min_weight as number,
    minTxWeight: results[0].min_tx_weight as number,
    minTxWeightCoefficient: results[0].min_tx_weight_coefficient as number,
    minTxWeightK: results[0].min_tx_weight_k as number,
    tokenDepositPercentage: results[0].token_deposit_percentage as number,
    rewardSpendMinBlocks: results[0].reward_spend_min_blocks as number,
    maxNumberInputs: results[0].max_number_inputs as number,
    maxNumberOutputs: results[0].max_number_outputs as number,
  };

  if (Object.entries(dbVersionData).toString() !== Object.entries(versionData).toString()) {
    return {
      error: 'checkVersionDataTable results don\'t match',
      expected: versionData,
      received: dbVersionData,
    };
  }

  return true;
};

export const redisAddKeys = (
  client: RedisClient,
  keyMapping: Record<string, string>,
): void => {
  const multi = client.multi();
  for (const [k, v] of Object.entries(keyMapping)) {
    multi.set(k, v);
  }
  multi.exec();
};

export const redisCleanup = (
  client: RedisClient,
): void => {
  client.flushdb();
};
