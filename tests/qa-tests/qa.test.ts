import { config, errors as walletLibErrors, walletUtils, HathorWalletServiceWallet } from '@hathor/wallet-lib';
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

  await wallet.start({ pinCode: '1234', password: '' });
}, 20000);

afterAll(async () => {
  await wallet.stop();
}, 20000);

test('/wallet/transactions/{txId}', async () => {
  // This tests the `/wallet/init` endpoint, by calling the walletApi.createWallet method in the lib
  try {
    // This tests the `/wallet/transactions/{txId}` endpoint
    const tx = await wallet.getTxById("000087bd0ed3cb0952b87bca3994b4f9cd014d60e6ddc82f82bdef3fb0a95002");

    expect(tx.success).toStrictEqual(true);
    expect(tx.txTokens).toHaveLength(1);
    expect(tx.txTokens[0]).toEqual({
        balance: -1,
        timestamp: 1681409837,
        tokenId: '00',
        tokenName: 'Hathor',
        tokenSymbol: 'HTR',
        txId: '000087bd0ed3cb0952b87bca3994b4f9cd014d60e6ddc82f82bdef3fb0a95002',
        version: 1,
        voided: false,
        weight: 16.8184
    })
  } catch (e) {
    if (e instanceof walletLibErrors.WalletRequestError) {
        throw new Error(`Failed to get tx by id. Cause: ${e.cause}`);
    } else {
        throw e;
    }
  }
}, 30000);

test('/wallet/proxy/transactions/{txId}', async () => {
  try {
    // This tests the `/wallet/transactions/{txId}` endpoint
    const tx = await wallet.getFullTxById("000025451fcc127ef89cfa515b68b3b656b521fd4ff5ba66a81decfadd0b9c7d");

    expect(tx).toMatchSnapshot();
  } catch (e) {
    if (e instanceof walletLibErrors.WalletRequestError) {
        throw new Error(`Failed to get tx by id. Cause: ${e.cause}`);
    } else {
        throw e;
    }
  }
}, 30000);

test.todo('/wallet/proxy/transactions/{txId}/confirmation_data');

test.todo('/wallet/proxy/graphviz/neighbours');

test.todo('/wallet/push/register');
test.todo('/wallet/push/update');
test.todo('/wallet/push/unregister/{deviceId}');

test.todo('POST /tx/proposal');
test.todo('PUT /tx/proposal/{txProposalId}');
test.todo('DELETE /tx/proposal/{txProposalId}');

test.todo('GET /wallet/history');

test.todo('GET /wallet/status')
test.todo('POST /wallet/addresses/check_mine')
test.todo('GET /wallet/addresses');
test.todo('GET /wallet/addresses/new');
test.todo('GET /wallet/utxos');
test.todo('GET /wallet/tx_outputs');
test.todo('GET /wallet/balances');
test.todo('GET /wallet/tokens');
test.todo('GET /wallet/tokens/{token_id}/details');

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
