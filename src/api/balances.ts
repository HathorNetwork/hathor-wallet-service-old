import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import { getWalletBalances } from '@src/commons';
import { getWallet } from '@src/db';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';

const mysql = getDbConnection();

/*
 * Get the balances of a wallet
 *
 * This lambda is called by API Gateway on GET /balances
 */
export const get: APIGatewayProxyHandler = async (event) => {
  const params = event.queryStringParameters;
  let walletId: string;
  if (params && params.id) {
    walletId = params.id;
  } else {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.MISSING_PARAMETER, parameter: 'id' }),
    };
  }

  const status = await getWallet(mysql, walletId);
  if (!status) {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.WALLET_NOT_FOUND }),
    };
  }

  const tokenIds: string[] = [];
  if (params && params.token_id) {
    const tokenId = params.token_id;
    // TODO validate tokenId
    tokenIds.push(tokenId);
  }

  const balances = await getWalletBalances(mysql, getUnixTimestamp(), walletId, tokenIds);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, balances }),
  };
};
