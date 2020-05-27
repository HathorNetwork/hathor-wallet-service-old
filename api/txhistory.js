import {
  getWalletStatus,
  getWalletTxHistory,
} from '../db';
import { getDbConnection } from '../utils';

const mysql = getDbConnection();

// XXX add to .env or serverless.yml?
const MAX_COUNT = 15;

//TODO get from lib
const htrToken = '00';


/*
 * Gets the tx-history of a wallet
 *
 * This lambda is called by API Gateway on GET /txhistory
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

  let tokenId = htrToken;
  //TODO should it be mandatory or optional?
  if (params && params.token_id) {
    tokenId = params.token_id;
    //TODO validate tokenId
  }

  let skip = 0;
  //TODO should it be mandatory or optional?
  if (params && params.skip) {
    skip = parseInt(params.skip, 10);
    if (isNaN(skip)) {
      return {
        statusCode: 200,
        body: JSON.stringify({success: false, error: 'invalid-parameter', parameter: 'skip'}),
      };
    }
  }

  let count = MAX_COUNT;
  //TODO should it be mandatory or optional?
  if (params && params.count) {
    const parsed = parseInt(params.count, 10);
    if (isNaN(parsed)) {
      return {
        statusCode: 200,
        body: JSON.stringify({success: false, error: 'invalid-parameter', parameter: 'count'}),
      };
    }
    // we don't return an error if user requests more than the maximum allowed
    count = Math.min(MAX_COUNT, parsed);
  }

  const status = await getWalletStatus(mysql, walletId);
  if (!status) {
    return {
      statusCode: 200,
      body: JSON.stringify({success: false, error: 'wallet-not-found'}),
    };
  }

  const history = await getWalletTxHistory(mysql, walletId, tokenId, skip, count);

  //TODO await mysql.end();
  await mysql.quit();

  return {
    statusCode: 200,
    body: JSON.stringify({success: true, history, skip, count}),
  };
};
