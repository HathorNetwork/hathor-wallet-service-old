/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
  updateWalletAuthXpub,
} from '@src/db';
import { WalletStatus } from '@src/types';
import {
  closeDbConnection,
  getDbConnection,
  getWalletId,
  verifySignature,
  getAddressFromXpub,
  confirmFirstAddress,
  validateAuthTimestamp,
  AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS,
} from '@src/utils';
import { closeDbAndGetError, warmupMiddleware } from '@src/api/utils';
import { walletIdProxyHandler } from '@src/commons';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import Joi from 'joi';
import createDefaultLogger from '@src/logger';

const mysql = getDbConnection();

const MAX_LOAD_WALLET_RETRIES: number = parseInt(process.env.MAX_LOAD_WALLET_RETRIES || '5', 10);

/*
 * Get the status of a wallet
 *
 * This lambda is called by API Gateway on GET /wallet
 */
export const get: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId) => {
  const status = await getWallet(mysql, walletId);
  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, status }),
  };
})).use(cors())
  .use(warmupMiddleware());

// If the env requires to validate the first address
// then we must set the firstAddress field as required
const shouldConfirmFirstAddress = process.env.CONFIRM_FIRST_ADDRESS === 'true';
const firstAddressJoi = shouldConfirmFirstAddress ? Joi.string().required() : Joi.string();

const loadBodySchema = Joi.object({
  xpubkey: Joi.string()
    .required(),
  authXpubkey: Joi.string()
    .required(),
  xpubkeySignature: Joi.string()
    .required(),
  authXpubkeySignature: Joi.string()
    .required(),
  timestamp: Joi.number().positive().required(),
  firstAddress: firstAddressJoi,
});

/**
 * Invoke the loadWalletAsync function
 *
 * @param xpubkey - The xpubkey to load
 * @param maxGap - The max gap
 */
/* istanbul ignore next */
export const invokeLoadWalletAsync = async (xpubkey: string, maxGap: number): Promise<void> => {
  // invoke lambda asynchronously to handle wallet creation
  const lambda = new Lambda({
    apiVersion: '2015-03-31',
    endpoint: process.env.STAGE === 'dev'
      ? 'http://localhost:3002'
      : `https://lambda.${process.env.AWS_REGION}.amazonaws.com`,
  });

  const params = {
    // FunctionName is composed of: service name - stage - function name
    FunctionName: `${process.env.SERVICE_NAME}-${process.env.STAGE}-loadWalletAsync`,
    InvocationType: 'Event',
    Payload: JSON.stringify({ xpubkey, maxGap }),
  };

  const response = await lambda.invoke(params).promise();

  // Event InvocationType returns 202 for a successful invokation
  if (response.StatusCode !== 202) {
    throw new Error('Lambda invoke failed');
  }
};

/**
 * Calls verifySignature for both the wallet's xpub signature and
 * the auth_xpub signature.
 *
 * @param walletId - The wallet id
 * @param timestamp - The timestamp the message has been signed with
 * @param xpubkeyStr - A string with the wallet's xpubkey
 * @param xpubkeySignature - A string with the signature that proves the user owns the xpub
 * @param authXpubkeyStr - A string with the auth xpubkey
 * @param authXpubkeySignature- A string with the signature that proves the user owns the xpub
 */
export const validateSignatures = (
  walletId: string,
  timestamp: number,
  xpubkeyStr: string,
  xpubkeySignature: string,
  authXpubkeyStr: string,
  authXpubkeySignature: string,
): boolean => {
  // verify that the user owns the xpubkey
  const xpubAddress = getAddressFromXpub(xpubkeyStr);
  const xpubValid = verifySignature(xpubkeySignature, timestamp, xpubAddress, walletId.toString());

  // verify that the user owns the auth_xpubkey
  const authXpubAddress = getAddressFromXpub(authXpubkeyStr);
  const authXpubValid = verifySignature(authXpubkeySignature, timestamp, authXpubAddress, walletId.toString());

  return xpubValid && authXpubValid;
};

/*
 * Changes the auth_xpubkey of a wallet after validating the user owns both the xpub and the auth_xpub
 *
 * This lambda is called by API Gateway on PUT /wallet/auth
 */
export const changeAuthXpub: APIGatewayProxyHandler = middy(async (event) => {
  const eventBody = (function parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }(event.body));

  // body should have the same schema as load
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

  const xpubkeyStr = value.xpubkey;
  const authXpubkeyStr = value.authXpubkey;

  const timestamp = value.timestamp;
  const xpubkeySignature = value.xpubkeySignature;
  const authXpubkeySignature = value.authXpubkeySignature;

  const [validTimestamp, timestampShift] = validateAuthTimestamp(timestamp, Date.now() / 1000);

  if (!validTimestamp) {
    const details = [{
      message: `The timestamp is shifted ${timestampShift}(s). Limit is ${AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS}(s).`,
    }];

    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_PAYLOAD,
        details,
      }),
    };
  }

  // is wallet already loaded/loading?
  const walletId = getWalletId(xpubkeyStr);
  const wallet = await getWallet(mysql, walletId);

  if (!wallet) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (shouldConfirmFirstAddress) {
    const expectedFirstAddress = value.firstAddress;
    const [firstAddressEqual, firstAddress] = confirmFirstAddress(expectedFirstAddress, xpubkeyStr);

    if (!firstAddressEqual) {
      return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, {
        message: `Expected first address to be ${expectedFirstAddress} but it is ${firstAddress}`,
      });
    }
  }

  const signaturesValid = validateSignatures(walletId, timestamp, xpubkeyStr, xpubkeySignature, authXpubkeyStr, authXpubkeySignature);

  if (!signaturesValid) {
    await closeDbConnection(mysql);

    const details = [{
      message: 'Signatures are not valid',
    }];

    return {
      statusCode: 403,
      body: JSON.stringify({ success: false, details }),
    };
  }

  await updateWalletAuthXpub(mysql, walletId, authXpubkeyStr);

  const updatedWallet = await getWallet(mysql, walletId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      status: updatedWallet,
    }),
  };
}).use(cors());

/*
 * Load a wallet. First checks if the wallet doesn't exist already and then call another
 * lamdba to asynchronously add new wallet info to database
 *
 * This lambda is called by API Gateway on POST /wallet
 */
export const load: APIGatewayProxyHandler = middy(async (event) => {
  const logger = createDefaultLogger();
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

  const xpubkeyStr = value.xpubkey;
  const authXpubkeyStr = value.authXpubkey;
  const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);

  const timestamp = value.timestamp;
  const xpubkeySignature = value.xpubkeySignature;
  const authXpubkeySignature = value.authXpubkeySignature;

  const [validTimestamp, timestampShift] = validateAuthTimestamp(timestamp, Date.now() / 1000);

  if (!validTimestamp) {
    const details = [{
      message: `The timestamp is shifted ${timestampShift}(s). Limit is ${AUTH_MAX_TIMESTAMP_SHIFT_IN_SECONDS}(s).`,
    }];

    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_PAYLOAD,
        details,
      }),
    };
  }

  // is wallet already loaded/loading?
  const walletId = getWalletId(xpubkeyStr);
  let wallet = await getWallet(mysql, walletId);

  // check if wallet is already loaded so we can fail early
  if (wallet) {
    if (wallet.status === WalletStatus.READY
      || wallet.status === WalletStatus.CREATING) {
      return closeDbAndGetError(mysql, ApiError.WALLET_ALREADY_LOADED, { status: wallet });
    }

    if (wallet.status === WalletStatus.ERROR
        && wallet.retryCount >= MAX_LOAD_WALLET_RETRIES) {
      return closeDbAndGetError(mysql, ApiError.WALLET_MAX_RETRIES, { status: wallet });
    }
  }

  if (shouldConfirmFirstAddress) {
    const expectedFirstAddress = value.firstAddress;
    const [firstAddressEqual, firstAddress] = confirmFirstAddress(expectedFirstAddress, xpubkeyStr);

    if (!firstAddressEqual) {
      return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, {
        message: `Expected first address to be ${expectedFirstAddress} but it is ${firstAddress}`,
      });
    }
  }

  if (!validateSignatures(walletId, timestamp, xpubkeyStr, xpubkeySignature, authXpubkeyStr, authXpubkeySignature)) {
    await closeDbConnection(mysql);

    const details = [{
      message: 'Signatures are not valid',
    }];

    return {
      statusCode: 403,
      body: JSON.stringify({ success: false, details }),
    };
  }

  // if wallet does not exist at this point, we should add it to the wallet table with 'creating' status
  if (!wallet) {
    wallet = await createWallet(mysql, walletId, xpubkeyStr, authXpubkeyStr, maxGap);
  }

  try {
    /* This calls the lambda function as a "Event", so we don't care here for the response,
     * we only care if the invokation failed or not
     */
    await invokeLoadWalletAsync(xpubkeyStr, maxGap);
  } catch (e) {
    logger.error('Error on lambda wallet invoke', e);

    const newRetryCount = wallet.retryCount ? wallet.retryCount + 1 : 1;
    // update wallet status to 'error'
    await updateWalletStatus(mysql, walletId, WalletStatus.ERROR, newRetryCount);

    // refresh the variable with latest status, so we can return it properly
    wallet = await getWallet(mysql, walletId);
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, status: wallet }),
  };
}).use(cors())
  .use(warmupMiddleware());

interface LoadEvent {
  source?: string;
  xpubkey: string;
  maxGap: number;
}

interface LoadResult {
  success: boolean;
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
  const logger = createDefaultLogger();
  // Can't use a middleware on this event, so we should just check the source (added by the warmup plugin) as
  // our default middleware does
  if (event.source === 'serverless-plugin-warmup') {
    return {
      success: true,
      walletId: '',
      xpubkey: '',
    };
  }

  const xpubkey = event.xpubkey;
  const maxGap = event.maxGap;
  const walletId = getWalletId(xpubkey);

  try {
    const { addresses, existingAddresses, newAddresses, lastUsedAddressIndex } = await generateAddresses(mysql, xpubkey, maxGap);

    // update address table with new addresses
    await addNewAddresses(mysql, walletId, newAddresses, lastUsedAddressIndex);

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
      success: true,
      walletId,
      xpubkey,
    };
  } catch (e) {
    logger.error('Erroed on loadWalletAsync: ', e);

    const wallet = await getWallet(mysql, walletId);
    const newRetryCount = wallet.retryCount ? wallet.retryCount + 1 : 1;

    await updateWalletStatus(mysql, walletId, WalletStatus.ERROR, newRetryCount);

    return {
      success: false,
      walletId,
      xpubkey,
    };
  }
};
