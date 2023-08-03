/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { strict as assert } from 'assert';
import { ServerlessMysql } from 'serverless-mysql';
import { get } from 'lodash';
import { OkPacket } from 'mysql';
import { constants } from '@hathor/wallet-lib';
import {
  AddressIndexMap,
  AddressInfo,
  Authorities,
  Balance,
  DbSelectResult,
  GenerateAddresses,
  IWalletInput,
  ShortAddressInfo,
  StringMap,
  TokenBalanceMap,
  TokenInfo,
  TxInput,
  TxOutputWithIndex,
  TxProposal,
  TxProposalStatus,
  TxTokenBalance,
  DbTxOutput,
  Wallet,
  WalletStatus,
  WalletTokenBalance,
  FullNodeVersionData,
  Block,
  Tx,
  AddressBalance,
  AddressTotalBalance,
  IFilterTxOutput,
  Miner,
  PushDevice,
  TxByIdToken,
  PushDeviceSettings,
  Severity,
} from '@src/types';
import {
  getUnixTimestamp,
  isAuthority,
  getAddressPath,
  xpubDeriveChild,
  getAddresses,
} from '@src/utils';
import {
  getWalletFromDbEntry,
  getTxsFromDBResult,
} from '@src/db/utils';
import { addAlert } from '@src/utils/alerting.utils';

const BLOCK_VERSION = [
  constants.BLOCK_VERSION,
  constants.MERGED_MINED_BLOCK_VERSION,
];
const BURN_ADDRESS = 'HDeadDeadDeadDeadDeadDeadDeagTPgmn';

/**
 * Checks if a transaction was on the database in the past and got voided.
 *
 * @remarks
 * Since we delete transactions from the transactions table when it's voided,
 * we can use the address_tx_history table (which stores voided txs) to check
 * if it's there.
 *
 * @param mysql - Database connection
 * @param txId - The transaction id to search for
 * @returns True or False
 */
export const checkTxWasVoided = async (mysql: ServerlessMysql, txId: string): Promise<boolean> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT * FROM \`address_tx_history\`
      WHERE tx_id = ?
      LIMIT 1`,
    [txId],
  );

  if (!results.length) {
    return false;
  }

  const addressTxHistory = results[0];

  return Boolean(addressTxHistory.voided);
};

/**
 * Cleanup all records from a transaction that was voided in the past
 *
 * @remarks
 * This does not re-calculates balances, so it's only supposed to be used to clear
 * the tx_output, address_tx_history and wallet_tx_history tables after the
 * handleReorg method voided this transaction
 *
 * @param mysql - Database connection
 * @param txId - The transaction to clear from database
 */
export const cleanupVoidedTx = async (mysql: ServerlessMysql, txId: string): Promise<void> => {
  await mysql.query(
    `DELETE FROM \`transaction\`
      WHERE tx_id = ?
        AND voided = true`,
    [txId],
  );

  await mysql.query(
    `DELETE FROM \`tx_output\`
      WHERE tx_id = ?
        AND voided = true`,
    [txId],
  );

  await mysql.query(
    `DELETE FROM \`address_tx_history\`
      WHERE tx_id = ?
        AND voided = true`,
    [txId],
  );

  await mysql.query(
    `DELETE FROM \`wallet_tx_history\`
      WHERE tx_id = ?
        AND voided = true`,
    [txId],
  );
};

/**
 * Given an xpubkey, generate its addresses.
 *
 * @remarks
 * Also, check which addresses are used, taking into account the maximum gap of unused addresses (maxGap).
 * This function doesn't update anything on the database, just reads data from it.
 *
 * @param mysql - Database connection
 * @param xpubkey - The xpubkey
 * @param maxGap - Number of addresses that should have no transactions before we consider all addresses loaded
 * @returns Object with all addresses for the given xpubkey and corresponding index
 */
export const generateAddresses = async (mysql: ServerlessMysql, xpubkey: string, maxGap: number): Promise<GenerateAddresses> => {
  const existingAddresses: AddressIndexMap = {};
  const newAddresses: AddressIndexMap = {};
  const allAddresses: string[] = [];

  // We currently generate only addresses in change derivation path 0
  // (more details in https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#Change)
  // so we derive our xpub to this path and use it to get the addresses
  const derivedXpub = xpubDeriveChild(xpubkey, 0);

  let highestCheckedIndex = -1;
  let lastUsedAddressIndex = -1;
  do {
    const addrMap = getAddresses(derivedXpub, highestCheckedIndex + 1, maxGap);
    allAddresses.push(...Object.keys(addrMap));

    const results: DbSelectResult = await mysql.query(
      `SELECT \`address\`,
              \`index\`,
              \`transactions\`
         FROM \`address\`
        WHERE \`address\`
           IN (?)`,
      [Object.keys(addrMap)],
    );

    for (const entry of results) {
      const address = entry.address as string;
      // get index from addrMap as the one from entry might be null
      const index = addrMap[address];
      // add to existingAddresses
      existingAddresses[address] = index;

      // if address is used, check if its index is higher than the current highest used index
      if (entry.transactions > 0 && index > lastUsedAddressIndex) {
        lastUsedAddressIndex = index;
      }

      delete addrMap[address];
    }

    highestCheckedIndex += maxGap;
    Object.assign(newAddresses, addrMap);
  } while (lastUsedAddressIndex + maxGap > highestCheckedIndex);

  // we probably generated more addresses than needed, as we always generate
  // addresses in maxGap blocks
  const totalAddresses = lastUsedAddressIndex + maxGap + 1;
  for (const [address, index] of Object.entries(newAddresses)) {
    if (index > lastUsedAddressIndex + maxGap) {
      delete newAddresses[address];
    }
  }

  return {
    addresses: allAddresses.slice(0, totalAddresses),
    newAddresses,
    existingAddresses,
    lastUsedAddressIndex,
  };
};

/**
 * Get wallet information for the given addresses.
 *
 * @remarks
 * For each address in the list, check if it's from a started wallet and return its information. If
 * address is not from a started wallet, it won't be on the final map.
 *
 * @param mysql - Database connection
 * @param addresses - Addresses to fetch wallet information
 * @returns A map of address and corresponding wallet information
 */
export const getAddressWalletInfo = async (mysql: ServerlessMysql, addresses: string[]): Promise<StringMap<Wallet>> => {
  const addressWalletMap: StringMap<Wallet> = {};
  const results: DbSelectResult = await mysql.query(
    `SELECT DISTINCT a.\`address\`,
                     a.\`wallet_id\`,
                     w.\`auth_xpubkey\`,
                     w.\`xpubkey\`,
                     w.\`max_gap\`
       FROM \`address\` a
 INNER JOIN \`wallet\` w
         ON a.wallet_id = w.id
      WHERE a.\`address\`
         IN (?)`,
    [addresses],
  );
  for (const entry of results) {
    const walletInfo: Wallet = {
      walletId: entry.wallet_id as string,
      authXpubkey: entry.auth_xpubkey as string,
      xpubkey: entry.xpubkey as string,
      maxGap: entry.max_gap as number,
    };
    addressWalletMap[entry.address as string] = walletInfo;
  }
  return addressWalletMap;
};

/**
 * Get the wallet information.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @returns The wallet information or null if it was not found
 */
export const getWallet = async (mysql: ServerlessMysql, walletId: string): Promise<Wallet> => {
  const results: DbSelectResult = await mysql.query('SELECT * FROM `wallet` WHERE `id` = ?', walletId);
  if (results.length) {
    const result = results[0];
    return getWalletFromDbEntry(result);
  }
  return null;
};

/**
 * Create a wallet on database.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param xpubkey - The wallet's xpubkey
 * @param maxGap - Maximum gap of addresses for this wallet
 * @returns The wallet information
 */
export const createWallet = async (
  mysql: ServerlessMysql,
  walletId: string,
  xpubkey: string,
  authXpubkey: string,
  maxGap: number,
): Promise<Wallet> => {
  const ts = getUnixTimestamp();
  const entry = {
    id: walletId,
    xpubkey,
    auth_xpubkey: authXpubkey,
    status: WalletStatus.CREATING,
    created_at: ts,
    max_gap: maxGap,
  };
  await mysql.query(
    `INSERT INTO \`wallet\`
        SET ?`,
    [entry],
  );
  return {
    walletId,
    xpubkey,
    authXpubkey,
    maxGap,
    retryCount: 0,
    status: WalletStatus.CREATING,
    createdAt: ts,
    readyAt: null,
  };
};

/**
 * Update an existing wallet's status.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param status - The new wallet status
 */
export const updateWalletStatus = async (
  mysql: ServerlessMysql,
  walletId: string,
  status: WalletStatus,
  retryCount = 0,
): Promise<void> => {
  const ts = getUnixTimestamp();
  await mysql.query(
    `UPDATE \`wallet\`
        SET \`status\` = ?,
            \`ready_at\` = ?,
            \`retry_count\` = ?
      WHERE \`id\` = ?`,
    [status, ts, retryCount, walletId],
  );
};

/**
 * Update an existing wallet's auth_xpubkey
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param authXpubkey - The new wallet auth_xpubkey
 */
export const updateWalletAuthXpub = async (
  mysql: ServerlessMysql,
  walletId: string,
  authXpubkey: string,
): Promise<void> => {
  await mysql.query(
    `UPDATE \`wallet\`
        SET \`auth_xpubkey\` = ?
      WHERE \`id\` = ?`,
    [authXpubkey, walletId],
  );
};

/**
 * Add addresses to address table.
 *
 * @remarks
 * The addresses are added with the given walletId and 0 transactions.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param addresses - A map of addresses and corresponding indexes
 */
export const addNewAddresses = async (
  mysql: ServerlessMysql,
  walletId: string,
  addresses: AddressIndexMap,
  lastUsedAddressIndex: number,
): Promise<void> => {
  if (Object.keys(addresses).length === 0) return;
  const entries = [];
  for (const [address, index] of Object.entries(addresses)) {
    entries.push([address, index, walletId, 0]);
  }
  await mysql.query(
    `INSERT INTO \`address\`(\`address\`, \`index\`,
                             \`wallet_id\`, \`transactions\`)
     VALUES ?`,
    [entries],
  );

  // Store on the wallet table the highest used index
  await mysql.query(
    `UPDATE \`wallet\`
        SET \`last_used_address_index\` = ?
      WHERE \`id\` = ?`,
    [lastUsedAddressIndex, walletId],
  );
};

/**
 * Update addresses on the address table.
 *
 * @remarks
 * It updates both the walletId and index of given addresses.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param addresses - A map of addresses and corresponding indexes
 */
export const updateExistingAddresses = async (mysql: ServerlessMysql, walletId: string, addresses: AddressIndexMap): Promise<void> => {
  if (Object.keys(addresses).length === 0) return;

  for (const [address, index] of Object.entries(addresses)) {
    await mysql.query(
      `UPDATE \`address\`
          SET \`wallet_id\` = ?,
              \`index\` = ?
        WHERE \`address\` = ?`,
      [walletId, index, address],
    );
  }
};

/**
 * Get a wallet's address detail.
 *
 * @param mysql - Database connection
 * @param walletId - Wallet id
 * @param address - Address to get the detail
 * @returns The details of the address {address, index, transactions} or null if not found
 */
export const getWalletAddressDetail = async (mysql: ServerlessMysql, walletId: string, address: string): Promise<AddressInfo | null> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT *
      FROM \`address\`
     WHERE \`wallet_id\` = ?
         AND \`address\` = ?`,
  [walletId, address]);

  if (results.length > 0) {
    const data = results[0];

    const addressDetail: AddressInfo = {
      address: data.address as string,
      index: data.index as number,
      transactions: data.transactions as number,
    };

    return addressDetail;
  }

  return null;
};

/**
 * Initialize a wallet's transaction history.
 *
 * @remarks
 * This function adds entries to wallet_tx_history table, using data from address_tx_history.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param addresses - The addresses that belong to this wallet
 */
export const initWalletTxHistory = async (mysql: ServerlessMysql, walletId: string, addresses: string[]): Promise<void> => {
  // XXX we could also get the addresses from the address table, but the caller probably has this info already

  if (addresses.length === 0) return;

  const results: DbSelectResult = await mysql.query(
    `SELECT \`tx_id\`,
            \`token_id\`,
            SUM(\`balance\`) AS balance,
            \`timestamp\`
       FROM \`address_tx_history\`
      WHERE \`address\` IN (?)
        AND \`voided\` = FALSE
   GROUP BY \`tx_id\`,
            \`token_id\`,
            \`timestamp\``,
    [addresses],
  );
  if (results.length === 0) return;

  const walletTxHistory = [];
  for (const row of results) {
    walletTxHistory.push([walletId, row.token_id, row.tx_id, row.balance, row.timestamp]);
  }
  await mysql.query(
    `INSERT INTO \`wallet_tx_history\`(\`wallet_id\`, \`token_id\`,
                                       \`tx_id\`, \`balance\`,
                                       \`timestamp\`)
          VALUES ?`,
    [walletTxHistory],
  );
};

/**
 * Initialize a wallet's balance.
 *
 * @remarks
 * This function adds entries to wallet_balance table, using data from address_balance and address_tx_history.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param addresses - The addresses that belong to this wallet
 */
export const initWalletBalance = async (mysql: ServerlessMysql, walletId: string, addresses: string[]): Promise<void> => {
  // XXX we could also do a join between address and address_balance tables so we don't
  // need to receive the addresses, but the caller probably has this info already
  const results1: DbSelectResult = await mysql.query(
    `SELECT \`token_id\`,
            SUM(\`total_received\`) AS \`total_received\`,
            SUM(\`unlocked_balance\`) AS \`unlocked_balance\`,
            SUM(\`locked_balance\`) AS \`locked_balance\`,
            MIN(\`timelock_expires\`) AS \`timelock_expires\`
       FROM \`address_balance\`
      WHERE \`address\`
         IN (?)
   GROUP BY \`token_id\`
   ORDER BY \`token_id\``,
    [addresses],
  );
  // we need to use table address_tx_history for the transaction count. We can't simply
  // sum the transaction count for each address_balance, as they may share transactions
  const results2: DbSelectResult = await mysql.query(
    `SELECT \`token_id\`,
            SUM(\`balance\`) AS \`balance\`,
            COUNT(DISTINCT \`tx_id\`) AS \`transactions\`
       FROM \`address_tx_history\`
      WHERE \`address\` IN (?)
        AND \`voided\` = FALSE
   GROUP BY \`token_id\`
   ORDER BY \`token_id\``,
    [addresses],
  );

  assert.strictEqual(results1.length, results2.length);

  const balanceEntries = [];
  for (let i = 0; i < results1.length; i++) {
    // as both queries had ORDER BY, we should get the results in the same order
    const row1 = results1[i];
    const row2 = results2[i];
    assert.strictEqual(row1.token_id, row2.token_id);
    assert.strictEqual(<number>row1.unlocked_balance + <number>row1.locked_balance, row2.balance);
    balanceEntries.push([
      walletId,
      row1.token_id,
      row1.total_received,
      row1.unlocked_balance,
      row1.locked_balance,
      row1.timelock_expires,
      row2.transactions,
    ]);
  }
  if (balanceEntries.length > 0) {
    await mysql.query(
      `INSERT INTO \`wallet_balance\`(\`wallet_id\`, \`token_id\`,
                                      \`total_received\`,
                                      \`unlocked_balance\`, \`locked_balance\`,
                                      \`timelock_expires\`, \`transactions\`)
            VALUES ?`,
      [balanceEntries],
    );
  }
};

/**
 * Update a wallet's balance and tx history with a new transaction.
 *
 * @remarks
 * When a new transaction arrives, it can change the balance and tx history for the wallets. This function
 * updates the wallet_balance and wallet_tx_history tables with information from this transaction.
 *
 * @param mysql - Database connection
 * @param txId - Transaction id
 * @param timestamp - Transaction timestamp
 * @param walletBalanceMap - Map with the transaction's balance for each wallet (by walletId)
 */
export const updateWalletTablesWithTx = async (
  mysql: ServerlessMysql,
  txId: string,
  timestamp: number,
  walletBalanceMap: StringMap<TokenBalanceMap>,
): Promise<void> => {
  const entries = [];
  for (const [walletId, tokenBalanceMap] of Object.entries(walletBalanceMap)) {
    for (const [token, tokenBalance] of tokenBalanceMap.iterator()) {
      // on wallet_balance table, balance cannot be negative (it's unsigned). That's why we use balance
      // as (tokenBalance < 0 ? 0 : tokenBalance). In case the wallet's balance in this tx is negative,
      // there must necessarily be an entry already and we'll fall on the ON DUPLICATE KEY case, so the
      // entry value won't be used. We'll just update balance = balance + tokenBalance
      const entry = {
        wallet_id: walletId,
        token_id: token,
        // totalAmountSent is the sum of the value of all outputs of this token on the tx being sent to this address
        // which means it is the "total_received" for this wallet
        total_received: tokenBalance.totalAmountSent,
        unlocked_balance: (tokenBalance.unlockedAmount < 0 ? 0 : tokenBalance.unlockedAmount),
        locked_balance: tokenBalance.lockedAmount,
        unlocked_authorities: tokenBalance.unlockedAuthorities.toUnsignedInteger(),
        locked_authorities: tokenBalance.lockedAuthorities.toUnsignedInteger(),
        timelock_expires: tokenBalance.lockExpires,
        transactions: 1,
      };

      // save the smaller value of timelock_expires, when not null
      await mysql.query(
        `INSERT INTO wallet_balance
            SET ?
             ON DUPLICATE KEY
         UPDATE total_received = total_received + ?,
                unlocked_balance = unlocked_balance + ?,
                locked_balance = locked_balance + ?,
                transactions = transactions + 1,
                timelock_expires = CASE WHEN timelock_expires IS NULL THEN VALUES(timelock_expires)
                                        WHEN VALUES(timelock_expires) IS NULL THEN timelock_expires
                                        ELSE LEAST(timelock_expires, VALUES(timelock_expires))
                                   END,
                unlocked_authorities = (unlocked_authorities | VALUES(unlocked_authorities)),
                locked_authorities = locked_authorities | VALUES(locked_authorities)`,
        [entry, tokenBalance.totalAmountSent, tokenBalance.unlockedAmount, tokenBalance.lockedAmount, walletId, token],
      );

      // same logic here as in the updateAddressTablesWithTx function
      if (tokenBalance.unlockedAuthorities.hasNegativeValue()) {
        // If we got here, it means that we spent an authority, so we need to update the table to refresh the current
        // value.
        // To do that, we get all unlocked_authorities from all addresses (querying by wallet and token_id) and
        // bitwise OR them with each other.
        await mysql.query(
          `UPDATE \`wallet_balance\`
              SET \`unlocked_authorities\` = (
                SELECT BIT_OR(\`unlocked_authorities\`)
                  FROM \`address_balance\`
                 WHERE \`address\` IN (
                   SELECT \`address\`
                     FROM \`address\`
                    WHERE \`wallet_id\` = ?)
                   AND \`token_id\` = ?)
            WHERE \`wallet_id\` = ?
              AND \`token_id\` = ?`,
          [walletId, token, walletId, token],
        );
      }

      entries.push([walletId, token, txId, tokenBalance.total(), timestamp]);
    }
  }

  if (entries.length > 0) {
    await mysql.query(
      `INSERT INTO \`wallet_tx_history\` (\`wallet_id\`, \`token_id\`,
                                          \`tx_id\`, \`balance\`,
                                          \`timestamp\`)
            VALUES ?`,
      [entries],
    );
  }
};

/**
 * Add a tx outputs to the utxo table.
 *
 * @remarks
 * This function receives a list of outputs and supposes they're all from the same block
 * or transaction. So if heighlock is set, it'll be set to all outputs.
 *
 * @param mysql - Database connection
 * @param txId - Transaction id
 * @param outputs - The transaction outputs
 * @param heightlock - Block heightlock
 */
export const addUtxos = async (
  mysql: ServerlessMysql,
  txId: string,
  outputs: TxOutputWithIndex[],
  heightlock: number = null,
): Promise<void> => {
  // outputs might be empty if we're destroying authorities
  if (outputs.length === 0) return;

  const entries = outputs.map(
    (output) => {
      let authorities = 0;
      let value = output.value;

      if (isAuthority(output.token_data)) {
        authorities = value;
        value = 0;
      }

      return [
        txId,
        output.index,
        output.token,
        value,
        authorities,
        output.decoded.address,
        output.decoded.timelock,
        heightlock,
        output.locked,
      ];
    },
  );

  // we are safe to ignore duplicates because our transaction might have already been in the mempool
  await mysql.query(
    `INSERT INTO \`tx_output\` (\`tx_id\`, \`index\`, \`token_id\`,
                           \`value\`, \`authorities\`, \`address\`,
                           \`timelock\`, \`heightlock\`, \`locked\`)
     VALUES ?
     ON DUPLICATE KEY UPDATE tx_id=tx_id`,
    [entries],
  );
};

/**
 * Alias for addOrUpdateTx
 *
 * @remarks
 * This method is simply an alias for addOrUpdateTx in the current implementation.
 *
 * @param mysql - Database connection
 * @param txId - Transaction id
 * @param timestamp - The transaction timestamp
 * @param version - The transaction version
 * @param weight - The transaction weight
 */
export const updateTx = async (
  mysql: ServerlessMysql,
  txId: string,
  height: number,
  timestamp: number,
  version: number,
  weight: number,
): Promise<void> => addOrUpdateTx(mysql, txId, height, timestamp, version, weight);

/**
 * Add a tx to the transaction table.
 *
 * @remarks
 * This method adds a transaction to the transaction table
 *
 * @param mysql - Database connection
 * @param txId - Transaction id
 * @param timestamp - The transaction timestamp
 * @param version - The transaction version
 * @param weight - the transaction weight
 */
export const addOrUpdateTx = async (
  mysql: ServerlessMysql,
  txId: string,
  height: number,
  timestamp: number,
  version: number,
  weight: number,
): Promise<void> => {
  const entries = [[txId, height, timestamp, version, weight]];

  await mysql.query(
    `INSERT INTO \`transaction\` (tx_id, height, timestamp, version, weight)
     VALUES ?
         ON DUPLICATE KEY UPDATE height = ?`,
    [entries, height],
  );
};

/**
 * Remove a tx inputs from the utxo table.
 *
 * @param mysql - Database connection
 * @param inputs - The transaction inputs
 * @param txId - The transaction that spent these utxos
 */
export const updateTxOutputSpentBy = async (mysql: ServerlessMysql, inputs: TxInput[], txId: string): Promise<void> => {
  const entries = inputs.map((input) => [input.tx_id, input.index]);
  // entries might be empty if there are no inputs
  if (entries.length) {
    // get the rows before deleting

    /* We are forcing this query to use the PRIMARY index because MySQL is not using the index when there is
     * more than 185 elements in the IN query. I couldn't find a reason for that. Here is the EXPLAIN with exactly 185
     * elements:
     * +----+-------------+-----------+------------+-------+---------------+---------+---------+-------------+------+
     * | id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref         | rows |
     * +----+-------------+-----------+------------+-------+---------------+---------+---------+-------------+------+
     * |  1 | UPDATE      | tx_output | NULL       | range | PRIMARY       | PRIMARY | 259     | const,const |  250 |
     * +----+-------------+-----------+------------+-------+---------------+---------+---------+-------------+------+
     *
     * And here is the EXPLAIN query with exactly 186 elements:
     * +----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+
     * | id | select_type | table     | partitions | type  | possible_keys | key     | key_len | ref  | rows    |
     * +----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+
     * |  1 | UPDATE      | tx_output | NULL       | index | NULL          | PRIMARY | 259     | NULL | 1933979 |
     * +----+-------------+-----------+------------+-------+---------------+---------+---------+------+---------+
     */
    const result: OkPacket = await mysql.query(
      `UPDATE \`tx_output\` USE INDEX (PRIMARY)
          SET \`spent_by\` = ?
        WHERE (\`tx_id\` ,\`index\`)
           IN (?)`,
      [txId, entries],
    );

    assert.strictEqual(
      result.affectedRows,
      inputs.length,
      new Error('Not all informed UTXOs had their spentBy updated'),
    );
  }
};

/**
 * Get the requested tx output.
 *
 * @param mysql - Database connection
 * @param txId - The tx id to search
 * @param index - The index to search
 * @param skipSpent - Skip spent tx_output (if we want only utxos)
 * @returns The requested tx_output or null if it is not found
 */
export const getTxOutput = async (
  mysql: ServerlessMysql,
  txId: string,
  index: number,
  skipSpent: boolean,
): Promise<DbTxOutput | null> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\`
      WHERE \`tx_id\` = ?
        AND \`index\` = ?
        ${skipSpent ? 'AND `spent_by` IS NULL' : ''}
        AND \`voided\` = FALSE`,
    [txId, index],
  );

  if (!results.length || results.length === 0) {
    return null;
  }

  const result = results[0];

  const txOutput: DbTxOutput = mapDbResultToDbTxOutput(result);

  return txOutput;
};

/**
 * Get a random valid authority UTXO for a given token
 *
 * @param mysql - Database connection
 * @param tokenId - The token id to search authorities for
 * @param authority - The authority to search for, can be one of (TOKEN_MINT_MASK, TOKEN_MELT_MASK)
 *
 * @returns The requested UTXO
 */
export const getAuthorityUtxo = async (
  mysql: ServerlessMysql,
  tokenId: string,
  authority: number,
): Promise<DbTxOutput | null> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\`
      WHERE \`authorities\` = ?
        AND \`spent_by\` IS NULL
        AND \`voided\` = FALSE
        AND \`token_id\` = ?
      LIMIT 1`,
    [authority, tokenId],
  );

  if (!results.length || results.length === 0) {
    return null;
  }

  const result = results[0];
  const utxo: DbTxOutput = mapDbResultToDbTxOutput(result);

  return utxo;
};

/**
 * Get the requested UTXOs.
 *
 * @param mysql - Database connection
 * @param utxosKeys - Information about the queried UTXOs, including tx_id and index
 * @returns A list of UTXOs with all their properties
 */
export const getUtxos = async (
  mysql: ServerlessMysql,
  utxosInfo: IWalletInput[],
): Promise<DbTxOutput[]> => {
  const entries = utxosInfo.map((utxo) => [utxo.txId, utxo.index]);
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\` USE INDEX (PRIMARY)
      WHERE (\`tx_id\`, \`index\`)
         IN (?)
        AND \`spent_by\` IS NULL
        AND \`voided\` = FALSE`,
    [entries],
  );

  const utxos = results.map(mapDbResultToDbTxOutput);

  return utxos;
};

/**
 * Get a wallet's UTXOs, sorted by value.
 *
 * @remarks
 * Locked and authority UTXOs are not considered.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id
 * @param token - The token id
 * @returns A list of UTXOs with all their properties
 */
export const getWalletSortedValueUtxos = async (
  mysql: ServerlessMysql,
  walletId: string,
  tokenId: string,
): Promise<DbTxOutput[]> => {
  const utxos = [];
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\`
      WHERE \`address\`
         IN (
           SELECT \`address\`
             FROM \`address\`
            WHERE \`wallet_id\` = ?
         )
        AND \`token_id\` = ?
        AND \`authorities\` = 0
        AND \`locked\` = FALSE
        AND \`tx_proposal\` IS NULL
        AND \`spent_by\` IS NULL
        AND \`voided\` = FALSE
   ORDER BY \`value\`
       DESC`,
    [walletId, tokenId],
  );
  for (const result of results) {
    const utxo: DbTxOutput = {
      txId: result.tx_id as string,
      index: result.index as number,
      tokenId: result.token_id as string,
      address: result.address as string,
      value: result.value as number,
      authorities: result.authorities as number,
      timelock: result.timelock as number,
      heightlock: result.heightlock as number,
      locked: result.locked > 0,
    };
    utxos.push(utxo);
  }
  return utxos;
};

/**
 * Mark UTXOs as unlocked.
 *
 * @param mysql - Database connection
 * @param utxos - List of UTXOs to unlock
 */
export const unlockUtxos = async (mysql: ServerlessMysql, utxos: DbTxOutput[]): Promise<void> => {
  if (utxos.length === 0) return;
  const entries = utxos.map((utxo) => [utxo.txId, utxo.index]);
  await mysql.query(
    `UPDATE \`tx_output\`
        SET \`locked\` = FALSE
      WHERE (\`tx_id\` ,\`index\`)
         IN (?)`,
    [entries],
  );
};

/**
 * Get tx inputs that are still marked as locked.
 *
 * @remarks
 * At first, it doesn't make sense to talk about locked inputs. Any UTXO can only be spent after
 * it's unlocked. However, in this service, we have a "lazy" unlock policy, only unlocking the UTXOs
 * when the wallet owner requests its balance. Therefore, we might receive a transaction with a UTXO
 * that is sill marked as locked in our database. That might happen if the user sends his transaction
 * using a service other than this one. Otherwise the locked amount would have been updated before
 * sending.
 *
 * @param mysql - Database connection
 * @param inputs - The transaction inputs
 * @returns The locked UTXOs
 */
export const getLockedUtxoFromInputs = async (mysql: ServerlessMysql, inputs: TxInput[]): Promise<DbTxOutput[]> => {
  const entries = inputs.map((input) => [input.tx_id, input.index]);
  // entries might be empty if there are no inputs
  if (entries.length) {
    // get the rows before deleting
    const results: DbSelectResult = await mysql.query(
      `SELECT *
         FROM \`tx_output\` USE INDEX (PRIMARY)
        WHERE (\`tx_id\` ,\`index\`)
           IN (?)
          AND \`locked\` = TRUE
          AND \`spent_by\` IS NULL
          AND \`voided\` = FALSE`,
      [entries],
    );

    return results.map((utxo) => ({
      txId: utxo.tx_id as string,
      index: utxo.index as number,
      tokenId: utxo.token_id as string,
      address: utxo.address as string,
      value: utxo.value as number,
      authorities: utxo.authorities as number,
      timelock: utxo.timelock as number,
      heightlock: utxo.heightlock as number,
      locked: (utxo.locked > 0),
    }));
  }

  return [];
};

/**
 * Update addresses tables with a new transaction.
 *
 * @remarks
 * When a new transaction arrives, it will change the balance and tx history for addresses. This function
 * updates the address, address_balance and address_tx_history tables with information from this transaction.
 *
 * @param mysql - Database connection
 * @param txId - Transaction id
 * @param timestamp - Transaction timestamp
 * @param addressBalanceMap - Map with the transaction's balance for each address
 */
export const updateAddressTablesWithTx = async (
  mysql: ServerlessMysql,
  txId: string,
  timestamp: number,
  addressBalanceMap: StringMap<TokenBalanceMap>,
): Promise<void> => {
  /*
   * update address table
   *
   * If an address is not yet present, add entry with index = null, walletId = null and transactions = 1.
   * Later, when the corresponding wallet is started, index and walletId will be updated.
   *
   * If address is already present, just increment the transactions counter.
   */
  const addressEntries = Object.keys(addressBalanceMap).map((address) => [address, 1]);
  await mysql.query(
    `INSERT INTO \`address\`(\`address\`, \`transactions\`)
          VALUES ?
              ON DUPLICATE KEY UPDATE transactions = transactions + 1`,
    [addressEntries],
  );

  const entries = [];
  for (const [address, tokenMap] of Object.entries(addressBalanceMap)) {
    for (const [token, tokenBalance] of tokenMap.iterator()) {
      // update address_balance table or update balance and transactions if there's an entry already
      const entry = {
        address,
        token_id: token,
        // totalAmountSent is the sum of the value of all outputs of this token on the tx being sent to this address
        // which means it is the "total_received" for this address
        total_received: tokenBalance.totalAmountSent,
        // if it's < 0, there must be an entry already, so it will execute "ON DUPLICATE KEY UPDATE" instead of setting it to 0
        unlocked_balance: (tokenBalance.unlockedAmount < 0 ? 0 : tokenBalance.unlockedAmount),
        // this is never less than 0, as locked balance only changes when a tx is unlocked
        locked_balance: tokenBalance.lockedAmount,
        unlocked_authorities: tokenBalance.unlockedAuthorities.toUnsignedInteger(),
        locked_authorities: tokenBalance.lockedAuthorities.toUnsignedInteger(),
        timelock_expires: tokenBalance.lockExpires,
        transactions: 1,
      };
      // save the smaller value of timelock_expires, when not null
      await mysql.query(
        `INSERT INTO address_balance
                 SET ?
                  ON DUPLICATE KEY
                            UPDATE total_received = total_received + ?,
                                   unlocked_balance = unlocked_balance + ?,
                                   locked_balance = locked_balance + ?,
                                   transactions = transactions + 1,
                                   timelock_expires = CASE
                                                        WHEN timelock_expires IS NULL THEN VALUES(timelock_expires)
                                                        WHEN VALUES(timelock_expires) IS NULL THEN timelock_expires
                                                        ELSE LEAST(timelock_expires, VALUES(timelock_expires))
                                                      END,
                                   unlocked_authorities = (unlocked_authorities | VALUES(unlocked_authorities)),
                                   locked_authorities = locked_authorities | VALUES(locked_authorities)`,
        [entry, tokenBalance.totalAmountSent, tokenBalance.unlockedAmount, tokenBalance.lockedAmount, address, token],
      );

      // if we're removing any of the authorities, we need to refresh the authority columns. Unlike the values,
      // we cannot only sum/subtract, as authorities are binary: you have it or you don't. We might be spending
      // an authority output in this tx without creating a new one, but it doesn't mean this address does not
      // have this authority anymore, as it might have other authority outputs
      if (tokenBalance.unlockedAuthorities.hasNegativeValue()) {
        await mysql.query(
          `UPDATE \`address_balance\`
              SET \`unlocked_authorities\` = (
                SELECT BIT_OR(\`authorities\`)
                  FROM \`tx_output\`
                 WHERE \`address\` = ?
                   AND \`token_id\` = ?
                   AND \`locked\` = FALSE
                   AND \`spent_by\` IS NULL
                   AND \`voided\` = FALSE
              )
            WHERE \`address\` = ?
              AND \`token_id\` = ?`,
          [address, token, address, token],
        );
      }
      // for locked authorities, it doesn't make sense to perform the same operation. The authority needs to be
      // unlocked before it can be spent. In case we're just adding new locked authorities, this will be taken
      // care by the first sql query.

      // update address_tx_history with one entry for each pair (address, token)
      entries.push([address, txId, token, tokenBalance.total(), timestamp]);
    }
  }

  await mysql.query(
    `INSERT INTO \`address_tx_history\`(\`address\`, \`tx_id\`,
                                        \`token_id\`, \`balance\`,
                                        \`timestamp\`)
     VALUES ?`,
    [entries],
  );
};

/**
 * Update the unlocked and locked balances for addresses.
 *
 * @remarks
 * The balance of an address might change as a locked amount becomes unlocked. This function updates
 * the address_balance table, subtracting from the locked column and adding to the unlocked column.
 *
 * @param mysql - Database connection
 * @param addressBalanceMap - A map of addresses and the unlocked balances
 * @param updateTimelock - If this update is triggered by a timelock expiring, update the next expire timestamp
 */
export const updateAddressLockedBalance = async (
  mysql: ServerlessMysql,
  addressBalanceMap: StringMap<TokenBalanceMap>,
  updateTimelocks = false,
): Promise<void> => {
  for (const [address, tokenBalanceMap] of Object.entries(addressBalanceMap)) {
    for (const [token, tokenBalance] of tokenBalanceMap.iterator()) {
      await mysql.query(
        `UPDATE \`address_balance\`
            SET \`unlocked_balance\` = \`unlocked_balance\` + ?,
                \`locked_balance\` = \`locked_balance\` - ?,
                \`unlocked_authorities\` = (unlocked_authorities | ?)
          WHERE \`address\` = ?
            AND \`token_id\` = ?`, [
          tokenBalance.unlockedAmount,
          tokenBalance.unlockedAmount,
          tokenBalance.unlockedAuthorities.toInteger(),
          address,
          token,
        ],
      );

      // if any authority has been unlocked, we have to refresh the locked authorities
      if (tokenBalance.unlockedAuthorities.toInteger() > 0) {
        await mysql.query(
          `UPDATE \`address_balance\`
              SET \`locked_authorities\` = (
                SELECT BIT_OR(\`authorities\`)
                  FROM \`tx_output\`
                 WHERE \`address\` = ?
                   AND \`token_id\` = ?
                   AND \`locked\` = TRUE
                   AND \`spent_by\` IS NULL
                   AND \`voided\` = FALSE)
                 WHERE \`address\` = ?
                   AND \`token_id\` = ?`,
          [address, token, address, token],
        );
      }

      // if this is being unlocked due to a timelock, also update the timelock_expires column
      if (updateTimelocks) {
        await mysql.query(`
          UPDATE \`address_balance\`
             SET \`timelock_expires\` = (
               SELECT MIN(\`timelock\`)
                 FROM \`tx_output\`
                WHERE \`address\` = ?
                  AND \`token_id\` = ?
                  AND \`locked\` = TRUE
                  AND \`spent_by\` IS NULL
                  AND \`voided\` = FALSE
             )
           WHERE \`address\` = ?
             AND \`token_id\` = ?`,
        [address, token, address, token]);
      }
    }
  }
};

/**
 * Update the unlocked and locked balances for wallets.
 *
 * @remarks
 * The balance of a wallet might change as a locked amount becomes unlocked. This function updates
 * the wallet_balance table, subtracting from the locked column and adding to the unlocked column.
 *
 * @param mysql - Database connection
 * @param walletBalanceMap - A map of walletId and the unlocked balances
 * @param updateTimelocks - If this update is triggered by a timelock expiring, update the next lock expiration
 */
export const updateWalletLockedBalance = async (
  mysql: ServerlessMysql,
  walletBalanceMap: StringMap<TokenBalanceMap>,
  updateTimelocks = false,
): Promise<void> => {
  for (const [walletId, tokenBalanceMap] of Object.entries(walletBalanceMap)) {
    for (const [token, tokenBalance] of tokenBalanceMap.iterator()) {
      await mysql.query(
        `UPDATE \`wallet_balance\`
            SET \`unlocked_balance\` = \`unlocked_balance\` + ?,
                \`locked_balance\` = \`locked_balance\` - ?,
                \`unlocked_authorities\` = (\`unlocked_authorities\` | ?)
          WHERE \`wallet_id\` = ?
            AND \`token_id\` = ?`,
        [tokenBalance.unlockedAmount, tokenBalance.unlockedAmount,
          tokenBalance.unlockedAuthorities.toInteger(), walletId, token],
      );

      // if any authority has been unlocked, we have to refresh the locked authorities
      if (tokenBalance.unlockedAuthorities.toInteger() > 0) {
        await mysql.query(
          `UPDATE \`wallet_balance\`
              SET \`locked_authorities\` = (
                SELECT BIT_OR(\`locked_authorities\`)
                  FROM \`address_balance\`
                 WHERE \`address\` IN (
                   SELECT \`address\`
                     FROM \`address\`
                    WHERE \`wallet_id\` = ?)
                    AND \`token_id\` = ?)
            WHERE \`wallet_id\` = ?
              AND \`token_id\` = ?`,
          [walletId, token, walletId, token],
        );
      }

      // if this is being unlocked due to a timelock, also update the timelock_expires column
      if (updateTimelocks) {
        await mysql.query(
          `UPDATE \`wallet_balance\`
              SET \`timelock_expires\` = (
                SELECT MIN(\`timelock_expires\`)
                  FROM \`address_balance\`
                 WHERE \`address\`
                    IN (
                      SELECT \`address\`
                        FROM \`address\`
                       WHERE \`wallet_id\` = ?)
                   AND \`token_id\` = ?)
            WHERE \`wallet_id\` = ? AND \`token_id\` = ?`,
          [walletId, token, walletId, token],
        );
      }
    }
  }
};

/**
 * Get a wallet's addresses.
 *
 * @param mysql - Database connection
 * @param walletId - Wallet id
 * @param filterAddresses - Optional parameter to filter addresses from the list
 * @returns A list of addresses and their info (index and transactions)
 */
export const getWalletAddresses = async (mysql: ServerlessMysql, walletId: string, filterAddresses?: string[]): Promise<AddressInfo[]> => {
  const addresses: AddressInfo[] = [];
  const subQuery = filterAddresses ? `
    AND \`address\` IN (?)
  ` : '';

  const results: DbSelectResult = await mysql.query(`
    SELECT *
      FROM \`address\`
     WHERE \`wallet_id\` = ?
      ${subQuery}
  ORDER BY \`index\`
       ASC`, [walletId, filterAddresses]);

  for (const result of results) {
    const address = {
      address: result.address as string,
      index: result.index as number,
      transactions: result.transactions as number,
    };
    addresses.push(address);
  }
  return addresses;
};

/**
 * Get the empty addresses of a wallet after the last used address
 *
 * @param mysql - Database connection
 * @param walletId - Wallet id
 * @returns A list of addresses and their indexes
 */
export const getNewAddresses = async (mysql: ServerlessMysql, walletId: string): Promise<ShortAddressInfo[]> => {
  const addresses: ShortAddressInfo[] = [];
  const resultsWallet: DbSelectResult = await mysql.query('SELECT * FROM `wallet` WHERE `id` = ?', walletId);
  if (resultsWallet.length) {
    const gapLimit = resultsWallet[0].max_gap as number;
    const latestUsedIndex = resultsWallet[0].last_used_address_index as number;
    // Select all addresses that are empty and the index is bigger than the last used address index
    const results: DbSelectResult = await mysql.query(`
      SELECT *
        FROM \`address\`
       WHERE \`wallet_id\` = ?
         AND \`transactions\` = 0
         AND \`index\` > ?
    ORDER BY \`index\`
         ASC
    LIMIT ?`, [walletId, latestUsedIndex, gapLimit]);

    for (const result of results) {
      const index = result.index as number;
      const address = {
        address: result.address as string,
        index,
        addressPath: getAddressPath(index),
      };
      addresses.push(address);
    }
  }
  return addresses;
};

/**
 * Get a wallet's balances.
 *
 * @remarks
 * If tokenIds is given, get the balance for just those tokens.
 *
 * @param mysql - Database connection
 * @param walletId - Wallet id
 * @param tokenIds - A list of token ids
 * @returns A list of balances.
 */
export const getWalletBalances = async (mysql: ServerlessMysql, walletId: string, tokenIds: string[] = []): Promise<WalletTokenBalance[]> => {
  const balances: WalletTokenBalance[] = [];
  let subquery = 'SELECT * FROM `wallet_balance` WHERE `wallet_id` = ?';
  const params: unknown[] = [walletId];
  if (tokenIds.length > 0) {
    subquery += ' AND `token_id` IN (?)';
    params.push(tokenIds);
  }

  const query = `
    SELECT w.total_received AS total_received,
           w.unlocked_balance AS unlocked_balance,
           w.locked_balance AS locked_balance,
           w.unlocked_authorities AS unlocked_authorities,
           w.locked_authorities AS locked_authorities,
           w.timelock_expires AS timelock_expires,
           w.transactions AS transactions,
           w.token_id AS token_id,
           token.name AS name,
           token.symbol AS symbol
      FROM (${subquery}) w
INNER JOIN token ON w.token_id = token.id
  `;

  const results: DbSelectResult = await mysql.query(query, params);
  for (const result of results) {
    const totalAmount = result.total_received as number;
    const unlockedBalance = result.unlocked_balance as number;
    const lockedBalance = result.locked_balance as number;
    const unlockedAuthorities = new Authorities(result.unlocked_authorities as number);
    const lockedAuthorities = new Authorities(result.locked_authorities as number);
    const timelockExpires = result.timelock_expires as number;

    const balance = new WalletTokenBalance(
      new TokenInfo(result.token_id as string, result.name as string, result.symbol as string),
      new Balance(totalAmount, unlockedBalance, lockedBalance, timelockExpires, unlockedAuthorities, lockedAuthorities),
      result.transactions as number,
    );
    balances.push(balance);
  }

  return balances;
};

/**
 * Gets a list of tokens that a given wallet has ever interacted with
 *
 * @returns A list of tokens.
 */
export const getWalletTokens = async (
  mysql: ServerlessMysql,
  walletId: string,
): Promise<string[]> => {
  const tokenList: string[] = [];
  const results: DbSelectResult = await mysql.query(
    `SELECT DISTINCT(token_id)
       FROM \`wallet_tx_history\`
      WHERE \`wallet_id\` = ?`,
    [walletId],
  );

  for (const result of results) {
    tokenList.push(<string> result.token_id);
  }

  return tokenList;
};

/**
 * Get a wallet's transaction history for a token.
 *
 * @remarks
 * Transactions are ordered by timestamp descending - i.e. most recent first.
 *
 * 'skip' determines how many transactions will be skipped from the beginning.
 *
 * 'count' determines how many transactions will be returned.
 *
 * @param mysql - Database connection
 * @param walletId - Wallet id
 * @param tokenId - Token id
 * @param skip - Number of transactions to skip
 * @param count - Number of transactions to return
 * @returns A list of balances.
 */
export const getWalletTxHistory = async (
  mysql: ServerlessMysql,
  walletId: string,
  tokenId: string,
  skip: number,
  count: number,
): Promise<TxTokenBalance[]> => {
  const history: TxTokenBalance[] = [];
  const results: DbSelectResult = await mysql.query(`
    SELECT wallet_tx_history.balance AS balance,
           wallet_tx_history.timestamp AS timestamp,
           wallet_tx_history.token_id AS token_id,
           wallet_tx_history.tx_id AS tx_id,
           wallet_tx_history.voided AS voided,
           wallet_tx_history.wallet_id AS wallet_id,
           transaction.version AS version
      FROM wallet_tx_history
LEFT OUTER JOIN transaction ON transaction.tx_id = wallet_tx_history.tx_id
     WHERE wallet_id = ?
       AND token_id = ?
  ORDER BY wallet_tx_history.timestamp
      DESC
     LIMIT ?, ?`,
  [walletId, tokenId, skip, count]);

  for (const result of results) {
    const tx: TxTokenBalance = {
      txId: <string>result.tx_id,
      timestamp: <number>result.timestamp,
      voided: <boolean>result.voided,
      balance: <Balance>result.balance,
      version: <number>result.version,
    };
    history.push(tx);
  }
  return history;
};

/**
 * Get the utxos that are locked at a certain height.
 *
 * @remarks
 * UTXOs from blocks are locked by height. This function returns the ones that are locked at the given height.
 *
 * Also, these UTXOs might have a timelock. Even though this is not common, it is also considered.
 *
 * @param mysql - Database connection
 * @param now - Current timestamp
 * @param height - The block height queried
 * @returns A list of UTXOs locked at the given height
 */
export const getUtxosLockedAtHeight = async (
  mysql: ServerlessMysql,
  now: number,
  height: number,
): Promise<DbTxOutput[]> => {
  const utxos = [];
  if (height >= 0) {
    const results: DbSelectResult = await mysql.query(
      `SELECT *
         FROM \`tx_output\`
        WHERE \`heightlock\` = ?
          AND \`spent_by\` IS NULL
          AND \`voided\` = FALSE
          AND (\`timelock\` <= ?
               OR \`timelock\` is NULL)
          AND \`locked\` = 1`,
      [height, now],
    );
    for (const result of results) {
      const utxo: DbTxOutput = {
        txId: result.tx_id as string,
        index: result.index as number,
        tokenId: result.token_id as string,
        address: result.address as string,
        value: result.value as number,
        authorities: result.authorities as number,
        timelock: result.timelock as number,
        heightlock: result.heightlock as number,
        locked: result.locked > 0,
      };
      utxos.push(utxo);
    }
  }
  return utxos;
};

/**
 * Get UTXOs that can be unlocked for a given wallet.
 *
 * @remarks
 * Get the UTXOs that are still marked as locked in the utxo table but whose locks (height and time)
 * have already expired.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet's id
 * @param now - The current timestamp
 * @param currentHeight - Latest block height
 * @returns The latest height
 */
export const getWalletUnlockedUtxos = async (
  mysql: ServerlessMysql,
  walletId: string,
  now: number,
  currentHeight: number,
): Promise<DbTxOutput[]> => {
  const utxos = [];
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\`
      WHERE (\`heightlock\` <= ?
             OR \`heightlock\` is NULL)
        AND (\`timelock\` <= ?
             OR \`timelock\` is NULL)
        AND \`locked\` = 1
        AND \`spent_by\` IS NULL
        AND \`voided\` = FALSE
        AND \`address\` IN (
          SELECT \`address\`
            FROM \`address\`
           WHERE \`wallet_id\` = ?)`,
    [currentHeight, now, walletId],
  );
  for (const result of results) {
    const utxo: DbTxOutput = {
      txId: result.tx_id as string,
      index: result.index as number,
      tokenId: result.token_id as string,
      address: result.address as string,
      value: result.value as number,
      authorities: result.authorities as number,
      timelock: result.timelock as number,
      heightlock: result.heightlock as number,
      locked: result.locked > 0,
    };
    utxos.push(utxo);
  }
  return utxos;
};

/**
 * Update latest version_data on the database
 *
 * @param mysql - Database connection
 * @param data - Latest version data to store
 */
export const updateVersionData = async (mysql: ServerlessMysql, data: FullNodeVersionData): Promise<void> => {
  const entry = {
    id: 1,
    timestamp: data.timestamp,
    version: data.version,
    network: data.network,
    min_weight: data.minWeight,
    min_tx_weight: data.minTxWeight,
    min_tx_weight_coefficient: data.minTxWeightCoefficient,
    min_tx_weight_k: data.minTxWeightK,
    token_deposit_percentage: data.tokenDepositPercentage,
    reward_spend_min_blocks: data.rewardSpendMinBlocks,
    max_number_inputs: data.maxNumberInputs,
    max_number_outputs: data.maxNumberOutputs,
  };

  await mysql.query(
    'INSERT INTO `version_data` SET ? ON DUPLICATE KEY UPDATE ?',
    [entry, entry],
  );
};

/**
 * Update latest version_check time
 *
 * @param mysql - Database connection
 * @returns
 */
export const getVersionData = async (mysql: ServerlessMysql): Promise<FullNodeVersionData | null> => {
  const results: DbSelectResult = await mysql.query('SELECT * FROM `version_data` WHERE id = 1 LIMIT 1;');

  if (results.length > 0) {
    const data = results[0];

    const entry: FullNodeVersionData = {
      timestamp: data.timestamp as number,
      version: data.version as string,
      network: data.network as string,
      minWeight: data.min_weight as number,
      minTxWeight: data.min_tx_weight as number,
      minTxWeightCoefficient: data.min_tx_weight_coefficient as number,
      minTxWeightK: data.min_tx_weight_k as number,
      tokenDepositPercentage: data.token_deposit_percentage as number,
      rewardSpendMinBlocks: data.reward_spend_min_blocks as number,
      maxNumberInputs: data.max_number_inputs as number,
      maxNumberOutputs: data.max_number_outputs as number,
    };

    return entry;
  }

  return null;
};

/**
 * Get height info from database.
 *
 * @param mysql - Database connection
 * @returns The latest height
 */
export const getLatestHeight = async (mysql: ServerlessMysql): Promise<number> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT \`height\` AS value
       FROM \`transaction\`
      WHERE version
         IN (?)
      ORDER BY height
       DESC
      LIMIT 1`, [BLOCK_VERSION],
  );

  if (results.length > 0 && results[0].value !== null) {
    return results[0].value as number;
  }

  // it should never come here, as genesis block should be added at startup
  return 0;
};

/**
 * Gets the best block from the database
 *
 * @param mysql - Database connection
 *
 * @returns The latest height
 */
export const getLatestBlockByHeight = async (mysql: ServerlessMysql): Promise<Block> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`transaction\`
      WHERE \`version\` IN (?)
      ORDER BY height DESC
      LIMIT 1`, [BLOCK_VERSION],
  );

  if (results.length > 0) {
    return {
      txId: results[0].tx_id as string,
      height: results[0].height as number,
      timestamp: results[0].timestamp as number,
    };
  }

  return null;
};

/**
 * Get block by height
 *
 * @param mysql - Database connection
 * @param height - The height to query
 *
 * @returns The latest height
 */
export const getBlockByHeight = async (mysql: ServerlessMysql, height: number): Promise<Block> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`transaction\`
      WHERE \`height\` = ?
        AND \`version\` IN (?)
      LIMIT 1`, [height, BLOCK_VERSION],
  );

  if (results.length > 0) {
    return {
      txId: results[0].tx_id as string,
      height: results[0].height as number,
      timestamp: results[0].timestamp as number,
    };
  }

  return null;
};

/**
 * Store the token information.
 *
 * @param mysql - Database connection
 * @param tokenId - The token's id
 * @param tokenName - The token's name
 * @param tokenSymbol - The token's symbol
 */
export const storeTokenInformation = async (
  mysql: ServerlessMysql,
  tokenId: string,
  tokenName: string,
  tokenSymbol: string,
): Promise<void> => {
  const entry = { id: tokenId, name: tokenName, symbol: tokenSymbol };
  await mysql.query(
    'INSERT INTO `token` SET ?',
    [entry],
  );
};

/**
 * Get the token information.
 *
 * @param mysql - Database connection
 * @param tokenId - The token's id
 * @returns The token information (or null if id is not found)
 */
export const getTokenInformation = async (
  mysql: ServerlessMysql,
  tokenId: string,
): Promise<TokenInfo> => {
  const results: DbSelectResult = await mysql.query(
    'SELECT * FROM `token` WHERE `id` = ?',
    [tokenId],
  );
  if (results.length === 0) return null;
  return new TokenInfo(tokenId, results[0].name as string, results[0].symbol as string);
};

/**
 * Get the unused addresses for a wallet.
 *
 * @remarks
 * An unsued address is an address with 0 transactions. Addresses are ordered by index, ascending.
 *
 * @param mysql - Database connection
 * @param walletId - The wallet's id
 * @returns List of unused addresses
 */
export const getUnusedAddresses = async (mysql: ServerlessMysql, walletId: string): Promise<string[]> => {
  const addresses = [];
  const results: DbSelectResult = await mysql.query(
    'SELECT `address` FROM `address` WHERE `wallet_id` = ? AND `transactions` = 0 ORDER BY `index` ASC',
    [walletId],
  );

  for (const entry of results) {
    const address = entry.address as string;
    addresses.push(address);
  }
  return addresses;
};

/**
 * Mark the given UTXOs with the txProposalId.
 *
 * @param mysql - Database connection
 * @param txProposalId - The transaction proposal id
 * @param utxos - The UTXOs to be marked with the proposal id
 */
export const markUtxosWithProposalId = async (mysql: ServerlessMysql, txProposalId: string, utxos: DbTxOutput[]): Promise<void> => {
  const entries = utxos.map((utxo, index) => ([utxo.txId, utxo.index, '', '', 0, 0, null, null, false, txProposalId, index, null, 0]));
  await mysql.query(
    `INSERT INTO \`tx_output\`
          VALUES ?
              ON DUPLICATE KEY\
          UPDATE \`tx_proposal\` = VALUES(\`tx_proposal\`),
                 \`tx_proposal_index\` = VALUES(\`tx_proposal_index\`)`,
    [entries],
  );
};

/**
 * Create a tx proposal on the database.
 *
 * @param mysql - Database connection
 * @param txProposalId - The transaction proposal id
 * @param walletId - The wallet associated with this proposal
 * @param now - The current timestamp
 */
export const createTxProposal = async (
  mysql: ServerlessMysql,
  txProposalId: string,
  walletId: string,
  now: number,
): Promise<void> => {
  const entry = { id: txProposalId, wallet_id: walletId, status: TxProposalStatus.OPEN, created_at: now };
  await mysql.query(
    'INSERT INTO `tx_proposal` SET ?',
    [entry],
  );
};

/**
 * Update a list of tx proposals.
 *
 * @param mysql - Database connection
 * @param txProposalIds - The transaction proposal ids
 * @param now - The current timestamp
 * @param status - The new status
 */
export const updateTxProposal = async (
  mysql: ServerlessMysql,
  txProposalIds: string[],
  now: number,
  status: TxProposalStatus,
): Promise<void> => {
  await mysql.query(`
    UPDATE \`tx_proposal\`
       SET \`updated_at\` = ?,
           \`status\` = ?
     WHERE \`id\` IN (?)`, [
    now,
    status,
    txProposalIds,
  ]);
};

/**
 * Get a tx proposal.
 *
 * @param mysql - Database connection
 * @param txProposalId - The transaction proposal id
 * @param now - The current timestamp
 */
export const getTxProposal = async (
  mysql: ServerlessMysql,
  txProposalId: string,
): Promise<TxProposal> => {
  const results: DbSelectResult = await mysql.query(
    'SELECT * FROM `tx_proposal` WHERE `id` = ?',
    [txProposalId],
  );
  if (results.length === 0) return null;
  return {
    id: txProposalId,
    walletId: results[0].wallet_id as string,
    status: results[0].status as TxProposalStatus,
    createdAt: results[0].created_at as number,
    updatedAt: results[0].updated_at as number,
  };
};

/**
 * When a tx proposal is cancelled we must release the utxos to be used by others
 *
 * @param mysql - Database connection
 * @param txProposalId - The transaction proposal id
 */
export const releaseTxProposalUtxos = async (
  mysql: ServerlessMysql,
  txProposalIds: string[],
): Promise<void> => {
  const result: OkPacket = await mysql.query(
    `UPDATE \`tx_output\`
        SET \`tx_proposal\` = NULL,
            \`tx_proposal_index\` = NULL
      WHERE \`tx_proposal\` IN (?)`,
    [txProposalIds],
  );

  assert.strictEqual(
    result.affectedRows,
    txProposalIds.length,
    'Not all utxos were correctly updated',
  );
};

/**
 * Get txs after a given height
 *
 * @param mysql - Database connection
 * @param height - The height to search

 * @returns A list of txs
 */
export const getTxsAfterHeight = async (
  mysql: ServerlessMysql,
  height: number,
): Promise<Tx[]> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`transaction\`
      WHERE \`height\` > ?
        AND \`voided\` = FALSE`,
    [height],
  );

  return getTxsFromDBResult(results);
};

/**
 * Get a list of all tx outputs from transactions
 *
 * @param mysql - Database connection
 * @param transactions - The list of transactions

 * @returns A list of tx outputs
 */
export const getTxOutputs = async (
  mysql: ServerlessMysql,
  transactions: Tx[],
): Promise<DbTxOutput[]> => {
  const txIds = transactions.map((tx) => tx.txId);
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\`
      WHERE \`tx_id\` IN (?)`,
    [txIds],
  );

  const utxos = [];
  for (const result of results) {
    const utxo: DbTxOutput = {
      txId: result.tx_id as string,
      index: result.index as number,
      tokenId: result.token_id as string,
      address: result.address as string,
      value: result.value as number,
      authorities: result.authorities as number,
      timelock: result.timelock as number,
      heightlock: result.heightlock as number,
      locked: result.locked > 0,
      txProposalId: result.tx_proposal as string,
      txProposalIndex: result.tx_proposal_index as number,
      spentBy: result.spent_by ? result.spent_by as string : null,
    };
    utxos.push(utxo);
  }

  return utxos;
};

/**
 * Get a list of transactions from their txIds
 *
 * @param mysql - Database connection
 * @param txIds - The list of transaction ids

 * @returns A list of transactions
 */
export const getTransactionsById = async (
  mysql: ServerlessMysql,
  txIds: string[],
): Promise<Tx[]> => {
  if (txIds.length === 0) {
    return [];
  }

  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`transaction\`
      WHERE \`tx_id\` IN (?)
        AND \`voided\` = FALSE`,
    [txIds],
  );

  return getTxsFromDBResult(results);
};

/**
 * Get a list of tx outputs from their spent_by txId
 *
 * @param mysql - Database connection
 * @param txIds - The list of transactions that spent the tx_outputs we are querying

 * @returns A list of tx_outputs
 */
export const getTxOutputsBySpent = async (
  mysql: ServerlessMysql,
  txIds: string[],
): Promise<DbTxOutput[]> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\`
      WHERE \`spent_by\` IN (?)`,
    [txIds],
  );

  const utxos = [];
  for (const result of results) {
    const utxo: DbTxOutput = {
      txId: result.tx_id as string,
      index: result.index as number,
      tokenId: result.token_id as string,
      address: result.address as string,
      value: result.value as number,
      authorities: result.authorities as number,
      timelock: result.timelock as number,
      heightlock: result.heightlock as number,
      locked: result.locked > 0,
      txProposalId: result.tx_proposal as string,
      txProposalIndex: result.tx_proposal_index as number,
      spentBy: result.spent_by ? result.spent_by as string : null,
    };

    utxos.push(utxo);
  }

  return utxos;
};

/**
 * Set a list of tx_outputs as unspent
 *
 * @param mysql - Database connection
 * @param txOutputs - The list of tx_outputs to unspend
 */
export const unspendUtxos = async (
  mysql: ServerlessMysql,
  txOutputs: DbTxOutput[],
): Promise<void> => {
  const txIdIndexList = txOutputs.map((txOutput) => [txOutput.txId, txOutput.index]);

  await mysql.query(
    `UPDATE \`tx_output\`
        SET \`spent_by\` = NULL
      WHERE (\`tx_id\`, \`index\`) IN (?)`,
    [txIdIndexList],
  );
};

/**
 * Remove height from transactions we want to send back to the `mempool`
 *
 * @param mysql - Database connection
 * @param txs - The list of transactions to remove height
 */
export const removeTxsHeight = async (
  mysql: ServerlessMysql,
  txs: Tx[],
): Promise<void> => {
  const txIds = txs.map((tx) => tx.txId);

  await mysql.query(
    `UPDATE \`transaction\`
        SET \`height\` = NULL
      WHERE \`tx_id\` IN (?)`,
    [txIds],
  );
};

/**
 * Deletes utxos from the tx_outputs table
 *
 * @param mysql - Database connection
 * @param utxos - The list of utxos to delete from the database
 */
export const markUtxosAsVoided = async (
  mysql: ServerlessMysql,
  utxos: DbTxOutput[],
): Promise<void> => {
  const txIds = utxos.map((tx) => tx.txId);

  await mysql.query(`
    UPDATE \`tx_output\`
       SET \`voided\` = TRUE
     WHERE \`tx_id\` IN (?)`,
  [txIds]);
};

/**
 * Delete all blocks starting from a given height
 *
 * @param mysql - Database connection
 * @param height - The height to start deleting from
 */
export const deleteBlocksAfterHeight = async (
  mysql: ServerlessMysql,
  height: number,
): Promise<void> => {
  await mysql.query(
    `DELETE FROM \`transaction\`
      WHERE height > ?
        AND version IN (?)`,
    [height, BLOCK_VERSION],
  );
};

/**
 * Marks transactions as voided on the database
 *
 * @param mysql - Database connection
 * @param transactions - The list of transactions to remove from database
 */
export const markTxsAsVoided = async (
  mysql: ServerlessMysql,
  transactions: Tx[],
): Promise<void> => {
  const txIds = transactions.map((tx) => tx.txId);

  await mysql.query(
    `UPDATE \`transaction\`
        SET \`voided\` = TRUE
      WHERE \`tx_id\` IN (?)`,
    [txIds],
  );
};

/**
 * Remove all records from address_tx_history that belong to the transaction list
 *
 * @param mysql - Database connection
 * @param transactions - The list of transactions to search
 */
export const markAddressTxHistoryAsVoided = async (
  mysql: ServerlessMysql,
  transactions: Tx[],
): Promise<void> => {
  const txIds = transactions.map((tx) => tx.txId);

  await mysql.query(
    `UPDATE \`address_tx_history\`
        SET \`voided\` = TRUE
      WHERE \`tx_id\` IN (?)`,
    [txIds],
  );
};

/**
 * Remove all records from wallet_tx_history that belong to the transaction list
 *
 * @param mysql - Database connection
 * @param transactions - The list of transactions to search
 */
export const markWalletTxHistoryAsVoided = async (
  mysql: ServerlessMysql,
  transactions: Tx[],
): Promise<void> => {
  const txIds = transactions.map((tx) => tx.txId);

  await mysql.query(
    `UPDATE \`wallet_tx_history\`
        SET \`voided\` = TRUE
      WHERE \`tx_id\` IN (?)`,
    [txIds],
  );
};

/**
 * Rebuilds the address_balance table for the given addresses from
 * the tx_output table

 * @param mysql - Database connection
 * @param addresses - The list of addresses to rebuild
 * @param txList - The list of affected transactions, to rebuild the transaction count
 */
export const rebuildAddressBalancesFromUtxos = async (
  mysql: ServerlessMysql,
  addresses: string[],
  txList: string[],
): Promise<void> => {
  if (txList.length === 0) {
    // This should never happen, we should throw so the re-org is rolled back
    // and an error is triggered for manual inspection
    throw new Error('Attempted to rebuild address balances but no transactions were affected');
  }
  // first we need to store the transactions count before deleting
  const oldAddressTokenTransactions: DbSelectResult = await mysql.query(
    `SELECT \`address\`, \`token_id\` AS tokenId, \`transactions\`, \`total_received\` as \`totalReceived\`
       FROM \`address_balance\`
      WHERE \`address\` IN (?)`,
    [addresses],
  );

  // delete affected address_balances
  await mysql.query(
    `UPDATE \`address_balance\`
        SET \`unlocked_balance\` = 0,
            \`locked_balance\` = 0,
            \`locked_authorities\` = 0,
            \`unlocked_authorities\` = 0,
            \`timelock_expires\` = NULL,
            \`transactions\` = 0
      WHERE \`address\` IN (?)`,
    [addresses],
  );

  // update address balances with unlocked utxos
  await mysql.query(`
    INSERT INTO address_balance (
      \`address\`,
      \`token_id\`,
      \`unlocked_balance\`,
      \`locked_balance\`,
      \`unlocked_authorities\`,
      \`locked_authorities\`,
      \`timelock_expires\`,
      \`transactions\`
    )
        SELECT address,
                token_id,
                SUM(\`value\`), -- unlocked_balance
                0,
                BIT_OR(\`authorities\`), -- unlocked_authorities
                0, -- locked_authorities
                NULL, -- timelock_expires
                0 -- transactions
          FROM \`tx_output\`
         WHERE spent_by IS NULL
           AND voided = FALSE
           AND locked = FALSE
           AND address IN (?)
      GROUP BY address, token_id
   ON DUPLICATE KEY UPDATE
    unlocked_balance = VALUES(unlocked_balance),
    unlocked_authorities = VALUES(unlocked_authorities)
  `, [addresses]);

  // update address balances with locked utxos
  await mysql.query(`
    INSERT INTO \`address_balance\` (
      \`address\`,
      \`token_id\`,
      \`unlocked_balance\`,
      \`locked_balance\`,
      \`locked_authorities\`,
      \`timelock_expires\`,
      \`transactions\`
    )
       SELECT address,
              token_id,
              0 AS unlocked_balance,
              SUM(\`value\`) AS locked_balance,
              BIT_OR(\`authorities\`) AS locked_authorities,
              MIN(\`timelock\`) AS timelock_expires,
              0 -- transactions
         FROM \`tx_output\`
        WHERE spent_by IS NULL
          AND voided = FALSE
          AND locked = TRUE
          AND address IN (?)
     GROUP BY \`address\`, \`token_id\`
   ON DUPLICATE KEY UPDATE
    locked_balance = VALUES(locked_balance),
    locked_authorities = VALUES(locked_authorities),
    timelock_expires = VALUES(timelock_expires)
   `, [addresses]);

  const addressTransactionCount: StringMap<number> = await getAffectedAddressTxCountFromTxList(mysql, txList);
  const addressTotalReceived: StringMap<number> = await getAffectedAddressTotalReceivedFromTxList(mysql, txList);
  const tokenTransactionCount: StringMap<number> = await getAffectedTokenTxCountFromTxList(mysql, txList);

  const finalValues = oldAddressTokenTransactions.map(({ address, tokenId, transactions, totalReceived }) => {
    const diffTransactions = addressTransactionCount[`${address}_${tokenId}`] || 0;
    const diffTotalReceived = addressTotalReceived[`${address}_${tokenId}`] || 0;

    return [transactions as number - diffTransactions, totalReceived as number - diffTotalReceived, address, tokenId];
  });

  // update address balances with the correct amount of transactions
  // We have to run multiple updates because we don't want to insert new rows to the table (which would be done
  // if we used the INSERT ... ON CONFLICT syntax)
  for (const item of finalValues) {
    await mysql.query(`
      UPDATE \`address_balance\`
        SET \`transactions\` = ?,
            \`total_received\` = ?
       WHERE \`address\` = ?
         AND \`token_id\` = ?
    `, item);
  }

  // update token table with the correct amount of transactions
  for (const token of Object.keys(tokenTransactionCount)) {
    await mysql.query(`
      UPDATE \`token\`
        SET \`transactions\` = \`transactions\` - ?
       WHERE \`id\` = ?
    `, [tokenTransactionCount[token], token]);
  }
};

/**
 * Retrieves a transaction from the database given a txId
 *
 * @param mysql - Database connection
 * @param txId - The transaction id to search for
 */
export const fetchTx = async (
  mysql: ServerlessMysql,
  txId: string,
): Promise<Tx> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`transaction\`
      WHERE \`tx_id\` = ?
        AND \`voided\` = FALSE`,
    [txId],
  );

  const txResult = getTxsFromDBResult(results);
  return get(txResult, '[0]', null);
};

/**
 * Retrieves a list of `AddressBalance`s from a list of addresses
 *
 * @param mysql - Database connection
 * @param addresses - The addresses to query
 */
export const fetchAddressBalance = async (
  mysql: ServerlessMysql,
  addresses: string[],
): Promise<AddressBalance[]> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`address_balance\`
      WHERE \`address\` IN (?)
   ORDER BY \`address\`, \`token_id\``,
    [addresses],
  );

  return results.map((result): AddressBalance => ({
    address: result.address as string,
    tokenId: result.token_id as string,
    unlockedBalance: result.unlocked_balance as number,
    lockedBalance: result.locked_balance as number,
    lockedAuthorities: result.locked_authorities as number,
    unlockedAuthorities: result.unlocked_authorities as number,
    timelockExpires: result.timelock_expires as number,
    transactions: result.transactions as number,
  }));
};

/**
 * Retrieves a list of `AddressTotalBalance`s from a list of addresses
 *
 * @param mysql - Database connection
 * @param addresses - The addresses to query
 */
export const fetchAddressTxHistorySum = async (
  mysql: ServerlessMysql,
  addresses: string[],
): Promise<AddressTotalBalance[]> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT address,
            token_id,
            SUM(\`balance\`) AS balance,
            COUNT(\`tx_id\`) AS transactions
       FROM \`address_tx_history\`
      WHERE \`address\` IN (?)
        AND \`voided\` = FALSE
   GROUP BY address, token_id
   ORDER BY address, token_id`,
    [addresses],
  );

  return results.map((result): AddressTotalBalance => ({
    address: result.address as string,
    tokenId: result.token_id as string,
    balance: result.balance as number,
    transactions: result.transactions as number,
  }));
};

/**
 * Retrieves a filtered list of tx_outputs
 *
 * @param mysql - Database connection
 * @param filters - Filters to apply on the tx_output query
 */
export const filterTxOutputs = async (
  mysql: ServerlessMysql,
  filters: IFilterTxOutput = { addresses: [] },
): Promise<DbTxOutput[]> => {
  const finalFilters = {
    addresses: [],
    tokenId: '00',
    authority: 0,
    ignoreLocked: false,
    skipSpent: true,
    biggerThan: -1,
    smallerThan: constants.MAX_OUTPUT_VALUE + 1,
    ...filters,
  };

  if (finalFilters.addresses.length === 0) {
    throw new Error('Addresses can\'t be empty.');
  }

  const queryParams: any[] = [
    finalFilters.addresses,
    finalFilters.tokenId,
  ];

  if (finalFilters.authority === 0) {
    queryParams.push(finalFilters.smallerThan);
    queryParams.push(finalFilters.biggerThan);
  } else {
    queryParams.push(finalFilters.authority);
  }

  queryParams.push(finalFilters.maxOutputs);

  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`tx_output\`
      WHERE \`address\`
         IN (?)
        AND \`token_id\` = ?
        ${finalFilters.authority !== 0 ? 'AND `authorities` & ? > 0' : 'AND `authorities` = 0'}
        ${finalFilters.ignoreLocked ? 'AND `locked` = FALSE' : ''}
        ${finalFilters.authority === 0 ? 'AND value < ?' : ''}
        ${finalFilters.authority === 0 ? 'AND value > ?' : ''}
        ${finalFilters.skipSpent ? 'AND `spent_by` IS NULL' : ''}
        ${finalFilters.skipSpent ? 'AND `tx_proposal` IS NULL' : ''}
        AND \`voided\` = FALSE
   ORDER BY \`value\` DESC
        ${finalFilters.maxOutputs ? 'LIMIT ?' : ''}
       `,
    queryParams,
  );

  const utxos: DbTxOutput[] = results.map(mapDbResultToDbTxOutput);

  return utxos;
};

/**
 * Maps the result from the database to DbTxOutput
 *
 * @param results - The tx_output results from the database
 * @returns A list of tx_outputs mapped to the DbTxOutput type
 */
export const mapDbResultToDbTxOutput = (result: any): DbTxOutput => ({
  txId: result.tx_id as string,
  index: result.index as number,
  tokenId: result.token_id as string,
  address: result.address as string,
  value: result.value as number,
  authorities: result.authorities as number,
  timelock: result.timelock as number,
  heightlock: result.heightlock as number,
  locked: result.locked > 0,
  txProposalId: result.tx_proposal as string,
  txProposalIndex: result.tx_proposal_index as number,
  spentBy: result.spent_by as string,
});

/**
 * Get tx proposal inputs.
 *
 * @remarks
 * The inputs are taken from the utxo table.
 *
 * @param mysql - Database connection
 * @param txProposalId - The transaction proposal id
 * @returns A list of inputs.
 */
export const getTxProposalInputs = async (
  mysql: ServerlessMysql,
  txProposalId: string,
): Promise<IWalletInput[]> => {
  const inputs = [];
  const results: DbSelectResult = await mysql.query(
    'SELECT * FROM `tx_output` WHERE `tx_proposal` = ? ORDER BY `tx_proposal_index` ASC',
    [txProposalId],
  );
  for (const result of results) {
    const input: IWalletInput = {
      txId: result.tx_id as string,
      index: result.index as number,
    };
    inputs.push(input);
  }
  return inputs;
};

/**
 * Get mempool txs before a date
 *
 * @param mysql - Database connection
 * @param date - The date to search for

 * @returns A list of txs
 */
export const getMempoolTransactionsBeforeDate = async (
  mysql: ServerlessMysql,
  date: number,
): Promise<Tx[]> => {
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`transaction\`
      WHERE \`timestamp\` < ?
        AND \`voided\` = FALSE
        AND \`height\` IS NULL`,
    [date],
  );

  return getTxsFromDBResult(results);
};

/**
 * Add a miner to the database
 *
 * @param mysql - Database connection
 */
export const addMiner = async (
  mysql: ServerlessMysql,
  address: string,
  txId: string,
): Promise<void> => {
  await mysql.query(
    `INSERT INTO \`miner\` (address, first_block, last_block, count)
     VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE last_block = ?, count = count + 1`,
    [address, txId, txId, txId],
  );
};

/**
 * Get the list of miners on database
 *
 * @param mysql - Database connection

 * @returns A list of strings with miners addresses
 */
export const getMinersList = async (
  mysql: ServerlessMysql,
): Promise<Miner[]> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT address, first_block, last_block, count
      FROM miner;
  `);

  const minerList: Miner[] = [];

  for (const result of results) {
    minerList.push({
      address: result.address as string,
      firstBlock: result.first_block as string,
      lastBlock: result.last_block as string,
      count: result.count as number,
    });
  }

  return minerList;
};

/**
 * Get the total sum of a token's utxos, excluding the burned and voided ones
 *
 * @param mysql - Database connection

 * @returns The calculated sum
 */
export const getTotalSupply = async (
  mysql: ServerlessMysql,
  tokenId: string,
): Promise<number> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT SUM(value) as value
      FROM tx_output
     WHERE spent_by IS NULL
       AND token_id = ?
       AND voided = FALSE
       AND address != '${BURN_ADDRESS}'
  `, [tokenId]);

  if (!results.length) {
    // This should never happen.
    await addAlert(
      'Total supply query returned no results',
      '-',
      Severity.MINOR,
      { tokenId },
    );
    throw new Error('Total supply query returned no results');
  }

  return results[0].value as number;
};

/**
 * Get from database utxos that must be unlocked because their timelocks expired
 *
 * @param mysql - Database connection
 * @param now - Current timestamp

 * @returns A list of timelocked utxos
 */
export const getExpiredTimelocksUtxos = async (
  mysql: ServerlessMysql,
  now: number,
): Promise<DbTxOutput[]> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT *
      FROM tx_output
     WHERE locked = TRUE
       AND timelock IS NOT NULL
       AND timelock < ?
  `, [now]);

  const lockedUtxos: DbTxOutput[] = results.map(mapDbResultToDbTxOutput);

  return lockedUtxos;
};

/**
 * Get the total sum of transactions for a given tokenId
 *
 * @param mysql - Database connection
 * @param tokenId - The token id to fetch transactions

 * @returns The calculated total sum of transactions
 */
export const getTotalTransactions = async (
  mysql: ServerlessMysql,
  tokenId: string,
): Promise<number> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT COUNT(DISTINCT(tx_id)) AS count
      FROM address_tx_history
     WHERE token_id = ?
       AND voided = FALSE
  `, [tokenId]);

  if (!results.length) {
    // This should never happen.
    await addAlert(
      'Total transactions query returned no results',
      '-',
      Severity.MINOR,
      { tokenId },
    );
    throw new Error('Total transactions query returned no results');
  }

  return results[0].count as number;
};

/**
 * Get the available authority utxos for a given token
 *
 * @param mysql - Database connection
 * @param tokenId - The token id to fetch authorities

 * @returns A list of authority utxos
 */
export const getAvailableAuthorities = async (
  mysql: ServerlessMysql,
  tokenId: string,
): Promise<DbTxOutput[]> => {
  /* We should set the LIMIT to a reasonable value to prevent users from abusing
   * this API by creating thousands of authority outputs and querying this
   *
   * Currently the only use for this query is on the wallet-desktop to display
   * if the token is "mintable" and/or"meltable", we don't display a list of those
   * utxos so it is safe to set this limit.
   */
  const results: DbSelectResult = await mysql.query(`
  SELECT *
    FROM tx_output
   WHERE authorities > 0
     AND token_id = ?
     AND voided = FALSE
     AND locked = FALSE
     AND spent_by IS NULL
  `, [tokenId]);

  const utxos = results.map(mapDbResultToDbTxOutput);

  return utxos;
};

/**
 * Get the number of transactions for each token from the address_tx_history table
 * given a list of transactions
 *
 * @param mysql - Database connection
 * @param txList - A list of affected transactions to get the addresses token transaction count

 * @returns A Map with address_tokenId as key and the transaction count as values
 */
export const getAffectedAddressTxCountFromTxList = async (
  mysql: ServerlessMysql,
  txList: string[],
): Promise<StringMap<number>> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT address, COUNT(DISTINCT(tx_id)) AS txCount, token_id as tokenId
      FROM address_tx_history
     WHERE tx_id IN (?)
       AND voided = TRUE
  GROUP BY address, token_id
  `, [txList]);

  const addressTransactions = results.reduce((acc, result) => {
    const address = result.address as string;
    const txCount = result.txCount as number;
    const tokenId = result.tokenId as string;

    acc[`${address}_${tokenId}`] = txCount;

    return acc;
  }, {});

  return addressTransactions as StringMap<number>;
};

/**
 * Get the number of affected transactions for each token from the address_tx_history table
 * given a list of transactions
 *
 * @param mysql - Database connection
 * @param txList - A list of affected transactions to get the token tx count

 * @returns A Map with tokenId as key and the transaction count as values
 */
export const getAffectedTokenTxCountFromTxList = async (
  mysql: ServerlessMysql,
  txList: string[],
): Promise<StringMap<number>> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT token_id AS tokenId, COUNT(DISTINCT(tx_id)) AS txCount
      FROM address_tx_history
     WHERE tx_id IN (?)
       AND voided = TRUE
  GROUP BY token_id
  `, [txList]);

  const tokenTransactions = results.reduce((acc, result) => {
    const tokenId = result.tokenId as string;
    const txCount = result.txCount as number;

    acc[tokenId] = txCount;

    return acc;
  }, {});

  return tokenTransactions as StringMap<number>;
};

/**
 * Get the affected total_received for each address/token pair given a list of transactions
 *
 * @param mysql - Database connection
 * @param txList - A list of affected transactions

 * @returns {Promise<StringMap<number>>} A Map with address_tokenId as key and the affected total_received as values
 */
export const getAffectedAddressTotalReceivedFromTxList = async (
  mysql: ServerlessMysql,
  txList: string[],
): Promise<StringMap<number>> => {
  const results: DbSelectResult = await mysql.query(`
    SELECT address, token_id as tokenId, SUM(value) as total
      FROM tx_output
     WHERE tx_id IN (?)
       AND voided = TRUE
  GROUP BY address, token_id
  `, [txList]);

  const addressTotalReceivedMap = results.reduce((acc, result) => {
    const address = result.address as string;
    const total = result.total as number;
    const tokenId = result.tokenId as string;

    acc[`${address}_${tokenId}`] = total;

    return acc;
  }, {});

  return addressTotalReceivedMap as StringMap<number>;
};

/**
 * Increment a list of tokens transactions count
 *
 * @param mysql - Database connection
 * @param tokenList - The list of tokens to increment
 */
export const incrementTokensTxCount = async (
  mysql: ServerlessMysql,
  tokenList: string[],
): Promise<void> => {
  await mysql.query(`
    UPDATE \`token\`
       SET \`transactions\` = \`transactions\` + 1
     WHERE \`id\` IN (?)
  `, [tokenList]);
};

/**
 * Verify the existence of a device registered for a given wallet.
 *
 * @param mysql - Database connection
 * @param deviceId - The device to verify existence
 * @param walletId - The wallet linked to device
 */
export const existsPushDevice = async (
  mysql: ServerlessMysql,
  deviceId: string,
  walletId: string,
) : Promise<boolean> => {
  const [{ count }] = await mysql.query(
    `
    SELECT COUNT(1) as \`count\`
      FROM \`push_devices\` pd
     WHERE device_id = ?
       AND wallet_id = ?`,
    [deviceId, walletId],
  ) as unknown as Array<{count}>;

  return count > 0;
};

/**
 * Register a device to a wallet for push notification.
 *
 * @param mysql - Database connection
 * @param input - Input of push device register
 */
export const registerPushDevice = async (
  mysql: ServerlessMysql,
  input: {
    deviceId: string,
    walletId: string,
    pushProvider: string,
    enablePush: boolean,
    enableShowAmounts: boolean,
  },
) : Promise<void> => {
  await mysql.query(
    `
    INSERT
      INTO \`push_devices\` (
           device_id
         , wallet_id
         , push_provider
         , enable_push
         , enable_show_amounts)
    VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
           updated_at = CURRENT_TIMESTAMP`,
    [input.deviceId, input.walletId, input.pushProvider, input.enablePush, input.enableShowAmounts],
  );
};

/**
 * Remove any record of push notification device given a device ID.
 *
 * @param mysql - Database connection
 * @param deviceId - The device ID
 */
export const removeAllPushDevicesByDeviceId = async (mysql: ServerlessMysql, deviceId: string): Promise<void> => {
  await mysql.query(
    `
     DELETE
       FROM \`push_devices\`
      WHERE
  device_id = ?
    `,
    [deviceId],
  );
};

/**
 * Update existing push device given a wallet.
 *
 * @param mysql - Database connection
 * @param input - Input of push device register
 */
export const updatePushDevice = async (
  mysql: ServerlessMysql,
  input: {
    deviceId: string,
    walletId: string,
    enablePush: boolean,
    enableShowAmounts: boolean,
  },
) : Promise<void> => {
  await mysql.query(
    `
    UPDATE \`push_devices\`
       SET enable_push = ?
         , enable_show_amounts = ?
     WHERE device_id = ?
       AND wallet_id = ?`,
    [input.enablePush, input.enableShowAmounts, input.deviceId, input.walletId],
  );
};

/**
 * Unregister push device for a given wallet.
 *
 * @param mysql - Database connection
 * @param deviceId - The device to unregister
 * @param walletId - The wallet linked to device
 */
export const unregisterPushDevice = async (
  mysql: ServerlessMysql,
  deviceId: string,
  walletId?: string,
) : Promise<void> => {
  if (walletId) {
    await mysql.query(
      `
      DELETE
        FROM \`push_devices\`
       WHERE device_id = ?
         AND wallet_id = ?`,
      [deviceId, walletId],
    );
  } else {
    await mysql.query(
      `
      DELETE
        FROM \`push_devices\`
       WHERE device_id = ?`,
      [deviceId],
    );
  }
};

/**
 * Get a transaction by its ID.
 *
 * @param mysql - Database connection
 * @param txId - A transaction ID
 * @param walletId - The wallet related to the transaction
 * @returns A list of tokens for a transaction if found, return an empty list otherwise
 */
export const getTransactionById = async (
  mysql: ServerlessMysql,
  txId: string,
  walletId: string,
): Promise<TxByIdToken[]> => {
  const result = await mysql.query(`
       SELECT
              transaction.tx_id AS tx_id
            , transaction.timestamp AS timestamp
            , transaction.version AS version
            , transaction.voided AS voided
            , transaction.height AS height
            , transaction.weight AS weight
            , wallet_tx_history.balance AS balance
            , wallet_tx_history.token_id AS token_id
            , token.name AS name
            , token.symbol AS symbol
         FROM wallet_tx_history
   INNER JOIN transaction ON transaction.tx_id = wallet_tx_history.tx_id
   INNER JOIN token ON wallet_tx_history.token_id = token.id
        WHERE transaction.tx_id = ?
          AND transaction.voided = FALSE
          AND wallet_tx_history.wallet_id = ?`,
  // eslint-disable-next-line camelcase
  [txId, walletId]) as Array<{tx_id, timestamp, version, voided, weight, balance, token_id, name, symbol }>;

  const txTokens = [];
  result.forEach((eachTxToken) => {
    const txToken = {
      txId: eachTxToken.tx_id,
      timestamp: eachTxToken.timestamp,
      version: eachTxToken.version,
      voided: !!eachTxToken.voided,
      weight: eachTxToken.weight,
      balance: eachTxToken.balance,
      tokenId: eachTxToken.token_id,
      tokenName: eachTxToken.name,
      tokenSymbol: eachTxToken.symbol,
    } as TxByIdToken;
    txTokens.push(txToken);
  });

  return txTokens;
};

/**
* Verify the existence of a wallet by its ID.
*
* @param mysql - Database connection
* @param walletId - The wallet linked to device
*/
export const existsWallet = async (
  mysql: ServerlessMysql,
  walletId: string,
) : Promise<boolean> => {
  const [{ count }] = (await mysql.query(
    `
    SELECT COUNT(1) as \`count\`
      FROM \`wallet\` pd
     WHERE id = ?`,
    [walletId],
  )) as unknown as Array<{ count }>;

  return count > 0;
};

/**
 * Get registered push device by deviceId.
 *
 * @param mysql - Database connection
 * @param deviceId - The device to verify existence
 */
export const getPushDevice = async (
  mysql: ServerlessMysql,
  deviceId: string,
) : Promise<PushDevice|null> => {
  const [pushDevice] = await mysql.query(
    `
    SELECT *
      FROM \`push_devices\`
     WHERE device_id = ?`,
    [deviceId],
  // eslint-disable-next-line camelcase
  ) as Array<{wallet_id, device_id, push_provider, enable_push, enable_show_amounts}>;

  if (!pushDevice) {
    return null;
  }

  return {
    walletId: pushDevice.wallet_id,
    deviceId: pushDevice.device_id,
    pushProvider: pushDevice.push_provider,
    enablePush: !!pushDevice.enable_push,
    enableShowAmounts: !!pushDevice.enable_show_amounts,
  } as PushDevice;
};

/**
 * Get a push device settings list given a list of wallet ids.
 *
 * @param mysql - Database connection
 * @param walletIdList - A list of wallet ids
 * @returns - a list of push device settings
 */
export const getPushDeviceSettingsList = async (
  mysql: ServerlessMysql,
  walletIdList: string[],
) : Promise<PushDeviceSettings[]> => {
  const pushDeviceSettingsResult = await mysql.query(
    `
    SELECT wallet_id
         , device_id
         , enable_push
         , enable_show_amounts
      FROM \`push_devices\`
     WHERE wallet_id in (?)`,
    [walletIdList],
  // eslint-disable-next-line camelcase
  ) as Array<{wallet_id, device_id, enable_push, enable_show_amounts}>;

  const pushDeviceSettignsList = pushDeviceSettingsResult.map((each) => ({
    walletId: each.wallet_id,
    deviceId: each.device_id,
    enablePush: !!each.enable_push,
    enableShowAmounts: !!each.enable_show_amounts,
  } as PushDeviceSettings));

  return pushDeviceSettignsList;
};

/**
 * Count the quantity of stale push devices from now.
 *
 * @param mysql - Database connection
 * @returns - total of stale device from now
 */
export const countStalePushDevices = async (mysql): Promise<number> => {
  const [{ count }] = await mysql.query(
    `
    SELECT COUNT(device_id) as count
      FROM \`push_devices\`
     WHERE UNIX_TIMESTAMP(updated_at) < UNIX_TIMESTAMP(date_sub(now(), interval 1 month))`,
  ) as Array<{ count }>;
  return count;
};

/**
 * Delete stale push devices from now.
 *
 * @param mysql - Database connection
 */
export const deleteStalePushDevices = async (mysql) => {
  await mysql.query(
    `
    DELETE
      FROM \`push_devices\`
     WHERE UNIX_TIMESTAMP(updated_at) < UNIX_TIMESTAMP(date_sub(now(), interval 1 month))`,
  );
};

/**
 * Get token symbol map, correlating token id to its symbol.
 *
 * @param mysql - Database connection
 * @param tokenIdList - A list of token id
 * @returns The token information (or null if id is not found)
 */
export const getTokenSymbols = async (
  mysql: ServerlessMysql,
  tokenIdList: string[],
): Promise<StringMap<string>> => {
  if (tokenIdList.length === 0) return null;

  const results: DbSelectResult = await mysql.query(
    'SELECT `id`, `symbol` FROM `token` WHERE `id` IN (?)',
    [tokenIdList],
  );

  if (results.length === 0) return null;
  return results.reduce((prev: Record<string, string>, token: { id: string, symbol: string}) => {
    // eslint-disable-next-line no-param-reassign
    prev[token.id] = token.symbol;
    return prev;
  }, {}) as unknown as StringMap<string>;
};

/**
 * Fetches all txProposals that are either in the OPEN, SEND_ERROR or CANCELLED status
 *
 * @param mysql - Database connection
 *
 * @returns The number of txProposals before a given date
 */
export const getUnsentTxProposals = async (
  mysql: ServerlessMysql,
  txProposalsBefore: number,
): Promise<string[]> => {
  const result = await mysql.query<{ id: string }[]>(
    `
    SELECT id
      FROM \`tx_proposal\`
     WHERE created_at < ?
       AND status IN (?)`,
    [txProposalsBefore, [
      TxProposalStatus.OPEN,
      TxProposalStatus.SEND_ERROR,
      TxProposalStatus.CANCELLED,
    ]],
  );

  return result.map((row) => row.id);
};

/**
 * Gets a specific address from an index and a walletId
 *
 * @param mysql - Database connection
 * @param walletId - The wallet id to search for
 * @param index - The address index to search for
 *
 * @returns An object containing the address, its index and the number of transactions
 */
export const getAddressAtIndex = async (
  mysql: ServerlessMysql,
  walletId: string,
  index: number,
): Promise<AddressInfo | null> => {
  const addresses = await mysql.query<AddressInfo[]>(
    `
    SELECT \`address\`, \`index\`, \`transactions\`
      FROM \`address\` pd
     WHERE \`index\` = ?
       AND \`wallet_id\` = ?
     LIMIT 1`,
    [walletId, index],
  );

  if (addresses.length <= 0) {
    return null;
  }

  return {
    address: addresses[0].address as string,
    index: addresses[0].index as number,
    transactions: addresses[0].transactions as number,
  } as AddressInfo;
};
