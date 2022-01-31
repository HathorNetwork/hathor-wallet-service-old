import * as bitcoin from 'bitcoinjs-lib';
import * as bitcoinMessage from 'bitcoinjs-message';
import * as ecc from 'tiny-secp256k1';
import BIP32Factory from 'bip32';
import bitcore from 'bitcore-lib';

const bip32 = BIP32Factory(ecc);

const hathorNetwork = {
  messagePrefix: '\x18Hathor Signed Message:\n',
  bech32: 'ht',
  bip32: { public: 76067358, private: 55720709 },
  pubKeyHash: 40,
  scriptHash: 100,
  wif: 128,
};

export const bjsGetAddressAtIndex = (pubkey: string, addressIndex: number): string => {
  const node = bip32.fromBase58(pubkey).derive(addressIndex);
  return bitcoin.payments.p2pkh({
    pubkey: node.publicKey,
    network: hathorNetwork,
  }).address;
};

export const bjsGetAddresses = (pubkey: string, startIndex: number, quantity: number): {[key: string]: number} => {
  const addrMap = {};

  for (let index = startIndex; index < startIndex + quantity; index++) {
    const address = bjsGetAddressAtIndex(pubkey, index);
    addrMap[address] = index;
  }

  return addrMap;
};

export const bjsXpubDeriveChild = (pubkey: string, index: number): string => (
  bip32.fromBase58(pubkey).derive(index).toBase58()
);

export const bjsVerifySignature = (
  signature: string,
  timestamp: number,
  address: string,
  walletId: string,
): boolean => {
  const message = String(timestamp).concat(walletId).concat(address);

  return bitcoinMessage.verify(message, address, Buffer.from(signature, 'base64'));
};

export const bjsGetAddressFromXpub = (pubkey: string): string => {
  const node = bip32.fromBase58(pubkey);

  return bitcoin.payments.p2pkh({
    pubkey: node.publicKey,
    network: hathorNetwork,
  }).address;
};
