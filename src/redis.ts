import {
  WsConnectionInfo,
  RedisConfig,
} from '@src/types';

import redis from 'redis';
import { promisify } from 'util';

const redisConfig: RedisConfig = {
  url: process.env.REDIS_URL,
  password: process.env.REDIS_PASSWORD,
};

export const svcPrefix = 'walletsvc';

export const getRedisClient = (): redis.RedisClient => redis.createClient(redisConfig);

export const closeRedisClient = (
  client: redis.RedisClient,
): Promise<boolean> => {
  const quit = promisify(client.quit).bind(client);
  return quit();
};

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

/* Create the connection entry
 * */
export const initWsConnection = async (
  client: redis.RedisClient,
  connInfo: WsConnectionInfo,
): Promise<string> => {
  const setAsync = promisify(client.set).bind(client);
  return setAsync(`${svcPrefix}:conn:${connInfo.id}`, connInfo.url);
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
  multi.del(`${svcPrefix}:conn:${connectionID}`);
  // with scanGen: for await (const key of scanGen(patt)) multi.del(key);
  await scanAll(client, `${svcPrefix}:chan:*:${connectionID}`).then((keys) => {
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
  return setAsync(`${svcPrefix}:chan:${channel}:${connInfo.id}`, connInfo.url);
};

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
  return getAsync(`${svcPrefix}:conn:${connectionID}`);
};

// get all connections
export const wsGetAllConnections = async (
  client: redis.RedisClient,
): Promise<WsConnectionInfo[]> => {
  const getAsync = promisify(client.get).bind(client);
  const found: WsConnectionInfo[] = [];
  const keys = await scanAll(client, `${svcPrefix}:conn:*`);
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
  const keys = await scanAll(client, `${svcPrefix}:chan:${channel}:*`);
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
