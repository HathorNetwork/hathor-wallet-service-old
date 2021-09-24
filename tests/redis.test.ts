import {
  getRedisClient,
  closeRedisClient,
  scanAll,
  initWsConnection,
  endWsConnection,
  wsJoinChannel,
  wsJoinWallet,
  wsGetChannelConnections,
  wsGetWalletConnections,
  wsGetAllConnections,
  wsGetConnection,
} from '@src/redis';

import {
  redisAddKeys,
  redisCleanup,
} from '@tests/utils';

import { promisify } from 'util';

const client = getRedisClient();
const getAsync = promisify(client.get).bind(client);
const keysAsync = promisify(client.keys).bind(client);

beforeEach(() => {
  redisCleanup(client);
});

afterAll(async () => {
  redisCleanup(client);
  await closeRedisClient(client);
});

test('Redis func: scanAll', async () => {
  expect.hasAssertions();
  const keys = {
    foo0: '0',
    foo1: '1',
    foo2: '2',
    bar0: '3',
  };
  redisAddKeys(client, keys);
  const keysFAll = await scanAll(client, 'foo*');
  expect(keysFAll.sort()).toStrictEqual(['foo0', 'foo1', 'foo2'].sort());
  const keysAll0 = await scanAll(client, '*0');
  expect(keysAll0.sort()).toStrictEqual(['foo0', 'bar0'].sort());
  const keysAll1 = await scanAll(client, '*1');
  expect(keysAll1.sort()).toStrictEqual(['foo1']);
});

test('initWsConnection', async () => {
  expect.hasAssertions();
  await initWsConnection(client, {
    id: 'abcd',
    url: 'efgh',
  });
  await getAsync('walletsvc:conn:abcd').then((val) => {
    expect(val).toStrictEqual('efgh');
  });
  // client.get('walletsvc:conn:abcd', (err, reply) => {
  //   if (err) throw err;
  //   expect(reply).toStrictEqual('efgh');
  // });
});

test('endWsConnection', async () => {
  expect.hasAssertions();

  const connID = 'abcd';
  const keysToDel = {
    'walletsvc:conn:abcd': '1',
    'walletsvc:chan:foo:abcd': '1',
    'walletsvc:chan:wallet-1234:abcd': '1',
  };
  const otherConn = 'efgh';
  const otherKeys = {
    'walletsvc:conn:efgh': '2',
    'walletsvc:chan:foo:efgh': '2',
    'walletsvc:chan:wallet-1234:efgh': '2',
  };

  redisAddKeys(client, keysToDel);
  redisAddKeys(client, otherKeys);

  await endWsConnection(client, connID);
  // should delete keys of disconnecting client and keep others
  await keysAsync('*').then((keys) => {
    expect(keys.sort()).toStrictEqual(Object.keys(otherKeys).sort());
  });

  redisAddKeys(client, { foo: 'bar' });
  await endWsConnection(client, otherConn);
  // should NOT affect unrelated keys
  await keysAsync('*').then((keys) => {
    expect(keys).toStrictEqual(['foo']);
  });
});

test('wsJoinWallet', async () => {
  expect.hasAssertions();

  // works the same way as wsJoinChannel, but with a special channel

  const connInfo = {
    id: 'abcd',
    url: 'http://url.com',
  };
  const connKeys = {
    'walletsvc:conn:abcd': '1',
    'walletsvc:chan:foo:abcd': '1',
    'walletsvc:chan:wallet-1234:abcd': '1',
  };
  redisAddKeys(client, connKeys);
  await wsJoinWallet(client, connInfo, 'bar');

  // should have the channel bar on connection abcd, and it should equal the url
  const chanKey = 'walletsvc:chan:wallet-bar:abcd';
  await getAsync(chanKey).then((url) => {
    expect(url).toStrictEqual('http://url.com');
  });

  // other keys should not be affected
  await keysAsync('*').then((keys) => {
    expect(keys.sort()).toStrictEqual(Object.keys(connKeys).concat([chanKey]).sort());
  });
});

test('wsJoinChannel', async () => {
  expect.hasAssertions();

  const connInfo = {
    id: 'abcd',
    url: 'http://url.com',
  };
  const connKeys = {
    'walletsvc:conn:abcd': '1',
    'walletsvc:chan:foo:abcd': '1',
    'walletsvc:chan:wallet-1234:abcd': '1',
  };
  redisAddKeys(client, connKeys);
  await wsJoinChannel(client, connInfo, 'bar');

  // should have the channel bar on connection abcd, and it should equal the url
  const chanKey = 'walletsvc:chan:bar:abcd';
  await getAsync(chanKey).then((url) => {
    expect(url).toStrictEqual('http://url.com');
  });

  // other keys should not be affected
  await keysAsync('*').then((keys) => {
    expect(keys.sort()).toStrictEqual(Object.keys(connKeys).concat([chanKey]).sort());
  });
});

test('wsGetChannelConnections', async () => {
  expect.hasAssertions();

  const connKeys = {
    'walletsvc:conn:abcd': '1',
    'walletsvc:chan:foo:abcd': '1',
    'walletsvc:chan:bar:abcd': 'url',
    'walletsvc:chan:wallet-1234:abcd': '1',
  };
  redisAddKeys(client, connKeys);
  const connections = await wsGetChannelConnections(client, 'bar');
  expect(connections).toStrictEqual([{ id: 'abcd', url: 'url' }]);
});

test('wsJoinChannel + wsGetChannelConnections', async () => {
  expect.hasAssertions();

  const connInfo = {
    id: 'abcd',
    url: 'http://url.com',
  };
  // initConn + joinChannel should include on channel connections
  // maybe include initConnection as needed?
  // await initWsConnection(connInfo);
  await wsJoinChannel(client, connInfo, 'foo');
  const connections = await wsGetChannelConnections(client, 'foo');
  expect(connections).toStrictEqual([connInfo]);
});

test('wsGetWalletConnections', async () => {
  expect.hasAssertions();

  const connKeys = {
    'walletsvc:conn:abcd': '1',
    'walletsvc:chan:foo:abcd': '1',
    'walletsvc:chan:bar:abcd': '1',
    'walletsvc:chan:wallet-1234:abcd': 'url',
  };
  redisAddKeys(client, connKeys);
  const connections = await wsGetWalletConnections(client, '1234');
  expect(connections).toStrictEqual([{ id: 'abcd', url: 'url' }]);
});

test('wsJoinWallet + wsGetWalletConnections', async () => {
  expect.hasAssertions();

  const connInfo = {
    id: 'abcd',
    url: 'http://url.com',
  };
  // initConn + joinWallet should include on wallet connections
  // maybe include initConnection as needed?
  // await initWsConnection(connInfo);
  await wsJoinWallet(client, connInfo, '1234');
  const connections = await wsGetWalletConnections(client, '1234');
  // should we separate id and url checks?
  expect(connections).toStrictEqual([connInfo]);
});

test('wsGetAllConnections', async () => {
  expect.hasAssertions();

  const connInfos = [
    { id: 'abcd', url: '1' },
    { id: 'efgh', url: '2' },
  ];
  const connKeys = {
    'walletsvc:conn:abcd': '1',
    'walletsvc:conn:efgh': '2',
    'foo:bar': '1',
  };
  redisAddKeys(client, connKeys);
  const connections = await wsGetAllConnections(client);
  // compare ids
  expect(connections.map((i) => i.id).sort()).toStrictEqual(connInfos.map((i) => i.id).sort());
  // compare urls
  expect(connections.map((i) => i.url).sort()).toStrictEqual(connInfos.map((i) => i.url).sort());
});

test('wsGetConnection', async () => {
  expect.hasAssertions();

  const connInfo = { id: 'abcd', url: '1' };
  const connKeys = {
    'walletsvc:conn:abcd': '1',
    'walletsvc:conn:efgh': '2',
    'foo:bar': '1',
  };
  redisAddKeys(client, connKeys);
  const connection = await wsGetConnection(client, 'abcd');
  expect(connection).toStrictEqual(connInfo.url);
});
