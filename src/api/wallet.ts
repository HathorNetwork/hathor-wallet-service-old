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
} from '@src/db';
import { WalletStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getWalletId } from '@src/utils';
import { closeDbAndGetError } from '@src/api/utils';
import { walletIdProxyHandler } from '@src/commons';
import Joi from 'joi';
import { walletUtils } from '@hathor/wallet-lib';
import {
  bjsGetAddressAtIndex,
  bjsGetAddresses,
  bjsXpubDeriveChild,
} from '@src/bjsPocUtils';

const mysql = getDbConnection();

const MAX_LOAD_WALLET_RETRIES: number = parseInt(process.env.MAX_LOAD_WALLET_RETRIES || '5', 10);

/*
 * Get the status of a wallet
 *
 * This lambda is called by API Gateway on GET /wallet
 */
export const get: APIGatewayProxyHandler = walletIdProxyHandler(async (walletId) => {
  const status = await getWallet(mysql, walletId);
  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, status }),
  };
});

// If the env requires to validate the first address
// then we must set the firstAddress field as required
const confirmFirstAddress = process.env.CONFIRM_FIRST_ADDRESS === 'true';
const firstAddressJoi = confirmFirstAddress ? Joi.string().required() : Joi.string();

const loadBodySchema = Joi.object({
  xpubkey: Joi.string()
    .required(),
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
  const maxGap = parseInt(process.env.MAX_ADDRESS_GAP, 10);

  // is wallet already loaded/loading?
  const walletId = getWalletId(xpubkey);
  console.time('getWallet');
  let wallet = await getWallet(mysql, walletId);
  console.timeEnd('getWallet');

  if (wallet) {
    if (wallet.status === WalletStatus.READY
      || wallet.status === WalletStatus.CREATING) {
      return closeDbAndGetError(mysql, ApiError.WALLET_ALREADY_LOADED, { status: wallet });
    }

    if (wallet.status === WalletStatus.ERROR
        && wallet.retryCount >= MAX_LOAD_WALLET_RETRIES) {
      return closeDbAndGetError(mysql, ApiError.WALLET_MAX_RETRIES, { status: wallet });
    }
  } else {
    // wallet does not exist yet. Add to wallet table with 'creating' status
    console.time('create wallet');
    wallet = await createWallet(mysql, walletId, xpubkey, maxGap);
    console.timeEnd('create wallet');
  }

  if (process.env.CONFIRM_FIRST_ADDRESS === 'true') {
    const expectedFirstAddress = value.firstAddress;

    // First derive xpub to change 0 path
    console.time('xpubDeriveChild');
    const derivedXpub = bjsXpubDeriveChild(xpubkey, 0);
    console.timeEnd('xpubDeriveChild');
    // Then get first address
    console.time('getAddressAtIndex');
    const firstAddress = bjsGetAddressAtIndex(derivedXpub, 0);
    console.timeEnd('getAddressAtIndex');
    if (firstAddress !== expectedFirstAddress) {
      return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, {
        message: `Expected first address to be ${expectedFirstAddress} but it is ${firstAddress}`,
      });
    }
  }

  try {
    /* This calls the lambda function as a "Event", so we don't care here for the response,
     * we only care if the invokation failed or not
     */
    console.time('invokeLoadWalletAsync');
    await invokeLoadWalletAsync(xpubkey, maxGap);
    console.timeEnd('invokeLoadWalletAsync');
  } catch (e) {
    console.error('Error on lambda wallet invoke', e);

    const newRetryCount = wallet.retryCount ? wallet.retryCount + 1 : 1;
    // update wallet status to 'error'
    console.time('updateWalletStatus');
    await updateWalletStatus(mysql, walletId, WalletStatus.ERROR, newRetryCount);
    console.timeEnd('updateWalletStatus');

    // refresh the variable with latest status, so we can return it properly
    console.time('getWallet');
    wallet = await getWallet(mysql, walletId);
    console.timeEnd('getWallet');
  }

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, status: wallet }),
  };
};

interface LoadEvent {
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
  const xpubkey = event.xpubkey;
  const maxGap = event.maxGap;
  console.time('getWalletId');
  const walletId = getWalletId(xpubkey);
  console.timeEnd('getWalletId');

  try {
    console.time('generateAddresses');
    const { addresses, existingAddresses, newAddresses } = await generateAddresses(mysql, xpubkey, maxGap);
    console.timeEnd('generateAddresses');

    // update address table with new addresses
    console.time('addNewAddresses');
    await addNewAddresses(mysql, walletId, newAddresses);
    console.timeEnd('addNewAddresses');

    // update existing addresses' walletId and index
    console.time('updateExistingAddresses');
    await updateExistingAddresses(mysql, walletId, existingAddresses);
    console.timeEnd('updateExistingAddresses');

    // from address_tx_history, update wallet_tx_history
    console.time('initWalletTxHistory');
    await initWalletTxHistory(mysql, walletId, addresses);
    console.timeEnd('initWalletTxHistory');

    // from address_balance table, update balance table
    console.time('initWalletBalance');
    await initWalletBalance(mysql, walletId, addresses);
    console.timeEnd('initWalletBalance');

    // update wallet status to 'ready'
    console.time('updateWalletStatus');
    await updateWalletStatus(mysql, walletId, WalletStatus.READY);
    console.timeEnd('updateWalletStatus');

    await closeDbConnection(mysql);

    return {
      success: true,
      walletId,
      xpubkey,
    };
  } catch (e) {
    console.error('Erroed on loadWalletAsync: ', e);

    console.time('getWallet');
    const wallet = await getWallet(mysql, walletId);
    console.timeEnd('getWallet');
    const newRetryCount = wallet.retryCount ? wallet.retryCount + 1 : 1;

    console.time('updateWalletStatus');
    await updateWalletStatus(mysql, walletId, WalletStatus.ERROR, newRetryCount);
    console.timeEnd('updateWalletStatus');

    return {
      success: false,
      walletId,
      xpubkey,
    };
  }
};
