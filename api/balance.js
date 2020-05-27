import {
  getWalletStatus,
  getWalletBalances,
} from '../db';
import { getDbConnection } from '../utils';

const mysql = getDbConnection();


/*
 * Gets the balances of a wallet
 *
 * This lambda is called by API Gateway on GET /balance
 */
export const get = async (event, context, callback) => {
  const params = event.queryStringParameters;
  let walletId = null;
  if (params && params.id) {
    walletId = params.id;
  } else {
    return {
      statusCode: 200,
      body: JSON.stringify({success: false, error: 'missing-parameter', parameter: 'id'}),
    };
  }

  const status = await getWalletStatus(mysql, walletId);
  if (!status) {
    return {
      statusCode: 200,
      body: JSON.stringify({success: false, error: 'wallet-not-found'}),
    };
  }

  let tokenId = null;
  if (params && params.token_id) {
    tokenId = params.token_id;
    //TODO validate tokenId
  }

  const balances = await getWalletBalances(mysql, walletId, tokenId);

  //TODO await mysql.end();
  await mysql.quit();

  return {
    statusCode: 200,
    body: JSON.stringify({success: true, balances}),
  };
};
