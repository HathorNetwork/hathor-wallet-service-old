import { ServerlessMysql } from 'serverless-mysql';

import {
  getAddressWalletInfo,
  getLatestHeight,
  getWalletBalances as dbGetWalletBalances,
  getWalletUnlockedUtxos,
  unlockUtxos as dbUnlockUtxos,
  updateAddressLockedBalance,
  updateWalletLockedBalance,
  getLastVersionCheck,
  updateLastVersionCheck,
} from '@src/db';
import {
  DecodedOutput,
  StringMap,
  TokenBalanceMap,
  TxInput,
  TxOutput,
  Utxo,
  Wallet,
  WalletTokenBalance,
} from '@src/types';

import { getUnixTimestamp } from '@src/utils';

import hathorLib from '@hathor/wallet-lib';

const VERSION_CHECK_MAX_DIFF = 60 * 60 * 1000; // 1 hour

/**
 * Update the unlocked/locked balances for addresses and wallets connected to the given UTXOs.
 *
 * @param mysql - Database connection
 * @param utxos - List of UTXOs that are unlocked by height
 * @param updateTimelocks - If this update is triggered by a timelock expiring, update the next lock expiration
 */
export const unlockUtxos = async (mysql: ServerlessMysql, utxos: Utxo[], updateTimelocks: boolean): Promise<void> => {
  if (utxos.length === 0) return;

  const outputs: TxOutput[] = utxos.map((utxo) => {
    const decoded: DecodedOutput = {
      type: 'P2PKH',
      address: utxo.address,
      timelock: utxo.timelock,
    };
    return {
      value: utxo.authorities > 0 ? utxo.authorities : utxo.value,
      token: utxo.tokenId,
      decoded,
      locked: false,
      // set authority bit if necessary
      token_data: utxo.authorities > 0 ? hathorLib.constants.TOKEN_AUTHORITY_MASK : 0,
      // we don't care about spent_by and script
      spent_by: null,
      script: '',
    };
  });

  // mark as unlocked in database (this just changes the 'locked' flag)
  await dbUnlockUtxos(mysql, utxos);

  const addressBalanceMap: StringMap<TokenBalanceMap> = getAddressBalanceMap([], outputs);
  // update address_balance table
  await updateAddressLockedBalance(mysql, addressBalanceMap, updateTimelocks);

  // check if addresses belong to any started wallet
  const addressWalletMap: StringMap<Wallet> = await getAddressWalletInfo(mysql, Object.keys(addressBalanceMap));

  // update wallet_balance table
  const walletBalanceMap: StringMap<TokenBalanceMap> = getWalletBalanceMap(addressWalletMap, addressBalanceMap);
  await updateWalletLockedBalance(mysql, walletBalanceMap, updateTimelocks);
};

/**
 * Mark a transaction's outputs that are locked. Modifies the outputs in place.
 *
 * @remarks
 * The timestamp is used to determine if each output is locked by time. On the other hand, `hasHeightLock`
 * applies to all outputs.
 *
 * The idea is that `hasHeightLock = true` should be used for blocks, whose outputs are locked by
 * height. Timelocks are handled by the `now` parameter.
 *
 * @param outputs - The transaction outputs
 * @param now - Current timestamp
 * @param hasHeightLock - Flag that tells if outputs are locked by height
 */
export const markLockedOutputs = (outputs: TxOutput[], now: number, hasHeightLock = false): void => {
  for (const output of outputs) {
    output.locked = false;
    if (hasHeightLock || output.decoded.timelock > now) {
      output.locked = true;
    }
  }
};

/**
 * Get the map of token balances for each address in the transaction inputs and outputs.
 *
 * @example
 * Return map has this format:
 * ```
 * {
 *   address1: {token1: balance1, token2: balance2},
 *   address2: {token1: balance3}
 * }
 * ```
 *
 * @param inputs - The transaction inputs
 * @param outputs - The transaction outputs
 * @returns A map of addresses and its token balances
 */
export const getAddressBalanceMap = (
  inputs: TxInput[],
  outputs: TxOutput[],
): StringMap<TokenBalanceMap> => {
  const addressBalanceMap = {};

  for (const input of inputs) {
    const address = input.decoded.address;

    // get the TokenBalanceMap from this input
    const tokenBalanceMap = TokenBalanceMap.fromTxInput(input);
    // merge it with existing TokenBalanceMap for the address
    addressBalanceMap[address] = TokenBalanceMap.merge(addressBalanceMap[address], tokenBalanceMap);
  }

  for (const output of outputs) {
    const address = output.decoded.address;

    // get the TokenBalanceMap from this output
    const tokenBalanceMap = TokenBalanceMap.fromTxOutput(output);

    // merge it with existing TokenBalanceMap for the address
    addressBalanceMap[address] = TokenBalanceMap.merge(addressBalanceMap[address], tokenBalanceMap);
  }

  return addressBalanceMap;
};

/**
 * Get the map of token balances for each wallet.
 *
 * @remarks
 * Different addresses can belong to the same wallet, so this function merges their
 * token balances.
 *
 * @example
 * Return map has this format:
 * ```
 * {
 *   wallet1: {token1: balance1, token2: balance2},
 *   wallet2: {token1: balance3}
 * }
 * ```
 *
 * @param addressWalletMap - Map of addresses and corresponding wallets
 * @param addressBalanceMap - Map of addresses and corresponding token balances
 * @returns A map of wallet ids and its token balances
 */
export const getWalletBalanceMap = (
  addressWalletMap: StringMap<Wallet>,
  addressBalanceMap: StringMap<TokenBalanceMap>,
): StringMap<TokenBalanceMap> => {
  const walletBalanceMap = {};
  for (const [address, balanceMap] of Object.entries(addressBalanceMap)) {
    const wallet = addressWalletMap[address];
    const walletId = wallet && wallet.walletId;

    // if this address is not from a started wallet, ignore
    if (!walletId) continue;

    walletBalanceMap[walletId] = TokenBalanceMap.merge(walletBalanceMap[walletId], balanceMap);
  }
  return walletBalanceMap;
};

/**
 * Get a wallet's balance, taking into account any existing timelocks.
 *
 * @remarks
 * If any timelock has expired, database tables will be refreshed before returning the balances.
 *
 * @param mysql - Database connection
 * @param now - Current timestamp
 * @param walletId - The wallet id
 * @param tokenIds - A list of token ids
 */
export const getWalletBalances = async (
  mysql: ServerlessMysql,
  now: number,
  walletId: string,
  tokenIds: string[] = [],
): Promise<WalletTokenBalance[]> => {
  let balances = await dbGetWalletBalances(mysql, walletId, tokenIds);

  // if any of the balances' timelock has expired, update the tables before returning
  const refreshBalances = balances.some((tb) => {
    if (tb.balance.lockExpires && tb.balance.lockExpires <= now) {
      return true;
    }
    return false;
  });

  if (refreshBalances) {
    const currentHeight = await getLatestHeight(mysql);
    const utxos = await getWalletUnlockedUtxos(mysql, walletId, now, currentHeight);
    await unlockUtxos(mysql, utxos, true);
    balances = await dbGetWalletBalances(mysql, walletId, tokenIds);
  }
  return balances;
};

/**
 * Updates the wallet-lib constants if needed.
 *
 * @returns A promise that resolves when the wallet-lib constants have been set.
 */
export const maybeRefreshWalletConstants = async (mysql: ServerlessMysql) => {
  const lastVersionCheck = await getLastVersionCheck(mysql);
  const now = getUnixTimestamp();

  if (now - lastVersionCheck > VERSION_CHECK_MAX_DIFF) {
    // Query and update versions
    await hathorLib.version.checkApiVersion();
    await updateLastVersionCheck(mysql, now);

    // TODO: Maybe when checkApiVersion fails we could use the current values on
    // the wallet instead of propagating the error
  }
};
