import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import {
  getWallet,
  getWalletAddresses,
} from '@src/db';
import { closeDbConnection, getDbConnection } from '@src/utils';

const mysql = getDbConnection();

/*
 * Get the addresses of a wallet
 *
 * This lambda is called by API Gateway on GET /addresses
 */
export const get: APIGatewayProxyHandler = async (event) => {
  let walletId: string;
  const params = event.queryStringParameters;
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

  const addresses = await getWalletAddresses(mysql, walletId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, addresses }),
  };
};
