import {
  addNewAddresses,
  addUtxos,
  generateAddresses,
  getWalletAddressInfo,
  removeUtxos,
  updateAddressTables,
  updateExistingAddresses,
  updateWalletTables,
} from './db';
import { getDbConnection } from './utils';

const mysql = getDbConnection();


export const onNewTxEvent = async (event, context, callback) => {
  console.log('onNewTxEvent');
  for (let evt of event.Records) {
    await addNewTx(evt.body);
  }

  //TODO mysql.end() leaves the function hanging, at least in local environment. Some issues:
  // https://github.com/jeremydaly/serverless-mysql/issues/50
  // https://github.com/jeremydaly/serverless-mysql/issues/61
  //await mysql.end();
  await mysql.quit();

  return {
    statusCode: 200,
    body: JSON.stringify({message: 'Go Serverless v1.0! Your function executed successfully!'}),
  };
};


/*
 * Add a new transaction or block
 */
const addNewTx = async (tx) => {
  //TODO mysql error treatment

  const txId = tx.tx_id;

  // add outputs to utxo table
  await addUtxos(mysql, txId, tx.outputs);

  // remove inputs from utxo table
  await removeUtxos(mysql, tx.inputs);

  // get balance of each token for each address
  const addressBalanceMap = getAddressBalanceMap(tx);

  // update address tables (address, address_balance, address_tx_history)
  await updateAddressTables(mysql, txId, tx.timestamp, addressBalanceMap);

  // for the addresses present on the tx, check if there are any wallets associated
  const {walletAddressMap, walletInfoMap} = await getWalletAddressInfo(mysql, Object.keys(addressBalanceMap));

  // for each already started wallet, update databases
  for (const [walletId, {xpubkey, maxGap}] of Object.entries(walletInfoMap)) {
    const {existingAddresses, newAddresses} = await generateAddresses(mysql, xpubkey, maxGap);
    // might need to generate new addresses to keep maxGap
    await addNewAddresses(mysql, walletId, newAddresses);
    // update existing addresses' walletId and index
    await updateExistingAddresses(mysql, walletId, existingAddresses);
  }
  // update wallet_balance and wallet_tx_history tables
  const walletBalanceMap = getWalletBalanceMap(walletAddressMap, addressBalanceMap);
  await updateWalletTables(mysql, txId, tx.timestamp, walletBalanceMap);
};


/*
 * Given a transaction, create a map with the balance of each address and token
 *
 * {
 *   address1: {token1: balance1, token2: balance2},
 *   address2: {token1: balance3}
 * }
 */
export const getAddressBalanceMap = (tx) => {
  const addressBalanceMap = {};
  //TODO handle authority

  for (const output of tx.outputs) {
    //TODO check if output.decoded exists
    const address = output.decoded.address;
    const token = output.token;
    const value = output.value;

    // update addressBalanceMap
    const addrEntry = addressBalanceMap[address] || {[token]: 0};
    addrEntry[token] = (addrEntry[token] || 0) + value;
    addressBalanceMap[address] = addrEntry;
  };

  for (const input of tx.inputs) {
    //TODO check if input.decoded exists
    // update addressBalanceMap
    const address = input.decoded.address;
    const token = input.token;
    const addrEntry = addressBalanceMap[address] || {[token]: 0};
    addrEntry[token] = (addrEntry[token] || 0) - input.value;
    addressBalanceMap[address] = addrEntry;
  };

  return addressBalanceMap;
};


/*
 * {
 *   wallet1: {token1: balance1, token2: balance2},
 *   wallet2: {token1: balance3}
 * }
 */
export const getWalletBalanceMap = (walletAddressMap, addressBalanceMap) => {
  const mergeBalances = (balanceMap1, balanceMap2) => {
    const finalBalanceMap = Object.assign({}, balanceMap1);
    for (const [token, balance] of Object.entries(balanceMap2)) {
      finalBalanceMap[token] = (finalBalanceMap[token] || 0) + balance;
    }
    return finalBalanceMap;
  };

  const walletBalanceMap = {};
  for (const [address, balanceMap] of Object.entries(addressBalanceMap)) {
    const walletId = walletAddressMap[address];
    // if this address is not from a started wallet, ignore
    if (!walletId) continue;

    if (walletBalanceMap[walletId]) {
      // if entry exists in final object, merge balance maps
      walletBalanceMap[walletId] = mergeBalances(walletBalanceMap[walletId], balanceMap);
    } else {
      // if there's no entry yet, the final balance map is equal to the address balance map.
      // We use Object.assign() to create a copy of the object
      walletBalanceMap[walletId] = Object.assign({}, balanceMap);
    }
  }
  return walletBalanceMap;
};
