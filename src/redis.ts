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

// export const client = redis.createClient(redisConfig);

export const getRedisClient = (): redis.RedisClient => redis.createClient(redisConfig);

export const closeRedisClient = (
  client: redis.RedisClient,
): Promise<boolean> => {
  const quit = promisify(client.quit).bind(client);
  return quit();
};

// define async versions of API
// const scanAsync = promisify(client.scan).bind(client);
// const sscanAsync = promisify(client.sscan).bind(client);
// const getAsync = promisify(client.get).bind(client);
// const setAsync = promisify(client.set).bind(client);
// export const asyncKeys = promisify(client.keys).bind(client);
// export const asyncHgetall = promisify(client.hgetall).bind(client);
// export const asyncScan = promisify(client.scan).bind(client);

export const scanAll = async (
  client: redis.RedisClient,
  pattern: string,
): Promise<string[]> => {
  const scanAsync = promisify(client.scan).bind(client);
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
  client: redis.RedisClient,
  connInfo: WsConnectionInfo,
): Promise<string> => {
  const setAsync = promisify(client.set).bind(client);
  return setAsync(`walletsvc:conn:${connInfo.id}`, connInfo.url);
};

/* Delete all keys for the connection
 * */
export const endWsConnection = async (
  client: redis.RedisClient,
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
  await scanAll(client, `walletsvc:chan:*:${connectionID}`).then((keys) => {
    for (const key of keys) {
      multi.del(key);
    }
  });
  multi.exec();
};

export const wsJoinChannel = async (
  client: redis.RedisClient,
  connInfo: WsConnectionInfo,
  channel: string,
): Promise<string> => {
  const setAsync = promisify(client.set).bind(client);
  return setAsync(`walletsvc:chan:${channel}:${connInfo.id}`, connInfo.url);
};

// maybe some wallet validation?
export const wsJoinWallet = async (
  client: redis.RedisClient,
  connInfo: WsConnectionInfo,
  walletID: string,
): Promise<string> => wsJoinChannel(client, connInfo, `wallet-${walletID}`);

export const wsGetConnection = async (
  client: redis.RedisClient,
  connectionID: string,
): Promise<string> => {
  const getAsync = promisify(client.get).bind(client);
  return getAsync(`walletsvc:conn:${connectionID}`);
};

// get all connections
export const wsGetAllConnections = async (
  client: redis.RedisClient,
): Promise<WsConnectionInfo[]> => {
  const getAsync = promisify(client.get).bind(client);
  const found: WsConnectionInfo[] = [];
  const keys = await scanAll(client, 'walletsvc:conn:*');
  for (const key of keys) {
    const value = await getAsync(key);
    found.push({ id: key.split(':').pop(), url: value });
  }
  return found;
};

// get all connections listening to a channel
export const wsGetChannelConnections = async (
  client: redis.RedisClient,
  channel: string,
): Promise<WsConnectionInfo[]> => {
  const getAsync = promisify(client.get).bind(client);
  const found: WsConnectionInfo[] = [];
  const keys = await scanAll(client, `walletsvc:chan:${channel}:*`);
  for (const key of keys) {
    const value = await getAsync(key);
    found.push({ id: key.split(':').pop(), url: value });
  }
  return found;
};

// get all connections related to a walletID
export const wsGetWalletConnections = async (
  client: redis.RedisClient,
  walletID: string,
): Promise<WsConnectionInfo[]> => wsGetChannelConnections(client, `wallet-${walletID}`);
