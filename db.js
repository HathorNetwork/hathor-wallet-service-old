import { getHathorAddresses, getUnixTimestamp } from './utils';


/*
 * Given an xpubkey, generate all its addresses and check which are used, taking into account
 * the maximum gap of unused addresses (maxGap). It doesn't update anything on the
 * database, just access some tables.
 *
 * Returns an object {highestUsedIndex, addresses, existingAddresses, newAddresses},
 * where existingAddresses, newAddresses are dicts {address: index}
 */
export const generateAddresses = async (mysql, xpubkey, maxGap) => {
  let highestCheckedIndex = -1;
  let highestUsedIndex = -1;
  const existingAddresses = {};
  const newAddresses = {};
  const allAddresses = [];
  do {
    const addrMap = getHathorAddresses(xpubkey, highestCheckedIndex + 1, maxGap);
    allAddresses.push(...Object.keys(addrMap));

    const results = await mysql.query(
      'SELECT `address`, `index`, `transactions` FROM `address` WHERE `address` IN (?)',
      [Object.keys(addrMap)]
    );
    for (const entry of results) {
      const address = entry.address;
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
  for (let [address, index] of Object.entries(newAddresses)) {
    if (index > highestUsedIndex + maxGap) {
      delete newAddresses[address];
    }
  }

  return {
    highestUsedIndex,
    addresses: allAddresses.slice(0, totalAddresses),
    newAddresses,
    existingAddresses,
  };
};

/*
 * For each address in the list, check if it's from a started wallet and return its id and xpubkey. If
 * address is not from a started wallet, it won't be on the final map
 *
 * Returns:
 *   walletAddressMap: {address: walletId}
 *   walletInfoMap: {walletId: {xpubkey, maxGap}}
 */
export const getWalletAddressInfo = async (mysql, addresses) => {
  const walletAddressMap = {};
  const walletInfoMap = {};
  const results = await mysql.query(
    'SELECT DISTINCT a.`address`, a.`wallet_id`, w.`xpubkey`, w.`max_gap` FROM `address` a INNER JOIN `wallet` w ON a.wallet_id = w.id WHERE a.`address` IN (?)',
    [addresses]
  );
  for (const entry of results) {
    walletAddressMap[entry.address] = entry.wallet_id;
    if (walletInfoMap[entry.wallet_id]) {
      walletInfoMap[entry.wallet_id]['addresses'].push(entry.address);
    } else {
      walletInfoMap[entry.wallet_id] = {xpubkey: entry.xpubkey, maxGap: entry.max_gap, addresses: [entry.address]};
    }
  }
  return {walletAddressMap, walletInfoMap};
};

/*
 * Returns the wallet status or null if wallet is not created yet
 */
export const getWalletStatus = async (mysql, walletId) => {
  const results = await mysql.query('SELECT * FROM `wallet` WHERE `id` = ?', walletId);
  if (results.length) {
    const result = results[0];
    return {
      xpubkey: result.xpubkey,
      status: result.status,
      maxGap: result.max_gap,
      createdAt: result.created_at,
      readyAt: result.ready_at,
    };
  } else {
    return null;
  }
};

/*
 * Add new wallet entry or update existing wallet's status
 */
export const updateWalletStatus = async (mysql, walletId, status, xpubkey, maxGap) => {
  const ts = getUnixTimestamp();
  if (status === 'creating') {
    const entry = {id: walletId, xpubkey, status, created_at: ts, max_gap: maxGap};
    await mysql.query(
      'INSERT INTO `wallet` SET ?',
      [entry]
    );
  } else if (status === 'ready') {
    await mysql.query(
      'UPDATE `wallet` SET `status` = ?, `ready_at` = ? WHERE `id`= ?',
      [status, ts, walletId]
    );
  }
  //TODO treat other/unknown status
};

/*
 * Add new addresses to address table, with given walletId and 0 transactions
 */
export const addNewAddresses = async (mysql, walletId, addresses) => {
  if (Object.keys(addresses).length === 0) return;
  const entries = [];
  for (const [address, index] of Object.entries(addresses)) {
    entries.push([address, index, walletId, 0]);
  }
  await mysql.query(
    'INSERT INTO `address`(`address`, `index`, `wallet_id`, `transactions`) VALUES ?',
    [entries]
  );
};

/*
 * Add walletId to the given addresses
 */
export const updateExistingAddresses = async (mysql, walletId, addresses) => {
  if (Object.keys(addresses).length === 0) return;

  for (const [address, index] of Object.entries(addresses)) {
    await mysql.query(
      'UPDATE `address` SET `wallet_id` = ?, `index` = ? WHERE `address` = ?',
      [walletId, index, address]
    );
  }
};

/*
 * Add entries to wallet_tx_history table, using data from address_tx_history
 */
export const initWalletTxHistory = async (mysql, walletId, addresses) => {
  if (addresses.length === 0) return;

  const results = await mysql.query(
    'SELECT `tx_id`, `token_id`, SUM(`balance`) AS balance, `timestamp` FROM `address_tx_history` WHERE `address` IN (?) GROUP BY `tx_id`, `token_id`, `timestamp`',
    [addresses]
  );
  if (results.length === 0) return;

  const walletTxHistory = [];
  for (let row of results) {
    walletTxHistory.push([walletId, row.token_id, row.tx_id, row.balance, row.timestamp]);
  }
  await mysql.query(
    'INSERT INTO `wallet_tx_history`(`wallet_id`, `token_id`, `tx_id`, `balance`, `timestamp`) VALUES ?',
    [walletTxHistory]
  );
};

/*
 * Create a wallet's balance, using data from address_tx_history table
 */
export const initWalletBalance = async (mysql, walletId, addresses) => {
  // XXX we could also do a join between address and address_tx_history tables so we don't
  // need to receive the addresses, but the caller probably has this info already
  const results = await mysql.query(
    'SELECT `token_id`, SUM(`balance`) as `balance`, COUNT(DISTINCT `tx_id`) as `transactions` FROM `address_tx_history` WHERE `address` in (?) GROUP BY `token_id`',
    [addresses]
  );
  if (results.length > 0) {
    const balanceEntries = [];
    for (let row of results) {
      balanceEntries.push([walletId, row.token_id, row.balance, row.transactions]);
    }
    await mysql.query(
      'INSERT INTO `wallet_balance`(`wallet_id`, `token_id`, `balance`, `transactions`) VALUES ?',
      [balanceEntries]
    );
  }
};

/*
 * Update a wallet's balance and tx history
 */
export const updateWalletTables = async (mysql, txId, timestamp, walletBalanceMap) => {
  const entries = [];
  for (const [walletId, tokenMap] of Object.entries(walletBalanceMap)) {
    for (const [token, tokenBalance] of Object.entries(tokenMap)) {
      // on wallet_balance table, balance cannot be negative (it's unsigned). That's why we use
      // balance as (tokenBalance < 0 ? 0 : tokenBalance). In case the balance is negative, there
      // must necessarily be an entry already and we'll fall on the ON DUPLICATE KEY case, so the
      // entry value won't be used. We'll just update balance = balance + tokenBalance
      const entry = {wallet_id: walletId, token_id: token, balance: (tokenBalance < 0 ? 0 : tokenBalance), transactions: 1};
      await mysql.query(
        'INSERT INTO `wallet_balance` SET ? ON DUPLICATE KEY UPDATE balance = balance + ?, transactions = transactions + 1',
        [entry, tokenBalance]
      );
      entries.push([walletId, token, txId, tokenBalance, timestamp]);
    }
  }
  if (entries.length > 0) {
    await mysql.query(
      'INSERT INTO `wallet_tx_history`(`wallet_id`, `token_id`, `tx_id`, `balance`, `timestamp`) VALUES ?',
      [entries]
    );
  }
};

/*
 * Add a tx outputs to the utxo table
 */
export const addUtxos = async (mysql, txId, outputs) => {
  //TODO handle authority
  const entries = outputs.map((output, index) => [txId, index, output.token, output.value, output.decoded.address, output.decoded.timelock]);
  await mysql.query(
    'INSERT INTO `utxo`(`tx_id`, `index`, `token_id`, `value`, `address`, `timelock`) VALUES ?',
    [entries]
  );
};

/*
 * Remove a tx inputs from utxo table
 */
export const removeUtxos = async (mysql, inputs) => {
  //TODO handle authority
  const entries = inputs.map(input => [input.tx_id, input.index]);
  if (entries.length) {
    // entries might be empty if there are no inputs
    await mysql.query(
      'DELETE FROM `utxo` WHERE (`tx_id` ,`index`) IN (?)',
      [entries]
    );
  }
};

/*
 * update address, address_balance and address_tx_history tables with addressMap
 */
export const updateAddressTables = async (mysql, txId, timestamp, addressBalanceMap) => {
  /*
   * update address table
   *
   * If an address is not yet present, add entry with index = null, walletId = null and transactions = 1.
   * Later, when the corresponding wallet is started, index and walletId will be updated.
   *
   * If address is already present, just increment the transactions counter.
   */
  const addressEntries = Object.keys(addressBalanceMap).map(address => [address, 1]);
  await mysql.query(
    'INSERT INTO `address`(`address`, `transactions`) VALUES ? ON DUPLICATE KEY UPDATE transactions = transactions + 1',
    [addressEntries]
  );

  const entries = [];
  for (const [address, tokenMap] of Object.entries(addressBalanceMap)) {
    for (const [token, tokenBalance] of Object.entries(tokenMap)) {
      // update address_balance table or update balance and transactions if there's an entry already
      //
      //
      const entry = {address, token_id: token, balance: (tokenBalance < 0 ? 0 : tokenBalance), transactions: 1};
      await mysql.query(
        'INSERT INTO `address_balance` SET ? ON DUPLICATE KEY UPDATE balance = balance + ?, transactions = transactions + 1',
        [entry, tokenBalance]
      );

      // update address_tx_history with one entry for each pair (address, token)
      entries.push([address, txId, token, tokenBalance, timestamp]);
    }
  }
  await mysql.query(
    'INSERT INTO `address_tx_history`(`address`, `tx_id`, `token_id`, `balance`, `timestamp`) VALUES ?',
    [entries]
  );
};

/*
 * Returns a wallet's addresses
 */
export const getWalletAddresses = async (mysql, walletId) => {
  const addresses = [];
  const results = await mysql.query('SELECT * FROM `address` WHERE `wallet_id` = ? ORDER BY `index` ASC', walletId);
  for (const result of results) {
    const address = {
      address: result.address,
      index: result.index,
      transactions: result.transactions,
    };
    addresses.push(address);
  }
  return addresses;
};

/*
 * Returns a wallet's balances. If a tokenId is given, only fetch for the that token
 */
export const getWalletBalances = async (mysql, walletId, tokenId = null) => {
  const balances = [];
  let query = 'SELECT * FROM `wallet_balance` WHERE `wallet_id` = ?';
  const params = [walletId];
  if (tokenId !== null) {
    query += ' AND `token_id` = ?';
    params.push(tokenId);
  }

  const results = await mysql.query(query, params);
  for (const result of results) {
    const balance = {
      tokenId: result.token_id,
      balance: result.balance,
      transactions: result.transactions,
    };
    balances.push(balance);
  }
  return balances;
};

/*
 * Returns a wallet's transaction history, for a given token
 */
export const getWalletTxHistory = async (mysql, walletId, tokenId, skip, count) => {
  const history = [];
  const results = await mysql.query(
    'SELECT * FROM `wallet_tx_history` WHERE `wallet_id` = ? AND `token_id` = ? ORDER BY `timestamp` DESC LIMIT ?, ?',
    [walletId, tokenId, skip, count]
  );
  for (const result of results) {
    const tx = {
      txId: result.tx_id,
      timestamp: result.timestamp,
      balance: result.balance,
    };
    history.push(tx);
  }
  return history;
};
