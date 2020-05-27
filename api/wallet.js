import { Lambda } from 'aws-sdk';

import {
  addNewAddresses,
  generateAddresses,
  getWalletStatus,
  initWalletBalance,
  initWalletTxHistory,
  updateExistingAddresses,
  updateWalletStatus,
} from '../db';
import { getDbConnection, getUnixTimestamp, getWalletId } from '../utils';

const mysql = getDbConnection();


/*
 * Gets the status of a wallet
 *
 * This lambda is called by API Gateway on GET /wallet
 */
export const getStatus = async (event, context, callback) => {
  let walletId = null;
  const params = event.queryStringParameters;
  if (params && params.id) {
    walletId = params.id;
  } else {
    return {
      statusCode: 200,
      //TODO create error 'enum'
      body: JSON.stringify({success: false, error: 'missing-parameter'}),
    };
  }

  const status = await getWalletStatus(mysql, walletId);
  if (!status) {
    return {
      statusCode: 200,
      body: JSON.stringify({success: false, error: 'wallet-not-found'}),
    };
  }

  //TODO await mysql.end();
  await mysql.quit();

  return {
    statusCode: 200,
    body: JSON.stringify({success: true, status}),
  };
};

/*
 * Load a wallet. First checks if the wallet doesn't exist already and then call another
 * lamdba to asynchronously add new wallet info to database
 *
 * This lambda is called by API Gateway on POST /wallet
 */
export const load = async (event, context, callback) => {
  let body = null;
  try {
    body = JSON.parse(event.body);
    // event.body might be null, which is also parse to null
    if (!body) throw new Error('body is null');
  } catch (e) {
    console.log('error', e);
    return {
      statusCode: 200,
      body: JSON.stringify({success: false, error: 'invalid-parameter'}),
    };
  }

  const xpubkey = body.xpubkey;
  if (!xpubkey) {
    return {
      statusCode: 200,
      body: JSON.stringify({success: false, error: 'missing-parameter', parameter: 'xpubkey'}),
    };
  }

  // is wallet already loaded/loading?
  const walletId = getWalletId(xpubkey);
  let status = await getWalletStatus(mysql, walletId);
  if (status) {
    return {
      statusCode: 200,
      body: JSON.stringify({success: false, error: 'wallet-already-loaded', status}),
    };
  }

  const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);

  // invoke lambda asynchronously to handle wallet creation
  const lambda = new Lambda({
    apiVersion: '2015-03-31',
    endpoint: process.env.STAGE === 'local'
      ? 'http://localhost:3002'
      : `https://lambda.${process.env.AWS_REGION}.amazonaws.com`,
  });
  const params = {
    // FunctionName is composed of: service name - stage - function name
    FunctionName: `${process.env.SERVICE_NAME}-${process.env.STAGE}-loadWalletAsync`,
    InvocationType: 'Event',
    Payload: JSON.stringify({xpubkey, maxGap}),
  };
  try {
    await lambda.invoke(params).promise();
  } catch (e) {
    //TODO handle
    console.error('invoke', e);
  }


  // XXX should we return status with createdAt? It might not be exactly the same that ends
  // up on database, as the db entry is added by another lambda. It will be very close, though
  status = {
    xpubkey,
    status: 'creating',
    maxGap,
    createdAt: getUnixTimestamp(),
    readyAt: null,
  };
  return {
    statusCode: 200,
    body: JSON.stringify({success: true, walletId, status}),
  };
};

/*
 * This does the "heavy" work when loading a new wallet, updating the database tables accordingly.
 *
 * This lambda is called async by another lambda, the one reponsible for the load wallet API
 */
export const loadWallet = async (event, context, callback) => {
  //TODO db error handling and transaction/rollback support

  const xpubkey = event.xpubkey;
  const maxGap = event.maxGap;
  const walletId = getWalletId(xpubkey);

  // add to wallet table with 'creating' status
  //TODO might happen that it already exists, if there were 2 simultaneous POST /wallet requests
  // lambda queue might also send repeated events: "Occasionally, your function may receive the same event multiple times, even if no error occurs"
  await updateWalletStatus(mysql, walletId, 'creating', xpubkey, maxGap);

  const {addresses, existingAddresses, newAddresses} = await generateAddresses(mysql, xpubkey, maxGap);

  // update address table with new addresses
  await addNewAddresses(mysql, walletId, newAddresses);

  // update existing addresses' walletId and index
  await updateExistingAddresses(mysql, walletId, existingAddresses);

  // from address_tx_history, update wallet_tx_history
  await initWalletTxHistory(mysql, walletId, addresses);

  // from address_balance table, update balance table
  await initWalletBalance(mysql, walletId, addresses);

  // update wallet status to 'ready'
  await updateWalletStatus(mysql, walletId, 'ready');

  //TODO await mysql.end();
  await mysql.quit();

  //TODO we're not returning to an API
  return {
    statusCode: 200,
    body: JSON.stringify({
      walletId,
    }),
  };
};
