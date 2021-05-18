import {
  WsConnectionInfo,
  RedisConfig,
} from '@src/types';

import redis from 'redis';
import { promisify } from 'util';

const redisConfig: RedisConfig = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10),
  password: process.env.REDIS_PASSWORD,
};

export default redis;
export const client = redis.createClient(redisConfig);

// define async versions of API
const scanAsync = promisify(client.scan).bind(client);
// const sscanAsync = promisify(client.sscan).bind(client);
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
// export const asyncKeys = promisify(client.keys).bind(client);
// export const asyncHgetall = promisify(client.hgetall).bind(client);
// export const asyncScan = promisify(client.scan).bind(client);

const scanAll = async (pattern) => {
  const found = [];
  let cursor = '0';
  do {
    const reply = await scanAsync(cursor, 'MATCH', pattern);
    cursor = reply[0];
    found.push(...reply[1]);
  } while (cursor !== '0');

  return found;
};

// XXX: AsyncGenerator implementations of scanAll, maybe use these?
// async function * scanGen(pattern) {
//     async function * iterate (curs, patt) {
//         const [cursor, keys] = await scanAsync(curs, 'MATCH', patt);
//         for (const key of keys) yield key
//         if (cursor !== '0') yield * iterate(cursor, patt)
//     }
//     yield * iterate(0, pattern)
// }
//
// XXX: this iterates on values on the list `key`
// async function * scanValGen(key, pattern) {
//     async function * iterate (k, curs, patt) {
//         const [cursor, values] = await sscanAsync(k, curs, 'MATCH', patt);
//         for (const value of values) yield value
//         if (cursor !== '0') yield * iterate(k, cursor, patt)
//     }
//     yield * iterate(key, 0, pattern)
// }

/*
 * Need:
 *  - broadcast
 *  - send to wallet connections
 *  - send to channel? (maybe wallet-`walletId` should be a channel)
 *
 *  If this function is called when the fields already exists:
 *  - same parameters: TTL is refreshed
 *  - other params: updates connection keys
 */
export const initWsConnection = async (
  // walletID: string,
  connInfo: WsConnectionInfo,
): Promise<string> => setAsync(`walletsvc:conn:${connInfo.id}`, connInfo.url);

/* Delete all keys for the connection
 * */
export const endWsConnection = async (
  connectionID: string,
): Promise<void> => {
  // multi not exactly needed (mainly used for transactions)
  // but it gives a nice way to rollback if any errors occur in any command
  // see: https://github.com/NodeRedis/node-redis#clientmulticommands
  // and: https://redis.io/topics/transactions
  // alternative: execute each command and check for errors individually
  const multi = client.multi();
  multi.del(`walletsvc:conn:${connectionID}`);
  // with scanGen: for await (const key of scanGen(patt)) multi.del(key);
  await scanAll(`walletsvc:chan:*:${connectionID}`).then((keys) => {
    for (const key of keys) {
      multi.del(key);
    }
  });
  multi.exec();
};

export const wsJoinChannel = async (
  channel: string,
  connectionID: string,
): Promise<void> => wsGetConnection(connectionID).then(
  (connectionURL) => setAsync(
    `walletsvc:chan:${channel}:${connectionID}`,
    connectionURL,
  ),
);

// maybe some wallet validation?
export const wsJoinWallet = async (
  walletID: string,
  connectionID: string,
): Promise<void> => wsJoinChannel(`wallet-${walletID}`, connectionID);

export const wsGetConnection = async (
  connectionID: string,
): Promise<string> => getAsync(`walletsvc:conn:${connectionID}`);

// get all connections
export const wsGetAllConnections = async (): Promise<WsConnectionInfo[]> => {
  const found: WsConnectionInfo[] = [];
  const keys = await scanAll('walletsvc:conn:*');
  for (const key of keys) {
    const value = await getAsync(key);
    // found.push([key.split(':').pop(), value]);
    found.push({ id: key.split(':').pop(), url: value });
  }
  return found;
};

// get all connections listening to a channel
export const wsGetChannelConnections = async (
  channel: string,
): Promise<WsConnectionInfo[]> => {
  const found: WsConnectionInfo[] = [];
  const keys = await scanAll(`walletsvc:chan:${channel}:*`);
  for (const key of keys) {
    const value = await getAsync(key);
    // found.push([key.split(':').pop(), value]);
    found.push({ id: key.split(':').pop(), url: value });
  }
  return found;
};

// get all connections related to a walletID
export const wsGetWalletConnections = async (
  walletID: string,
): Promise<WsConnectionInfo[]> => wsGetChannelConnections(`wallet-${walletID}`);
