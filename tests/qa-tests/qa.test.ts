import { config, HathorWalletServiceWallet, walletApi } from '@hathor/wallet-lib';
import { TEST_SEED } from '@tests/utils';

let wallet;


beforeAll(async () => {
  config.setNetwork(process.env.NETWORK);
  config.setWalletServiceBaseUrl('https://staging.wallet-service.hathor.network');
  config.setWalletServiceBaseWsUrl('https://ws.staging.wallet-service.hathor.network');

  wallet = new HathorWalletServiceWallet({
    requestPassword: () => {},
    seed: TEST_SEED,
    network: config.getNetwork() 
  });

  // Start the wallet like this will indirectly test the following endpoints:
  // - `/wallet/init`: by calling the walletApi.createWallet method
  // - `/wallet/status`: by calling the wallet.pollForWalletStatus method
  await wallet.start({ pinCode: '1234', password: '' });
}, 20000);

afterAll(async () => {
  await wallet.stop();
}, 20000);

test('GET /wallet/transactions/{txId}', async () => {
  const response = await wallet.getTxById("000087bd0ed3cb0952b87bca3994b4f9cd014d60e6ddc82f82bdef3fb0a95002");

  expect(response.success).toStrictEqual(true);
  expect(response.txTokens).toHaveLength(1);
  expect(response.txTokens[0]).toEqual({
      balance: -1,
      timestamp: 1681409837,
      tokenId: '00',
      tokenName: 'Hathor',
      tokenSymbol: 'HTR',
      txId: '000087bd0ed3cb0952b87bca3994b4f9cd014d60e6ddc82f82bdef3fb0a95002',
      version: 1,
      voided: false,
      weight: 16.8184
  });
}, 30000);

test('GET /wallet/proxy/transactions/{txId}', async () => {
  const response = await wallet.getFullTxById("000025451fcc127ef89cfa515b68b3b656b521fd4ff5ba66a81decfadd0b9c7d");

  expect(response).toMatchSnapshot();
}, 30000);

test('GET /wallet/proxy/transactions/{txId}/confirmation_data', async () => {
  const response = await wallet.getTxConfirmationData("000025451fcc127ef89cfa515b68b3b656b521fd4ff5ba66a81decfadd0b9c7d");

  expect(response).toEqual({
    "accumulated_bigger": true,
    "accumulated_weight": 70.12392675219921,
    "confirmation_level": 1,
    "stop_value": 69.90262876589468,
    "success": true,
  });
}, 30000);

test('GET /wallet/proxy/graphviz/neighbours', async () => {
  const response = await wallet.graphvizNeighborsQuery(
    "000025451fcc127ef89cfa515b68b3b656b521fd4ff5ba66a81decfadd0b9c7d",
    "verification",
    5
  );

  expect(response).toMatchSnapshot();
}, 30000);

test('GET /wallet/history', async () => {
  const response = await wallet.getTxHistory();

  // We expect 2 transactions to exist for our test wallet.
  // If someone uses the seed to do more transactions in the mainnet, this test will fail
  expect(response).toMatchSnapshot();
}, 30000);

test('GET /wallet/addresses', async () => {
  const addresses = [];

  for await (const a of wallet.getAllAddresses()) {
    addresses.push(a);
  }

  expect(addresses).toMatchSnapshot();
}, 30000);

test('POST /wallet/addresses/check_mine', async () => {
  const response = await wallet.checkAddressesMine([
    "HBCQgVR8Xsyv1BLDjf9NJPK1Hwg4rKUh62",
    "HPDWdurEygcubNMUUnTDUAzngrSXFaqGQc",
    "HLfGaQoxssGbZ4h9wbLyiCafdE8kPm6Fo4",
    "HJbeBkDqBewxkAqsnvvV2Ge8qu31Tmc3XK",
    "H9A6fG4JxT1HCktiaZwLQCCgsgUM7axndb"
  ]);

  expect(response).toMatchSnapshot();
}, 30000);

test.todo('GET /wallet/addresses/new');
test.todo('GET /wallet/utxos');
test.todo('GET /wallet/tx_outputs');
test.todo('GET /wallet/balances');
test.todo('GET /wallet/tokens');
test.todo('GET /wallet/tokens/{token_id}/details');


test.todo('/wallet/push/register');
test.todo('/wallet/push/update');
test.todo('/wallet/push/unregister/{deviceId}');

test.todo('POST /tx/proposal');
test.todo('PUT /tx/proposal/{txProposalId}');
test.todo('DELETE /tx/proposal/{txProposalId}');


test.todo('PUT /wallet/auth');

test.todo('GET /version');

test.todo('GET /metrics');

test.todo('/auth/token'); // TODO: I think this is indirectly tested when starting the wallet



// TODO: Lambdas that are not API endpoints:
// sendNotificationToDevice
// txPushRequested
// getLatestBlock
// onNewTxRequest
// onMinersListRequest
// onTotalSupplyRequest
// onHandleReorgRequest
// onNewTxEvent
// onNewNftEvent

// TODO: Lambdas that are CRONs:
// deleteStalePushDevices
// cleanUnsentTxProposalsUtxos
// onHandleOldVoidedTxs


// TODO: Websocket Lambdas
// wsConnect
// wsJoin
// wsTxNotifyNew
// wsTxNotifyUpdate
// wsAdminBroadcast
// wsAdminDisconnect
// wsAdminMulticast
