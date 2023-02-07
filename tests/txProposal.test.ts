import { create as txProposalCreate, checkMissingUtxos } from '@src/api/txProposalCreate';
import { send as txProposalSend } from '@src/api/txProposalSend';
import { destroy as txProposalDestroy } from '@src/api/txProposalDestroy';
import {
  getTxProposal,
  getUtxos,
  updateTxProposal,
  updateVersionData,
} from '@src/db';
import { TxProposalStatus, IWalletInput, DbTxOutput } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
import {
  addToWalletBalanceTable,
  addToTxProposalTable,
  addToAddressTable,
  addToWalletTable,
  addToUtxoTable,
  makeGatewayEventWithAuthorizer,
  cleanDatabase,
  ADDRESSES,
  TX_IDS,
  addToVersionDataTable,
} from '@tests/utils';
import { APIGatewayProxyResult } from 'aws-lambda';

import { ApiError } from '@src/api/errors';

import hathorLib from '@hathor/wallet-lib';
import CreateTokenTransaction from '@hathor/wallet-lib/lib/models/create_token_transaction';

const defaultDerivationPath = `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/`;

const mysql = getDbConnection();

beforeEach(async () => {
  await cleanDatabase(mysql);
  const now = getUnixTimestamp();

  const versionData = {
    timestamp: now,
    version: '0.38.4',
    network: process.env.NETWORK,
    minWeight: 8,
    minTxWeight: 8,
    minTxWeightCoefficient: 0,
    minTxWeightK: 0,
    tokenDepositPercentage: 0.01,
    rewardSpendMinBlocks: 300,
    maxNumberInputs: 255,
    maxNumberOutputs: 255,
  };

  await addToVersionDataTable(mysql, versionData);
});

afterAll(async () => {
  await closeDbConnection(mysql);
});

const _checkTxProposalTables = async (txProposalId, inputs): Promise<void> => {
  const utxos = await getUtxos(mysql, inputs);
  for (const utxo of utxos) {
    expect(utxo.txProposalId).toBe(txProposalId);
  }
  expect(await getTxProposal(mysql, txProposalId)).not.toBeNull();
};

test('POST /txproposals with null as param should fail with ApiError.INVALID_PAYLOAD', async () => {
  expect.hasAssertions();

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, null);
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.INVALID_PAYLOAD);
});

test('POST /txproposals with utxos that are already used on another txproposal should fail with ApiError.INPUTS_ALREADY_USED', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const p2pkhAddress = new hathorLib.P2PKH(new hathorLib.Address(ADDRESSES[0], {
    network: new hathorLib.Network(process.env.NETWORK),
  })).createScript();

  const outputs = [
    new hathorLib.Output(
      300,
      p2pkhAddress, {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(201);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(1);
  expect(returnBody.inputs).toContainEqual({ txId: utxos[0].txId, index: utxos[0].index, addressPath: `${defaultDerivationPath}0` });

  // Send the same tx (same txHex) again
  const usedInputsEvent = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const usedInputsResult = await txProposalCreate(usedInputsEvent, null, null) as APIGatewayProxyResult;
  const usedInputsReturnBody = JSON.parse(usedInputsResult.body as string);

  expect(usedInputsReturnBody.success).toBe(false);
  expect(usedInputsReturnBody.error).toBe(ApiError.INPUTS_ALREADY_USED);
});

test('POST /txproposals with too many outputs should fail with ApiError.TOO_MANY_OUTPUTS', async () => {
  expect.hasAssertions();

  const now = getUnixTimestamp();

  await updateVersionData(mysql, {
    timestamp: now,
    version: '0.38.4',
    network: process.env.NETWORK,
    minWeight: 8,
    minTxWeight: 8,
    minTxWeightCoefficient: 0,
    minTxWeightK: 0,
    tokenDepositPercentage: 0.01,
    rewardSpendMinBlocks: 300,
    maxNumberInputs: 255,
    maxNumberOutputs: 2, // mocking to force a failure
  });

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [
    ['004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50', 0, token1, ADDRESSES[0], 300, 0, null, null, false],
    ['0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197', 0, token1, ADDRESSES[0], 100, 0, null, null, false],
    ['00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90', 0, token2, ADDRESSES[0], 300, 0, null, null, false],
  ];

  const outputs = [...Array(10).keys()].map(() => (
    new hathorLib.Output(300, new hathorLib.P2PKH(new hathorLib.Address(ADDRESSES[0], {
      network: new hathorLib.Network(process.env.NETWORK),
    })).createScript(), {
      tokenData: 1,
    })
  ));

  const inputs = [new hathorLib.Input(utxos[0][0], utxos[0][1])];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.TOO_MANY_OUTPUTS);
});

test('POST /txproposals with a wallet that is not ready should fail with ApiError.WALLET_NOT_READY', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'not-ready-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'creating',
    maxGap: 5,
    createdAt: 10000,
    readyAt: null,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'not-ready-wallet',
    transactions: 2,
  }]);

  const utxos = [{
    txId: 'txSuccess0',
    index: 0,
    tokenId: 'token1',
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: 'txSuccess1',
    index: 0,
    tokenId: 'token1',
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: 'txSuccess2',
    index: 0,
    tokenId: 'token2',
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  const event = makeGatewayEventWithAuthorizer('not-ready-wallet', null, JSON.stringify({ txHex: '0001000102006f1ebedd590bb5db5c71adbdeaa9b15f7f75c6257c26b11781dc1a5b20f83300006a473045022100fd6b496012c0db9f7300f2e399cfd2706e85f294e4a9195583df35174496a27d022007f3ea316c74a4f61719d2eff347dd4a88d7041fe7f7251514a38b66c0de097c2102b31636b7f35a6cbb42a2053554314a4ca808b7c4840dcc306060a5e7a3ae1b2b0000006400001976a91482965a89ed19afbc81ad0fc82861ffea3e6c591b88ac0001863b00001976a9140f101f6734e10ad87d305cf5af679e3362a659f488ac40200000218def4160dcc4660200b584c970b3597d59f3d3b8bf52c4928c6ce25604fe3488467d3f2c0f4dd6e2006f1ebedd590bb5db5c71adbdeaa9b15f7f75c6257c26b11781dc1a5b20f83300000161' }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);
  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toBe(ApiError.WALLET_NOT_READY);
});

test('PUT /txproposals/{proposalId} with an empty body should fail with ApiError.INVALID_PAYLOAD', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(new hathorLib.Address(ADDRESSES[0], {
        network: new hathorLib.Network(process.env.NETWORK),
      })).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const txCreateResult = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: returnBody.txProposalId }, null);
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.INVALID_PAYLOAD);
});

test('PUT /txproposals/{proposalId} with missing params should fail with ApiError.MISSING_PARAMETER', async () => {
  expect.hasAssertions();

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', null, null);
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toBe(ApiError.MISSING_PARAMETER);
  expect(JSON.parse(txSendResult.body as string).parameter).toBe('txProposalId');
});

test('PUT /txproposals/{proposalId} with a missing proposalId should fail with ApiError.TX_PROPOSAL_NOT_FOUND', async () => {
  expect.hasAssertions();

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: '8d1e2921-7bc9-41f5-9758-40b734edff0f' }, JSON.stringify({
    txHex: 'txhex',
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_FOUND);
});

test('PUT /txproposals/{proposalId} with a invalid proposalId should fail with ApiError.INVALID_PARAMETER', async () => {
  expect.hasAssertions();

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: 'invalid-uuid' }, null);
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.INVALID_PARAMETER);
  expect(JSON.parse(txSendResult.body as string).parameter).toStrictEqual('txProposalId');
});

test('PUT /txproposals/{proposalId} on a proposal which status is not OPEN or SEND_ERROR should fail with ApiError.TX_PROPOSAL_NOT_OPEN', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(
        new hathorLib.Address(
          ADDRESSES[0], {
            network: new hathorLib.Network(process.env.NETWORK),
          },
        ),
      ).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const txCreateResult = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  // Set tx_proposal status to CANCELLED so it will fail on txProposalSend
  const now = getUnixTimestamp();
  await updateTxProposal(
    mysql,
    returnBody.txProposalId,
    now,
    TxProposalStatus.CANCELLED,
  );

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: returnBody.txProposalId }, JSON.stringify({
    txHex,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_OPEN);
});

test('PUT /txproposals/{proposalId} on a proposal which is not owned by the user\'s wallet should fail with ApiError.FORBIDDEN', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(new hathorLib.Address(
        ADDRESSES[0], {
          network: new hathorLib.Network(process.env.NETWORK),
        },
      )).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const txCreateResult = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  // Set tx_proposal status to CANCELLED so it will fail on txProposalSend
  const now = getUnixTimestamp();
  await updateTxProposal(
    mysql,
    returnBody.txProposalId,
    now,
    TxProposalStatus.CANCELLED,
  );

  const txSendEvent = makeGatewayEventWithAuthorizer('another-wallet', { txProposalId: returnBody.txProposalId }, JSON.stringify({
    txHex,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body as string).error).toStrictEqual(ApiError.FORBIDDEN);
});

test('PUT /txproposals/{proposalId} with an invalid txHex should fail and update tx_proposal to SEND_ERROR', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => Promise.resolve({
      data: {
        success: false,
        message: 'invalid txhex',
      },
    }),
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(new hathorLib.Address(
        ADDRESSES[0], {
          network: new hathorLib.Network(process.env.NETWORK),
        },
      )).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const txCreateResult = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: returnBody.txProposalId }, JSON.stringify({
    txHex,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body).success).toStrictEqual(false);

  const txProposal = await getTxProposal(mysql, returnBody.txProposalId);

  expect(txProposal.status).toStrictEqual(TxProposalStatus.SEND_ERROR);

  spy.mockRestore();
});

test('PUT /txproposals/{proposalId} should update tx_proposal to SEND_ERROR on fail because of wallet-lib call error', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => {
      throw new Error('Wallet lib error');
    },
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(new hathorLib.Address(
        ADDRESSES[0], {
          network: new hathorLib.Network(process.env.NETWORK),
        },
      )).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const txCreateResult = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: returnBody.txProposalId }, JSON.stringify({
    txHex,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txSendResult.body).success).toStrictEqual(false);

  const txProposal = await getTxProposal(mysql, returnBody.txProposalId);

  expect(txProposal.status).toStrictEqual(TxProposalStatus.SEND_ERROR);

  spy.mockRestore();
});

test('DELETE /txproposals/{proposalId} should delete a tx_proposal and remove the utxos associated to it', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '000000000000000042fb8ae48accbc48561729e2359838751e11f837ca9a5746',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000000000000000cfd3dea4c689aa4c863bf6e6aea4518abcfe7d5ff6769aef',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(new hathorLib.Address(
        ADDRESSES[0], {
          network: new hathorLib.Network(process.env.NETWORK),
        },
      )).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const txCreateResult = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(txCreateResult.body as string);
  const txProposalId = returnBody.txProposalId;

  const checkInputs: IWalletInput[] = [
    {
      txId: '00000000000000001650cd208a2bcff09dce8af88d1b07097ef0efdba4aacbaa',
      index: 0,
    },
  ];
  const utxosAfterProposal = await getUtxos(mysql, checkInputs);
  for (const u of utxosAfterProposal) {
    expect(u.txProposalId).toBe(txProposalId);
  }

  const txDeleteEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: returnBody.txProposalId }, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;

  expect(JSON.parse(txDeleteResult.body).success).toStrictEqual(true);

  const txProposal = await getTxProposal(mysql, returnBody.txProposalId);

  expect(txProposal.status).toStrictEqual(TxProposalStatus.CANCELLED);

  const utxosAfterDestroyProposal = await getUtxos(mysql, checkInputs);
  for (const u of utxosAfterDestroyProposal) {
    expect(u.txProposalId).toBeNull();
    expect(u.txProposalIndex).toBeNull();
  }
});

test('DELETE /txproposals/{proposalId} with missing txProposalId should fail with ApiError.MISSING_PARAMETER', async () => {
  expect.hasAssertions();

  const txDeleteEvent = makeGatewayEventWithAuthorizer('wallet-id', null, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;
  const txDeleteResultBody = JSON.parse(txDeleteResult.body as string);

  expect(txDeleteResultBody.success).toStrictEqual(false);
  expect(txDeleteResultBody.error).toStrictEqual(ApiError.MISSING_PARAMETER);
  expect(txDeleteResultBody.parameter).toStrictEqual('txProposalId');
});

test('DELETE /txproposals/{proposalId} with not existing tx_proposal should fail with ApiError.TX_PROPOSAL_NOT_FOUND', async () => {
  expect.hasAssertions();

  const txDeleteEvent = makeGatewayEventWithAuthorizer('wallet-id', { txProposalId: 'invalid-tx-proposal-id' }, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;
  const txDeleteResultBody = JSON.parse(txDeleteResult.body as string);

  expect(txDeleteResultBody.success).toStrictEqual(false);
  expect(txDeleteResultBody.error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_FOUND);
});

test('DELETE /txproposals/{proposalId} should fail with ApiError.TX_PROPOSAL_NOT_OPEN on already sent tx_proposals', async () => {
  expect.hasAssertions();

  await addToTxProposalTable(mysql, [['fe141b88-7328-4851-a608-631d1d5a5513', 'wallet-id', 'sent', 1, 1]]);

  const txDeleteEvent = makeGatewayEventWithAuthorizer('wallet-id', { txProposalId: 'fe141b88-7328-4851-a608-631d1d5a5513' }, null);
  const txDeleteResult = await txProposalDestroy(txDeleteEvent, null, null) as APIGatewayProxyResult;
  const txDeleteResultBody = JSON.parse(txDeleteResult.body as string);

  expect(txDeleteResultBody.success).toStrictEqual(false);
  expect(txDeleteResultBody.error).toStrictEqual(ApiError.TX_PROPOSAL_NOT_OPEN);
});

test('POST /txproposals one output and input on txHex', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(new hathorLib.Address(
        ADDRESSES[0], {
          network: new hathorLib.Network(process.env.NETWORK),
        },
      )).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(201);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(1);
  expect(returnBody.inputs).toContainEqual({ txId: utxos[0].txId, index: utxos[0].index, addressPath: `${defaultDerivationPath}0` });

  await _checkTxProposalTables(returnBody.txProposalId, returnBody.inputs);
});

test('POST /txproposals with denied utxos', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToWalletTable(mysql, [{
    id: 'other-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey2',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 0,
    walletId: 'other-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[1],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[1],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[1],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);

  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(new hathorLib.Address(
        ADDRESSES[0], {
          network: new hathorLib.Network(process.env.NETWORK),
        },
      )).createScript(), {
        tokenData: 1,
      },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(400);
  expect(returnBody.success).toBe(false);
  expect(returnBody.error).toStrictEqual(ApiError.INPUTS_NOT_IN_WALLET);
});

test('POST /txproposals a tx create action on txHex', async () => {
  expect.hasAssertions();

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: '00',
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // hathor input for deposit
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const outputs = [
    // change output 100 htr deposited:
    new hathorLib.Output(
      200,
      new hathorLib.P2PKH(
        new hathorLib.Address(
          ADDRESSES[0], {
            network: new hathorLib.Network(process.env.NETWORK),
          },
        ),
      ).createScript(),
      { tokenData: 0 },
    ),
    // MINT mask
    new hathorLib.Output(
      hathorLib.constants.TOKEN_MINT_MASK,
      new hathorLib.P2PKH(
        new hathorLib.Address(
          ADDRESSES[0], {
            network: new hathorLib.Network(process.env.NETWORK),
          },
        ),
      ).createScript(),
      { tokenData: 1 | hathorLib.constants.TOKEN_AUTHORITY_MASK }, // eslint-disable-line no-bitwise
    ),
    // MELT mask
    new hathorLib.Output(
      hathorLib.constants.TOKEN_MELT_MASK,
      new hathorLib.P2PKH(
        new hathorLib.Address(
          ADDRESSES[0], {
            network: new hathorLib.Network(process.env.NETWORK),
          },
        ),
      ).createScript(),
      { tokenData: 1 | hathorLib.constants.TOKEN_AUTHORITY_MASK }, // eslint-disable-line no-bitwise
    ),
    // New created tokens
    new hathorLib.Output(
      100 * 100,
      new hathorLib.P2PKH(
        new hathorLib.Address(
          ADDRESSES[0], {
            network: new hathorLib.Network(process.env.NETWORK),
          },
        ),
      ).createScript(),
      { tokenData: 1 },
    ),
  ];

  const name = 'Test token';
  const symbol = 'TSTKN';
  const transaction = new CreateTokenTransaction(name, symbol, inputs, outputs, {
    version: hathorLib.constants.CREATE_TOKEN_TX_VERSION,
  });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  expect(result.statusCode).toBe(201);
  expect(returnBody.success).toBe(true);
  expect(returnBody.txProposalId).toHaveLength(36);
  expect(returnBody.inputs).toHaveLength(1);
  expect(returnBody.inputs).toContainEqual({ txId: utxos[0].txId, index: utxos[0].index, addressPath: `${defaultDerivationPath}0` });
});

test('PUT /txproposals/{proposalId} with txhex', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => Promise.resolve({
      data: { success: true },
    }),
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(
        new hathorLib.Address(ADDRESSES[0], { network: new hathorLib.Network(process.env.NETWORK) }),
      ).createScript(),
      { tokenData: 1 },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });

  const txHex = transaction.toHex();
  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: returnBody.txProposalId }, JSON.stringify({
    txHex,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  const sendReturnBody = JSON.parse(txSendResult.body as string);
  const txProposal = await getTxProposal(mysql, sendReturnBody.txProposalId);

  expect(sendReturnBody.success).toStrictEqual(true);
  expect(txProposal.status).toStrictEqual(TxProposalStatus.SENT);

  spy.mockRestore();
});

test('PUT /txproposals/{proposalId} with a different txhex than the one sent in txProposalCreate', async () => {
  expect.hasAssertions();

  // Create the spy to mock wallet-lib
  const spy = jest.spyOn(hathorLib.axios, 'createRequestInstance');
  spy.mockReturnValue({
    post: () => Promise.resolve({
      data: { success: true },
    }),
    get: () => Promise.resolve({
      data: {
        success: true,
        version: '0.38.0',
        network: 'mainnet',
        min_weight: 14,
        min_tx_weight: 14,
        min_tx_weight_coefficient: 1.6,
        min_tx_weight_k: 100,
        token_deposit_percentage: 0.01,
        reward_spend_min_blocks: 300,
        max_number_inputs: 255,
        max_number_outputs: 255,
      },
    }),
  });

  await addToWalletTable(mysql, [{
    id: 'my-wallet',
    xpubkey: 'xpubkey',
    authXpubkey: 'auth_xpubkey',
    status: 'ready',
    maxGap: 5,
    createdAt: 10000,
    readyAt: 10001,
  }]);
  await addToAddressTable(mysql, [{
    address: ADDRESSES[0],
    index: 0,
    walletId: 'my-wallet',
    transactions: 2,
  }]);

  const token1 = '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50';
  const token2 = '002f2bcc3261b4fb8510a458ed9df9f6ba2a413ee35901b3c5f81b0c085287e2';

  const utxos = [{
    txId: '004d75c1edd4294379e7e5b7ab6c118c53c8b07a506728feb5688c8d26a97e50',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '0000001e39bc37fe8710c01cc1e8c0a937bf6f9337551fbbfddc222bfc28c197',
    index: 0,
    tokenId: token1,
    address: ADDRESSES[0],
    value: 100,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }, {
    txId: '00000060a25077e48926bcd9473d77259296e123ec6af1c1a16c1c381093ab90',
    index: 0,
    tokenId: token2,
    address: ADDRESSES[0],
    value: 300,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
  }];

  await addToUtxoTable(mysql, utxos);
  await addToWalletBalanceTable(mysql, [{
    walletId: 'my-wallet',
    tokenId: 'token1',
    unlockedBalance: 400,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 2,
  }, {
    walletId: 'my-wallet',
    tokenId: 'token2',
    unlockedBalance: 300,
    lockedBalance: 0,
    unlockedAuthorities: 0,
    lockedAuthorities: 0,
    timelockExpires: null,
    transactions: 1,
  }]);

  await addToAddressTable(mysql, [{
    address: ADDRESSES[1],
    index: 1,
    walletId: 'my-wallet',
    transactions: 0,
  }]);

  // only one output, spending the whole 300 utxo of token1
  const outputs = [
    new hathorLib.Output(
      300,
      new hathorLib.P2PKH(
        new hathorLib.Address(ADDRESSES[0], { network: new hathorLib.Network(process.env.NETWORK) }),
      ).createScript(),
      { tokenData: 1 },
    ),
  ];
  const inputs = [new hathorLib.Input(utxos[0].txId, utxos[0].index)];
  const transaction = new hathorLib.Transaction(inputs, outputs, { tokens: [token1] });
  const txHex = transaction.toHex();

  const event = makeGatewayEventWithAuthorizer('my-wallet', null, JSON.stringify({ txHex }));
  const result = await txProposalCreate(event, null, null) as APIGatewayProxyResult;
  const returnBody = JSON.parse(result.body as string);

  const differentInputs = [new hathorLib.Input(utxos[2].txId, utxos[2].index)];
  const transaction2 = new hathorLib.Transaction(differentInputs, outputs, { tokens: [token1] });
  const txHex2 = transaction2.toHex();

  const txSendEvent = makeGatewayEventWithAuthorizer('my-wallet', { txProposalId: returnBody.txProposalId }, JSON.stringify({
    txHex: txHex2,
  }));
  const txSendResult = await txProposalSend(txSendEvent, null, null) as APIGatewayProxyResult;

  const sendReturnBody = JSON.parse(txSendResult.body as string);

  expect(sendReturnBody.success).toStrictEqual(false);
  expect(sendReturnBody.error).toStrictEqual(ApiError.TX_PROPOSAL_NO_MATCH);

  spy.mockRestore();
});

test('checkMissingUtxos', async () => {
  expect.hasAssertions();
  const inputs: IWalletInput[] = [{
    txId: TX_IDS[0],
    index: 0,
  }, {
    txId: TX_IDS[0],
    index: 1,
  }];

  const utxos: DbTxOutput[] = [{
    txId: TX_IDS[0],
    index: 0,
    tokenId: '00',
    address: ADDRESSES[0],
    value: 0,
    authorities: 0,
    timelock: 0,
    heightlock: 0,
    locked: false,
    spentBy: null,
    txProposalId: null,
    txProposalIndex: null,
  }];

  const checkMissingResult = checkMissingUtxos(inputs, utxos);

  expect(checkMissingResult).toHaveLength(1);
});
