import 'source-map-support/register';

import { walletIdProxyHandler } from '@src/commons';
import {
  getWalletTokens,
  getTotalSupply,
  getTotalTransactions,
  getTokenInformation,
} from '@src/db';
import {
  TokenInfo,
} from '@src/types';
import { getDbConnection } from '@src/utils';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import Joi from 'joi';

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

const getTokenDetailsParamsSchema = Joi.object({
  token_id: Joi.string()
    .alphanum()
    .required(),
});

/*
 * Get token details
 *
 * This lambda is called by API Gateway on GET /wallet/tokens/:token_id/details
 */
export const getTokenDetails = walletIdProxyHandler(async (walletId, event) => {
  const params = event.queryStringParameters || {};

  const { value, error } = getTokenDetailsParamsSchema.validate(params, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  const tokenInfo: TokenInfo = await getTokenInformation(mysql, value.tokenId);
  const totalSupply: number = await getTotalSupply(mysql, value.tokenId);
  const totalTransactions: number = await getTotalTransactions(mysql, value.tokenId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      data: {
        totalSupply,
        totalTransactions,
        tokenInfo,
      },
    }),
  };
});
