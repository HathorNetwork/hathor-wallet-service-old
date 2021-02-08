import { Balance, DecodedOutput, TokenBalanceMap, TxInput, TxOutput } from '@src/types';

test('Balance merge', () => {
  expect.hasAssertions();
  const b1 = new Balance(1, 2);
  const b2 = new Balance(3, 4);
  expect(Balance.merge(b1, b2)).toStrictEqual(new Balance(4, 6, null));

  const b3 = new Balance(1, 2, 1000);
  const b4 = new Balance(3, 4);
  expect(Balance.merge(b3, b4)).toStrictEqual(new Balance(4, 6, 1000));
  expect(Balance.merge(b4, b3)).toStrictEqual(new Balance(4, 6, 1000));

  const b5 = new Balance(10, 20, 2000);
  expect(Balance.merge(b3, b5)).toStrictEqual(new Balance(11, 22, 1000));
  expect(Balance.merge(b5, b3)).toStrictEqual(new Balance(11, 22, 1000));
});

test('TokenBalanceMap basic', () => {
  expect.hasAssertions();
  const t1 = new TokenBalanceMap();
  // return an empty balance
  expect(t1.get('token1')).toStrictEqual(new Balance());
  // add balance for a token and fetch it again
  const b1 = new Balance(5, 9, 1000);
  t1.set('token1', b1);
  expect(t1.get('token1')).toStrictEqual(b1);
  // balance for a different token should still be 0
  expect(t1.get('token2')).toStrictEqual(new Balance());
});

test('TokenBalanceMap clone', () => {
  expect.hasAssertions();
  const t1 = new TokenBalanceMap();
  t1.set('token1', new Balance(5, 9, 1000));
  const t2 = t1.clone();
  expect(t1).toStrictEqual(t2);
  expect(t1).not.toBe(t2);
  // should also clone balances
  expect(t1.get('token1')).not.toBe(t2.get('token1'));
});

test('TokenBalanceMap fromStringMap', () => {
  expect.hasAssertions();
  const t1 = new TokenBalanceMap();
  t1.set('token1', new Balance(0, 15));
  t1.set('token2', new Balance(2, -3, 1000));
  const t2 = TokenBalanceMap.fromStringMap({ token1: { unlocked: 0, locked: 15 }, token2: { unlocked: 2, locked: -3, lockExpires: 1000 } });
  expect(t2).toStrictEqual(t1);
});

test('TokenBalanceMap merge', () => {
  expect.hasAssertions();
  const t1 = TokenBalanceMap.fromStringMap({ token1: { unlocked: 0, locked: 10 }, token2: { unlocked: 5, locked: 7 } });
  const t2 = TokenBalanceMap.fromStringMap({ token1: { unlocked: 2, locked: -3, lockExpires: 1000 }, token3: { unlocked: 9, locked: 0 } });
  const merged = new TokenBalanceMap();
  merged.set('token1', new Balance(2, 7, 1000));
  merged.set('token2', new Balance(5, 7));
  merged.set('token3', new Balance(9, 0));
  expect(TokenBalanceMap.merge(t1, t2)).toStrictEqual(merged);

  // with null/undefined parameter
  expect(TokenBalanceMap.merge(t1, null)).toStrictEqual(t1);
  expect(TokenBalanceMap.merge(undefined, t1)).toStrictEqual(t1);

  // should clone the objects
  expect(TokenBalanceMap.merge(t1, null)).not.toBe(t1);
  expect(TokenBalanceMap.merge(undefined, t1)).not.toBe(t1);
});

test('TokenBalanceMap fromTxOutput fromTxInput', () => {
  expect.hasAssertions();
  const timelock = 1000;
  const decoded: DecodedOutput = {
    type: 'P2PKH',
    address: 'HCLqWoDJvprSnwwmr6huBg3bNR7DxjwXcD',
    timelock,
    value: 200,
    token_data: 0,
  };
  const txOutput: TxOutput = {
    value: decoded.value,
    token_data: decoded.token_data,
    script: 'not-used',
    token: '00',
    spent_by: null,
    decoded,
    locked: false,
  };
  const txInput: TxInput = {
    tx_id: '00000000000000029411240dc4aea675b672c260f1419c8a3b87cfa203398098',
    index: 2,
    value: decoded.value,
    token_data: decoded.token_data,
    script: 'not-used',
    token: '00',
    decoded,
  };

  expect(TokenBalanceMap.fromTxInput(txInput)).toStrictEqual(TokenBalanceMap.fromStringMap({ '00': { unlocked: -decoded.value, locked: 0 } }));
  expect(TokenBalanceMap.fromTxOutput(txOutput)).toStrictEqual(TokenBalanceMap.fromStringMap({ '00': { unlocked: decoded.value, locked: 0 } }));

  // locked
  txOutput.locked = true;
  expect(TokenBalanceMap.fromTxOutput(txOutput)).toStrictEqual(TokenBalanceMap.fromStringMap({ '00': { locked: decoded.value, unlocked: 0, lockExpires: timelock } }));
});
