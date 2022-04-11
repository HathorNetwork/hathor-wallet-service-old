import 'source-map-support/register';

import { walletIdProxyHandler } from '@src/commons';
import {
  getWalletTokens,
  getTotalSupply,
  getTotalTransactions,
  getTokenInformation,
  getAvailableAuthorities,
} from '@src/db';
import {
  TokenInfo,
  DbTxOutput,
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
  const params = event.pathParameters || {};

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

  const tokenId = value.token_id;

  const tokenInfo: TokenInfo = await getTokenInformation(mysql, tokenId);
  const totalSupply: number = await getTotalSupply(mysql, tokenId);
  const totalTransactions: number = await getTotalTransactions(mysql, tokenId);
  const availableAuthorities: DbTxOutput[] = await getAvailableAuthorities(mysql, tokenId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      details: {
        totalSupply,
        totalTransactions,
        tokenInfo,
        availableAuthorities,
      },
    }),
  };
});
