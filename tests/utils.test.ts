import { CustomStorage, arrayShuffle, sha256d } from '@src/utils';
import hathorLib from '@hathor/wallet-lib';

test('CustomStorage', () => {
  expect.hasAssertions();

  const store = new CustomStorage();
  // Should be initialized with hathor default server and server
  expect(store.getItem('wallet:defaultServer')).toBe(hathorLib.constants.DEFAULT_SERVER);
  expect(store.getItem('wallet:server')).toBe(hathorLib.constants.DEFAULT_SERVER);

  store.setItem('hathor', 'hathor');
  expect(store.getItem('hathor')).toBe('hathor');
  store.removeItem('hathor');

  expect(store.getItem('hathor')).toBeUndefined();

  store.setItem('hathor', 'hathor2');
  store.clear();
  expect(store.getItem('hathor')).toBeUndefined();

  store.preStart();
  expect(store.getItem('wallet:defaultServer')).toBe(hathorLib.constants.DEFAULT_SERVER);
  expect(store.getItem('wallet:server')).toBe(hathorLib.constants.DEFAULT_SERVER);
});

test('sha256d', () => {
  expect.hasAssertions();
  // sha256d(my-test-data) -> 4f1ba9a4204e97a293b16ead6caced38f6d91d95618b96e261c6332ed24f7894
  // sha256d(something-else) -> 5c690b78d489f158d8575e7ed271521d056c445e8bd3978c8295775c1743bec0
  let result = sha256d('my-test-data', 'hex');
  expect(result).toBe('4f1ba9a4204e97a293b16ead6caced38f6d91d95618b96e261c6332ed24f7894');
  result = sha256d('something-else', 'hex');
  expect(result).toBe('5c690b78d489f158d8575e7ed271521d056c445e8bd3978c8295775c1743bec0');
});

test('arrayShuffle', () => {
  expect.hasAssertions();
  const original = Array.from(Array(10).keys());

  const shuffled = Array.from(Array(10).keys());
  arrayShuffle(shuffled);

  expect(original).not.toStrictEqual(shuffled);
});
