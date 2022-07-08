/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash, HexBase64Latin1Encoding } from 'crypto';

import serverlessMysql, { ServerlessMysql } from 'serverless-mysql';
import hathorLib from '@hathor/wallet-lib';
import fullnode from '@src/fullnode';
import * as bitcoin from 'bitcoinjs-lib';
import * as bitcoinMessage from 'bitcoinjs-message';
import * as ecc from 'tiny-secp256k1';
import BIP32Factory from 'bip32';
import axios from 'axios';

const bip32 = BIP32Factory(ecc);

/* TODO: We should remove this as soon as the wallet-lib is refactored
*  (https://github.com/HathorNetwork/hathor-wallet-lib/issues/122)
*/
export class CustomStorage {
  store: unknown;

  constructor() {
    this.preStart();
  }

  getItem(key: string): string {
    return this.store[key];
  }

  setItem(key: string, value: string): string {
    this.store[key] = value;

    return value;
  }

  removeItem(key: string): string {
    delete this.store[key];

    return key;
  }

  clear(): void {
    this.store = {};
  }

  preStart(): void {
    this.store = {
      'wallet:server': process.env.DEFAULT_SERVER || hathorLib.constants.DEFAULT_SERVER,
      'wallet:defaultServer': process.env.DEFAULT_SERVER || hathorLib.constants.DEFAULT_SERVER,
    };
  }
}

hathorLib.network.setNetwork(process.env.NETWORK);
hathorLib.storage.setStore(new CustomStorage());

const libNetwork = hathorLib.network.getNetwork();
const hathorNetwork = {
  messagePrefix: '\x18Hathor Signed Message:\n',
  bech32: hathorLib.network.bech32prefix,
  bip32: {
    public: libNetwork.xpubkey,
    private: libNetwork.xprivkey,
  },
  pubKeyHash: libNetwork.pubkeyhash,
  scriptHash: libNetwork.scripthash,
  wif: libNetwork.privatekey,
};

/**
 * Calculate the double sha256 hash of the data.
 *
 * @remarks
 * If encoding is provided a string will be returned; otherwise a Buffer is returned.
 *
 * @param data - Data to be hashed
 * @param encoding - The encoding of the returned object
 * @returns The sha256d hash of the data
 */
export const sha256d = (data: string, encoding: HexBase64Latin1Encoding): string => {
  const hash1 = createHash('sha256');
  hash1.update(data);
  const hash2 = createHash('sha256');
  hash2.update(hash1.digest());
  return hash2.digest(encoding);
};

/**
 * Get the wallet id given the xpubkey.
 *
 * @param xpubkey - The xpubkey
 * @returns The wallet id
 */
export const getWalletId = (xpubkey: string): string => (
  sha256d(xpubkey, 'hex')
);

/**
 * Get the current Unix timestamp, in seconds.
 *
 * @returns The current Unix timestamp in seconds
 */
export const getUnixTimestamp = (): number => (
  Math.round((new Date()).getTime() / 1000)
);

/**
 * Get a database connection.
 *
 * @returns The database connection
 */
export const getDbConnection = (): ServerlessMysql => (
  serverlessMysql({
    config: {
      host: process.env.DB_ENDPOINT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      port: parseInt(process.env.DB_PORT, 10),
      // TODO if not on local env, get IAM token
      // https://aws.amazon.com/blogs/database/iam-role-based-authentication-to-amazon-aurora-from-serverless-applications/
      password: process.env.DB_PASS,
    },
  })
);

export const closeDbConnection = async (mysql: ServerlessMysql): Promise<void> => {
  if (process.env.STAGE === 'local') {
    // mysql.end() leaves the function hanging in the local environment. Some issues:
    // https://github.com/jeremydaly/serverless-mysql/issues/61
    // https://github.com/jeremydaly/serverless-mysql/issues/79
    //
    // It seems that's the expected behavior for local environment:
    // https://github.com/serverless/serverless/issues/470#issuecomment-205372006
    await mysql.quit();
  } else {
    await mysql.end();
  }
};

export const isAuthority = (tokenData: number): boolean => (
  (tokenData & hathorLib.constants.TOKEN_AUTHORITY_MASK) > 0    // eslint-disable-line no-bitwise
);

/**
 * Shuffle an array in place.
 *
 * @remarks
 * Got it from https://stackoverflow.com/a/6274381.
 *
 * @param array - An array containing the items
 */
export const arrayShuffle = <T extends unknown>(array: T[]): T[] => {
  /* eslint-disable no-param-reassign */
  let j;
  let x;
  let i;
  for (i = array.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    x = array[i];
    array[i] = array[j];
    array[j] = x;
  }
  return array;
  /* eslint-enable no-param-reassign */
};

/**
 * Requests the fullnode for the requested transaction information and returns
 * if it is voided or not and the downloaded object
 *
 * @param txId - The transaction id
 *
 * @returns A tuple with the result and the downloaded transaction
 */
export const isTxVoided = async (txId: string): Promise<[boolean, any]> => {
  const transaction = await fullnode.downloadTx(txId);

  if (!transaction.meta.voided_by || transaction.meta.voided_by.length === 0) {
    return [false, transaction];
  }

  return [true, transaction];
};

/**
 * Requests the fullnode for a block and returns a tuple with the height and the
 * downloaded block
 *
 * @param txId - The transaction id
 *
 * @returns A tuple with the result and the downloaded transaction
 */
export const fetchBlockHeight = async (txId: string): Promise<[number, any]> => {
  const transaction = await fullnode.downloadTx(txId);

  if (!transaction.tx.height) {
    console.error(JSON.stringify(transaction));
    throw new Error(`Block ${txId} has no height.`);
  }

  return [transaction.tx.height, transaction];
};

/**
 * Creates default address path from address index
 *
 * @returns {string} The address path
 */
export const getAddressPath = (index: number): string => (
  `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/${index}`
);

/**
 * Verifies that the expected first address (received as a param) is the same as one
 * derived from the xpubkey param on the change 0 path
 *
 * @param expectedFirstAddress - The expected first address
 * @param xpubkey - The xpubkey to derive the change 0 path
 *
 * @returns A tuple with the first value being the result of the comparison and the second value the firstAddress derived
 */
export const confirmFirstAddress = (expectedFirstAddress: string, xpubkey: string): [boolean, string] => {
  // First derive xpub to change 0 path
  const derivedXpub = xpubDeriveChild(xpubkey, 0);
  // Then get first address
  const firstAddress = getAddressAtIndex(derivedXpub, 0);

  return [
    firstAddress === expectedFirstAddress,
    firstAddress,
  ];
};

/**
 * A constant for the max shift for the timestamp used in auth
 */
export const AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS = 30;

/**
 * Verifies that the timestamp has not shifted for more than AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS
 *
 * @param timestamp - The timestamp to check, in **seconds**
 * @param now - The current timestamp
 *
 * @returns A tuple with the first value being the result of the comparison and the second value the firstAddress derived
 */
export const validateAuthTimestamp = (timestamp: number, now: number): [boolean, number] => {
  const timestampShiftInSeconds = Math.floor(Math.abs(now - timestamp));

  return [timestampShiftInSeconds < AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS, timestampShiftInSeconds];
};

/**
 * Returns an address from a xpubkey on a specific index
 *
 * @param xpubkey - The xpubkey
 * @param index - The address index to derive
 *
 * @returns The derived address
 */
export const getAddressAtIndex = (xpubkey: string, addressIndex: number): string => {
  const node = bip32.fromBase58(xpubkey).derive(addressIndex);
  return bitcoin.payments.p2pkh({
    pubkey: node.publicKey,
    network: hathorNetwork,
  }).address;
};

/**
 * Get Hathor addresses in bulk, passing the start index and quantity of addresses to be generated
 *
 * @example
 * ```
 * getAddresses('myxpub', 2, 3) => {
 *   'address2': 2,
 *   'address3': 3,
 *   'address4': 4,
 * }
 * ```
 *
 * @param xpubkey The xpubkey
 * @param startIndex Generate addresses starting from this index
 * @param quantity Amount of addresses to generate
 *
 * @return An object with the generated addresses and corresponding index (string => number)
 *
 * @memberof Wallet
 * @inner
 */
export const getAddresses = (xpubkey: string, startIndex: number, quantity: number): {[key: string]: number} => {
  const addrMap = {};

  for (let index = startIndex; index < startIndex + quantity; index++) {
    const address = getAddressAtIndex(xpubkey, index);
    addrMap[address] = index;
  }

  return addrMap;
};

/**
 * Derives a xpubkey at a specific index
 *
 * @param xpubkey - The xpubkey
 * @param index - The index to derive
 *
 * @returns The derived xpubkey
 */
export const xpubDeriveChild = (xpubkey: string, index: number): string => (
  bip32.fromBase58(xpubkey).derive(index).toBase58()
);

/**
 * Verify a signature for a given timestamp and xpubkey
 *
 * @param signature - The signature done by the xpriv of the wallet
 * @param timestamp - Unix Timestamp of the signature
 * @param address - The address of the xpubkey used to create the walletId
 * @param walletId - The walletId, a sha512d of the xpubkey
 *
 * @returns true if the signature matches the other params
 */
export const verifySignature = (
  signature: string,
  timestamp: number,
  address: string,
  walletId: string,
): boolean => {
  try {
    const message = String(timestamp).concat(walletId).concat(address);

    return bitcoinMessage.verify(message, address, Buffer.from(signature, 'base64'));
  } catch (e) {
    // Since this will try to verify the signature passing user input, the verify method might
    // throw, we can just return false in this case.
    return false;
  }
};

/**
 * Returns an address (as a string) from a string xpubkey
 *
 * @param xpubkey - The xpubkey
 *
 * @returns the address derived from the xpubkey
 */
export const getAddressFromXpub = (xpubkey: string): string => {
  const node = bip32.fromBase58(xpubkey);

  return bitcoin.payments.p2pkh({
    pubkey: node.publicKey,
    network: hathorNetwork,
  }).address;
};

/**
 * A helper for reading, generating and updating a NFT Token's metadata.
 *
 * @todo: This should be a class into its own file, but it would be too different from all the other project utils.
 *       When a refactor is made to have an utils folder, this should be refactored too.
 */
export const tokenMetadataHelper = {
  /**
   * Url of the API that provides and updates token metadata
   * @type: string
   */
  tokenMetadataApi: process.env.TOKEN_METADATA_URL || 'https://explorer-service.hathor.network/metadata/dag',
  metadataUpdateApiKey: process.env.EXPLORER_SERVICE_UPDATE_S3_KEY,

  /**
   * Returns if the transaction in the parameter is an NFT Creation.
   * @param {Transaction} tx
   * @returns {boolean}
   */
  isTransactionNFTCreation: (tx):boolean => {
    // FIXME: Declaring that this parameter is of the type Transaction creates a circular dependency
    let isNftCreationTx;

    const libTx: hathorLib.CreateTokenTransaction = hathorLib.helpersUtils.createTxFromHistoryObject(tx);
    try {
      libTx.validateNftCreation(); // This method will throw if the transaction is not an NFT Creation
      isNftCreationTx = true;
    } catch (ex) {
      isNftCreationTx = false;
    }

    return isNftCreationTx;
  },

  /**
   * Generates a JSON containing the basic metadata for an NFT, based on the token uid passed as parameter
   * @param {string} nftUid
   * @returns {Record<string,{id:string,nft:boolean}>}
   */
  generateNFTTokenMetadataJSON: (nftUid: string): Record<string, {id:string, nft:boolean}> => {
    const nftMetadata = {};
    nftMetadata[nftUid] = {
      id: nftUid,
      nft: true,
    };
    return nftMetadata;
  },

  /**
   * Gets the token metadata from the Explorer Service API.
   * @param {string} tokenUid
   * @returns {Promise<Record<string, unknown>>} Token metadata
   */
  getTokenMetadata: async (tokenUid: string): Promise<Record<string, unknown>> => {
    const metadataResponse = await axios.get(
      tokenMetadataHelper.tokenMetadataApi,
      { params: { id: tokenUid } },
    );

    return metadataResponse.data;
  },

  /**
   * Calls the token metadata on the Explorer Service API to update a token's metadata
   * @param {string} nftUid
   * @param {Record<string, unknown>} metadata
   */
  updateMetadata: async (nftUid: string, metadata: Record<string, unknown>): Promise<{ updated: string }> => {
    const updateResponse = await axios.put(
      tokenMetadataHelper.tokenMetadataApi,
      metadata,
      {
        params: { id: nftUid },
        headers: { 'x-api-key': tokenMetadataHelper.metadataUpdateApiKey },
      },
    );

    return { updated: updateResponse.data };
  },

  /**
   * Identifies if the metadata for a NFT needs updating and, if it does, update it.
   * @param {string} nftUid
   * @returns {Promise<void>} No data is returned after a successful update or skip
   */
  createOrUpdateNftMetadata: async (nftUid: string): Promise<void> => {
    // Fetching current metadata for this token
    const existingMetadata = await tokenMetadataHelper.getTokenMetadata(nftUid) || {};

    // Metadata already exists and is correct: Do nothing.
    const tokenMetadata = existingMetadata[nftUid] as any;
    if (tokenMetadata && tokenMetadata.nft === true) {
      return;
    }

    // Metadata already exists, but does not have the NFT flag: Update existing data.
    if (tokenMetadata) {
      tokenMetadata.nft = true;
      await tokenMetadataHelper.updateMetadata(nftUid, existingMetadata);
      return;
    }

    // There is no metadata for this token: create and upload it.
    const newMetadata = tokenMetadataHelper.generateNFTTokenMetadataJSON(nftUid);
    await tokenMetadataHelper.updateMetadata(nftUid, newMetadata);
  },
};
