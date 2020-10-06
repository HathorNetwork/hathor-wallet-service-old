/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyHandler, Handler } from 'aws-lambda';
import { Lambda } from 'aws-sdk';
import 'source-map-support/register';
import hathorLib from '@hathor/wallet-lib';

import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import {
  addNewAddresses,
  createWallet as dbCreateWallet,
  generateAddresses,
  getWallet,
  initWalletBalance,
  initWalletTxHistory,
  updateExistingAddresses,
  updateWalletStatus,
} from '@src/db';
import { WalletStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getWalletId } from '@src/utils';

const mysql = getDbConnection();

// lambda api version: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
const LAMBDA_API_VERSION = '2015-03-31';

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
 * Create a wallet. First checks if the wallet doesn't exist already and then call another
 * lamdba to asynchronously add new wallet info to database
 *
 * This lambda is called by API Gateway on POST /wallet
 */
export const create: APIGatewayProxyHandler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body);
    // event.body might be null, which is also parsed to null
    if (!body) throw new Error('body is null');
  } catch (e) {
    return closeDbAndGetError(mysql, ApiError.INVALID_BODY);
  }

  const xpubkey = body.xpubkey;
  if (!xpubkey) {
    return closeDbAndGetError(mysql, ApiError.MISSING_PARAMETER, { parameter: 'xpubkey' });
  }

  if (!hathorLib.helpers.isXpubKeyValid(xpubkey)) {
    return closeDbAndGetError(mysql, ApiError.INVALID_PARAMETER, { parameter: 'xpubkey' });
  }

  // is wallet already created/creating?
  const walletId = getWalletId(xpubkey);
  let status = await getWallet(mysql, walletId);
  if (status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_ALREADY_CREATED, { status });
  }

  const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);

  // add to wallet table with 'creating' status
  status = await dbCreateWallet(mysql, walletId, xpubkey, maxGap);

  // invoke lambda asynchronously to handle wallet creation
  const lambda = new Lambda({
    apiVersion: LAMBDA_API_VERSION,
    endpoint: process.env.STAGE === 'local'
      ? 'http://localhost:3002'
      : `https://lambda.${process.env.AWS_REGION}.amazonaws.com`,
  });
  const params = {
    // FunctionName is composed of: service name - stage - function name
    FunctionName: `${process.env.SERVICE_NAME}-${process.env.STAGE}-createWalletAsync`,
    InvocationType: 'Event',
    Payload: JSON.stringify({ xpubkey, maxGap }),
  };
  try {
    // TODO setup lambda error handling. It's not an error on lambda.invoke, but an error during lambda execution
    await lambda.invoke(params).promise();
  } catch (e) {
    await updateWalletStatus(mysql, walletId, WalletStatus.ERROR);
    return closeDbAndGetError(mysql, ApiError.UNKNOWN_ERROR, { message: e.message });
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, status }),
  };
};

interface CreateEvent {
  xpubkey: string;
  maxGap: number;
}

interface CreateResult {
  walletId: string;
  xpubkey: string;
}

/*
 * This does the "heavy" work when creating a new wallet, updating the database tables accordingly. It
 * expects a wallet entry already on the database.
 *
 * This lambda is called async by another lambda, the one reponsible for the create wallet API.
 */
export const createWallet: Handler<CreateEvent, CreateResult> = async (event) => {
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
