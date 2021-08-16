import 'source-map-support/register';

import { walletIdProxyHandler } from '@src/commons';
import { getWalletTokens } from '@src/db';
import { getDbConnection } from '@src/utils';

const mysql = getDbConnection();

/*
 * List wallet tokens
 *
 * This lambda is called by API Gateway on GET /wallet/tokens
 */
export const get = walletIdProxyHandler(async (walletId) => {
  const walletTokens: string[] = await getWalletTokens(mysql, walletId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      tokens: walletTokens,
    }),
  };
});
