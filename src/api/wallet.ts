import { APIGatewayProxyHandler, Handler } from 'aws-lambda';
import { Lambda } from 'aws-sdk';
import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import {
  addNewAddresses,
  createWallet,
  generateAddresses,
  getWallet,
  initWalletBalance,
  initWalletTxHistory,
  updateExistingAddresses,
  updateWalletStatus,
} from '@src/db';
import { WalletStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getWalletId } from '@src/utils';
import { closeDbAndGetError } from '@src/api/utils';

const mysql = getDbConnection();

/*
 * Get the status of a wallet
 *
 * This lambda is called by API Gateway on GET /wallet
 */
export const get: APIGatewayProxyHandler = async (event) => {
  let walletId: string;
  const params = event.queryStringParameters;
  if (params && params.id) {
    walletId = params.id;
  } else {
    return closeDbAndGetError(mysql, ApiError.MISSING_PARAMETER, { parameter: 'id' });
  }

  const status = await getWallet(mysql, walletId);
  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, status }),
  };
};

/*
 * Load a wallet. First checks if the wallet doesn't exist already and then call another
 * lamdba to asynchronously add new wallet info to database
 *
 * This lambda is called by API Gateway on POST /wallet
 */
export const load: APIGatewayProxyHandler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body);
    // event.body might be null, which is also parsed to null
    if (!body) throw new Error('body is null');
  } catch (e) {
    return closeDbAndGetError(mysql, ApiError.INVALID_PARAMETER, { parameter: 'xpubkey' });
  }

  const xpubkey = body.xpubkey;
  if (!xpubkey) {
    return closeDbAndGetError(mysql, ApiError.MISSING_PARAMETER, { parameter: 'xpubkey' });
  }

  // is wallet already loaded/loading?
  const walletId = getWalletId(xpubkey);
  let status = await getWallet(mysql, walletId);
  if (status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_ALREADY_LOADED, { status });
  }

  const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);

  // add to wallet table with 'creating' status
  status = await createWallet(mysql, walletId, xpubkey, maxGap);

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
    Payload: JSON.stringify({ xpubkey, maxGap }),
  };
  try {
    // TODO setup lambda error handling. It's not an error on lambda.invoke, but an error during lambda execution
    await lambda.invoke(params).promise();
  } catch (e) {
    // TODO handle
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, status }),
  };
};

interface LoadEvent {
  xpubkey: string;
  maxGap: number;
}

interface LoadResult {
  walletId: string;
  xpubkey: string;
}

/*
 * This does the "heavy" work when loading a new wallet, updating the database tables accordingly. It
 * expects a wallet entry already on the database
 *
 * This lambda is called async by another lambda, the one reponsible for the load wallet API
 */
export const loadWallet: Handler<LoadEvent, LoadResult> = async (event) => {
  const xpubkey = event.xpubkey;
  const maxGap = event.maxGap;
  const walletId = getWalletId(xpubkey);

  const { addresses, existingAddresses, newAddresses } = await generateAddresses(mysql, xpubkey, maxGap);

  // update address table with new addresses
  await addNewAddresses(mysql, walletId, newAddresses);

  // update existing addresses' walletId and index
  await updateExistingAddresses(mysql, walletId, existingAddresses);

  // from address_tx_history, update wallet_tx_history
  await initWalletTxHistory(mysql, walletId, addresses);

  // from address_balance table, update balance table
  await initWalletBalance(mysql, walletId, addresses);

  // update wallet status to 'ready'
  await updateWalletStatus(mysql, walletId, WalletStatus.READY);

  await closeDbConnection(mysql);

  return {
    walletId,
    xpubkey,
  };
};
