import { createHash } from 'crypto';
import { Address, HDPublicKey, Networks } from 'bitcore-lib';
import serverlessMysql from 'serverless-mysql';

// TODO get from hathor-lib or maybe env?
const mainnet = Networks.add({
  name: 'mainnet',
  alias: 'production',
  pubkeyhash: 0x28,
  privatekey: 0x80,
  scripthash: 0x64,
  xpubkey: 0x0488b21e,
  xprivkey: 0x0488ade4,
  networkMagic: 0xf9beb4d9,
  port: 8333,
  dnsSeeds: []
});


export const getWalletId = (xpubkey) => {
  return sha256d(xpubkey, 'hex');
};

/*
 * input: <string> | <Buffer> | <TypedArray> | <DataView>
 */
export const sha256d = (input, encoding) => {
  const hash1 = createHash('sha256');
  hash1.update(input);
  const hash2 = createHash('sha256');
  hash2.update(hash1.digest());
  return hash2.digest(encoding);
};

export const getHathorAddresses = (xpubkey, startIndex, quantity) => {
  const addrMap = {};
  const xpub = HDPublicKey(xpubkey);
  for (let index = startIndex; index < startIndex + quantity; index++) {
    const key = xpub.derive(index);
    const address = Address(key.publicKey, mainnet);
    addrMap[address.toString()] = index;
  }
  return addrMap;
};

export const getUnixTimestamp = () => {
  return Math.round((new Date()).getTime() / 1000);
};

export const getDbConnection = () => {
  return serverlessMysql({
    config: {
      host: process.env.DB_ENDPOINT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      //TODO if not on local stage, get IAM token
      //https://aws.amazon.com/blogs/database/iam-role-based-authentication-to-amazon-aurora-from-serverless-applications/
      password: process.env.DB_PASS,
    }
  });
};
