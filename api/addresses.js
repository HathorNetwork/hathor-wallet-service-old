import {
  getWalletStatus,
  getWalletAddresses,
} from '../db';
import { getDbConnection } from '../utils';

const mysql = getDbConnection();


/*
 * Gets the addresses of a wallet
 *
 * This lambda is called by API Gateway on GET /addresses
 */
export const get = async (event, context, callback) => {
  let walletId = null;
  const params = event.queryStringParameters;
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

  const addresses = await getWalletAddresses(mysql, walletId);

  //TODO await mysql.end();
  await mysql.quit();

  return {
    statusCode: 200,
    body: JSON.stringify({success: true, addresses}),
  };
};
