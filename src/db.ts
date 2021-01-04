/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { strict as assert } from 'assert';
import { ServerlessMysql } from 'serverless-mysql';
import hathorLib from '@hathor/wallet-lib';

import {
  AddressIndexMap,
  AddressInfo,
  Authorities,
  Balance,
  DbSelectResult,
  GenerateAddresses,
  StringMap,
  TokenBalanceMap,
  TokenInfo,
  TxInput,
  TxOutput,
  TxTokenBalance,
  Utxo,
  Wallet,
  WalletStatus,
  WalletTokenBalance,
} from '@src/types';

import { getUnixTimestamp, isAuthority } from '@src/utils';

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
  let highestCheckedIndex = -1;
  let highestUsedIndex = -1;
  const existingAddresses: AddressIndexMap = {};
  const newAddresses: AddressIndexMap = {};
  const allAddresses: string[] = [];

  do {
    const addrMap = hathorLib.helpers.getAddresses(xpubkey, highestCheckedIndex + 1, maxGap, 'mainnet');
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
      if (entry.transactions > 0 && index > highestUsedIndex) {
        highestUsedIndex = index;
      }

      delete addrMap[address];
    }

    highestCheckedIndex += maxGap;
    Object.assign(newAddresses, addrMap);
  } while (highestUsedIndex + maxGap > highestCheckedIndex);

  // we probably generated more addresses than needed, as we always generate
  // addresses in maxGap blocks
  const totalAddresses = highestUsedIndex + maxGap + 1;
  for (const [address, index] of Object.entries(newAddresses)) {
    if (index > highestUsedIndex + maxGap) {
      delete newAddresses[address];
    }
  }

  return {
    addresses: allAddresses.slice(0, totalAddresses),
    newAddresses,
    existingAddresses,
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
    return {
      walletId,
      xpubkey: result.xpubkey as string,
      status: result.status as WalletStatus,
      maxGap: result.max_gap as number,
      createdAt: result.created_at as number,
      readyAt: result.ready_at as number,
    };
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
  maxGap: number,
): Promise<Wallet> => {
  const ts = getUnixTimestamp();
  const entry = { id: walletId, xpubkey, status: WalletStatus.CREATING, created_at: ts, max_gap: maxGap };
  await mysql.query(
    `INSERT INTO \`wallet\`
        SET ?`,
    [entry],
  );
  return {
    walletId,
    xpubkey,
    maxGap,
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
): Promise<void> => {
  const ts = getUnixTimestamp();
  await mysql.query(
    'UPDATE `wallet` SET `status` = ?, `ready_at` = ? WHERE `id`= ?',
    [status, ts, walletId],
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
export const addNewAddresses = async (mysql: ServerlessMysql, walletId: string, addresses: AddressIndexMap): Promise<void> => {
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
      WHERE \`address\`
         IN (?)
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
    balanceEntries.push([walletId, row1.token_id, row1.unlocked_balance, row1.locked_balance, row1.timelock_expires, row2.transactions]);
  }
  if (balanceEntries.length > 0) {
    await mysql.query(
      `INSERT INTO \`wallet_balance\`(\`wallet_id\`, \`token_id\`,
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
        unlocked_balance: (tokenBalance.unlockedAmount < 0 ? 0 : tokenBalance.unlockedAmount),
        locked_balance: tokenBalance.lockedAmount,
        unlocked_authorities: Math.abs(tokenBalance.unlockedAuthorities.toInteger()),
        locked_authorities: Math.abs(tokenBalance.lockedAuthorities.toInteger()),
        timelock_expires: tokenBalance.lockExpires,
        transactions: 1,
      };
      // save the smaller value of timelock_expires, when not null
      await mysql.query(
        `INSERT INTO wallet_balance
            SET ?
             ON DUPLICATE KEY
         UPDATE unlocked_balance = unlocked_balance + ?,
                locked_balance = locked_balance + ?,
                transactions = transactions + 1,
                timelock_expires = CASE WHEN timelock_expires IS NULL THEN VALUES(timelock_expires)
                                        WHEN VALUES(timelock_expires) IS NULL THEN timelock_expires
                                        ELSE LEAST(timelock_expires, VALUES(timelock_expires))
                                   END,
                unlocked_authorities = (unlocked_authorities | VALUES(unlocked_authorities)),
                locked_authorities = locked_authorities | VALUES(locked_authorities)`,
        [entry, tokenBalance.unlockedAmount, tokenBalance.lockedAmount, walletId, token],
      );

      // same logic here as in the updateAddressTablesWithTx function
      if (tokenBalance.unlockedAuthorities.hasNegativeValue()) {
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
  outputs: TxOutput[],
  heightlock: number = null): Promise<void> => {
  // outputs might be empty if we're destroying authorities
  if (outputs.length === 0) return;

  const entries = outputs.map(
    (output, index) => {
      let authorities = 0;
      let value = output.value;

      if (isAuthority(output.token_data)) {
        authorities = value;
        value = 0;
      }

      return [
        txId,
        index,
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

  await mysql.query(
    `INSERT INTO \`utxo\` (\`tx_id\`, \`index\`, \`token_id\`,
                           \`value\`, \`authorities\`, \`address\`,
                           \`timelock\`, \`heightlock\`, \`locked\`)
     VALUES ?`,
    [entries],
  );
};

/**
 * Remove a tx inputs from the utxo table.
 *
 * @param mysql - Database connection
 * @param inputs - The transaction inputs
 */
export const removeUtxos = async (mysql: ServerlessMysql, inputs: TxInput[]): Promise<void> => {
  const entries = inputs.map((input) => [input.tx_id, input.index]);
  // entries might be empty if there are no inputs
  if (entries.length) {
    // get the rows before deleting
    await mysql.query(
      `DELETE
         FROM \`utxo\`
        WHERE (\`tx_id\` ,\`index\`)
           IN (?)`,
      [entries],
    );
  }
};

/**
 * Mark UTXOs as unlocked.
 *
 * @param mysql - Database connection
 * @param utxos - List of UTXOs to unlock
 */
export const unlockUtxos = async (mysql: ServerlessMysql, utxos: Utxo[]): Promise<void> => {
  if (utxos.length === 0) return;
  const entries = utxos.map((utxo) => [utxo.txId, utxo.index]);
  await mysql.query(
    `UPDATE \`utxo\`
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
export const getLockedUtxoFromInputs = async (mysql: ServerlessMysql, inputs: TxInput[]): Promise<Utxo[]> => {
  const entries = inputs.map((input) => [input.tx_id, input.index]);
  // entries might be empty if there are no inputs
  if (entries.length) {
    // get the rows before deleting
    const results: DbSelectResult = await mysql.query(
      `SELECT *
         FROM \`utxo\`
        WHERE (\`tx_id\` ,\`index\`)
           IN (?)
          AND \`locked\` = TRUE`,
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
        // if it's < 0, there must be an entry already, so it will execute "ON DUPLICATE KEY UPDATE" instead of setting it to 0
        unlocked_balance: (tokenBalance.unlockedAmount < 0 ? 0 : tokenBalance.unlockedAmount),
        // this is never less than 0, as locked balance only changes when a tx is unlocked
        locked_balance: tokenBalance.lockedAmount,
        unlocked_authorities: Math.abs(tokenBalance.unlockedAuthorities.toInteger()),
        locked_authorities: Math.abs(tokenBalance.lockedAuthorities.toInteger()),
        timelock_expires: tokenBalance.lockExpires,
        transactions: 1,
      };
      // save the smaller value of timelock_expires, when not null
      await mysql.query(
        `INSERT INTO address_balance
                 SET ?
                  ON DUPLICATE KEY
                            UPDATE unlocked_balance = unlocked_balance + ?,
                                   locked_balance = locked_balance + ?,
                                   transactions = transactions + 1,
                                   timelock_expires = CASE
                                                        WHEN timelock_expires IS NULL THEN VALUES(timelock_expires)
                                                        WHEN VALUES(timelock_expires) IS NULL THEN timelock_expires
                                                        ELSE LEAST(timelock_expires, VALUES(timelock_expires))
                                                      END,
                                   unlocked_authorities = (unlocked_authorities | VALUES(unlocked_authorities)),
                                   locked_authorities = locked_authorities | VALUES(locked_authorities)`,
        [entry, tokenBalance.unlockedAmount, tokenBalance.lockedAmount, address, token],
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
                  FROM \`utxo\`
                 WHERE \`address\` = ?
                   AND \`token_id\` = ?
                   AND \`locked\` = FALSE
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
                  FROM \`utxo\`
                 WHERE \`address\` = ?
                   AND \`token_id\` = ?
                   AND \`locked\` = TRUE)
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
                 FROM \`utxo\`
                WHERE \`address\` = ?
                  AND \`token_id\` = ?
                  AND \`locked\` = TRUE
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
 * @returns A list of addresses and their info (index and transactions)
 */
export const getWalletAddresses = async (mysql: ServerlessMysql, walletId: string): Promise<AddressInfo[]> => {
  const addresses: AddressInfo[] = [];
  const results: DbSelectResult = await mysql.query(`
    SELECT *
      FROM \`address\`
     WHERE \`wallet_id\` = ?
  ORDER BY \`index\`
       ASC`, walletId);
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
 * Get a wallet's balances.
 *
 * @remarks
 * If a tokenId is given, get the balance for just that token (and return a list with 1 element).
 *
 * @param mysql - Database connection
 * @param walletId - Wallet id
 * @param tokenId - Token id
 * @returns A list of balances.
 */
export const getWalletBalances = async (mysql: ServerlessMysql, walletId: string, tokenId: string = null): Promise<WalletTokenBalance[]> => {
  const balances: WalletTokenBalance[] = [];
  let subquery = `
    SELECT *
      FROM \`wallet_balance\`
     WHERE \`wallet_id\` = ?`;

  const params = [walletId];
  if (tokenId !== null) {
    subquery += ' AND `token_id` = ?';
    params.push(tokenId);
  }

  // use LEFT JOIN as HTR token ('00') won't be on the token table, so INNER JOIN would never match it
  const query = `SELECT * FROM (${subquery}) w LEFT JOIN token ON w.token_id = token.id;`;

  const results: DbSelectResult = await mysql.query(query, params);
  for (const result of results) {
    const unlockedBalance = result.unlocked_balance as number;
    const lockedBalance = result.locked_balance as number;
    const unlockedAuthorities = new Authorities(result.unlocked_authorities as number);
    const lockedAuthorities = new Authorities(result.locked_authorities as number);
    const timelockExpires = result.timelock_expires as number;

    const balance = new WalletTokenBalance(
      new TokenInfo(result.token_id as string, result.name as string, result.symbol as string),
      new Balance(unlockedBalance, lockedBalance, timelockExpires, unlockedAuthorities, lockedAuthorities),
      result.transactions as number,
    );
    balances.push(balance);
  }
  return balances;
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
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`wallet_tx_history\`
      WHERE \`wallet_id\` = ?
        AND \`token_id\` = ?
   ORDER BY \`timestamp\`
       DESC
      LIMIT ?, ?`,
    [walletId, tokenId, skip, count],
  );
  for (const result of results) {
    const tx: TxTokenBalance = {
      txId: <string>result.tx_id,
      timestamp: <number>result.timestamp,
      balance: <Balance>result.balance,
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
): Promise<Utxo[]> => {
  const utxos = [];
  if (height >= 0) {
    const results: DbSelectResult = await mysql.query(
      `SELECT *
         FROM \`utxo\`
        WHERE \`heightlock\` <= ?
          AND (\`timelock\` <= ?
               OR \`timelock\` is NULL)
          AND \`locked\` = 1`,
      [height, now],
    );
    for (const result of results) {
      const utxo: Utxo = {
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
): Promise<Utxo[]> => {
  const utxos = [];
  const results: DbSelectResult = await mysql.query(
    `SELECT *
       FROM \`utxo\`
      WHERE (\`heightlock\` <= ?
             OR \`heightlock\` is NULL)
        AND (\`timelock\` <= ?
             OR \`timelock\` is NULL)
        AND \`locked\` = 1
        AND \`address\` IN (
          SELECT \`address\`
            FROM \`address\`
           WHERE \`wallet_id\` = ?)`,
    [currentHeight, now, walletId],
  );
  for (const result of results) {
    const utxo: Utxo = {
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
 * Update height info on database, if given value is larger than the stored one.
 *
 * @param mysql - Database connection
 * @param height - The block height
 */
export const maybeUpdateLatestHeight = async (mysql: ServerlessMysql, height: number): Promise<void> => {
  const entry = { key: 'height', value: height };
  await mysql.query(
    'INSERT INTO `metadata` SET ? ON DUPLICATE KEY UPDATE `value` = GREATEST(`value`, VALUES(`value`))',
    [entry],
  );
};

/**
 * Get height info from database.
 *
 * @param mysql - Database connection
 * @returns The latest height
 */
export const getLatestHeight = async (mysql: ServerlessMysql): Promise<number> => {
  const results: DbSelectResult = await mysql.query('SELECT * FROM `metadata` WHERE `key` = \'height\'');
  if (results.length > 0) {
    return results[0].value as number;
  }
  // it should never come here, as genesis block should be added at startup
  return 0;
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
