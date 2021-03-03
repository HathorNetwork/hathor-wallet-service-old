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
import Joi from 'joi';

const mysql = getDbConnection();
const getParamsSchema = Joi.object({
  id: Joi.string()
    .required(),
});

/*
 * Get the status of a wallet
 *
 * This lambda is called by API Gateway on GET /wallet
 */
export const get: APIGatewayProxyHandler = async (event) => {
  const params = event.queryStringParameters;

  const { value, error } = getParamsSchema.validate(params, {
    abortEarly: false,
    convert: true, // Skip and count will come as query params as strings
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const walletId: string = value.id;

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

const loadBodySchema = Joi.object({
  xpubkey: Joi.string()
    .required(),
});

/*
 * Load a wallet. First checks if the wallet doesn't exist already and then call another
 * lamdba to asynchronously add new wallet info to database
 *
 * This lambda is called by API Gateway on POST /wallet
 */
export const load: APIGatewayProxyHandler = async (event) => {
  const eventBody = (function parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }(event.body));

  const { value, error } = loadBodySchema.validate(eventBody, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const xpubkey = value.xpubkey;

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
