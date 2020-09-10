import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';
import hathorLib from '@hathor/wallet-lib';

import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import {
  getWallet,
  getWalletTxHistory,
} from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';

const mysql = getDbConnection();

// XXX add to .env or serverless.yml?
const MAX_COUNT = 15;

const htrToken = hathorLib.constants.HATHOR_TOKEN_CONFIG.uid;

/*
 * Get the tx-history of a wallet
 *
 * This lambda is called by API Gateway on GET /txhistory
 */
export const get: APIGatewayProxyHandler = async (event) => {
  const params = event.queryStringParameters;

  let walletId: string;
  if (params && params.id) {
    walletId = params.id;
  } else {
    return closeDbAndGetError(mysql, ApiError.MISSING_PARAMETER, { parameter: 'id' });
  }

  let tokenId = htrToken;
  // TODO should it be mandatory or optional?
  if (params && params.token_id) {
    tokenId = params.token_id;
    // TODO validate tokenId
  }

  let skip = 0;
  // TODO should it be mandatory or optional?
  if (params && params.skip) {
    skip = parseInt(params.skip, 10);
    if (Number.isNaN(skip)) {
      return closeDbAndGetError(mysql, ApiError.INVALID_PARAMETER, { parameter: 'skip' });
    }
  }

  let count = MAX_COUNT;
  // TODO should it be mandatory or optional?
  if (params && params.count) {
    const parsed = parseInt(params.count, 10);
    if (Number.isNaN(parsed)) {
      return closeDbAndGetError(mysql, ApiError.INVALID_PARAMETER, { parameter: 'count' });
    }
    // we don't return an error if user requests more than the maximum allowed
    count = Math.min(MAX_COUNT, parsed);
  }

  const status = await getWallet(mysql, walletId);
  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }
  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const history = await getWalletTxHistory(mysql, walletId, tokenId, skip, count);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, history, skip, count }),
  };
};
