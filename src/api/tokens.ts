import 'source-map-support/register';

import { walletIdProxyHandler } from '@src/commons';
import {
  getWalletTokens,
  getTotalSupply,
  getTotalTransactions,
  getTokenInformation,
  getAuthorityUtxo,
} from '@src/db';
import {
  TokenInfo,
  DbTxOutput,
} from '@src/types';
import { getDbConnection } from '@src/utils';
import { ApiError } from '@src/api/errors';
import { closeDbAndGetError } from '@src/api/utils';
import Joi from 'joi';
import { constants } from '@hathor/wallet-lib';

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

  if (!tokenInfo) {
    const details = [{
      message: 'Token not found',
    }];

    return closeDbAndGetError(mysql, ApiError.TOKEN_NOT_FOUND, { details });
  }

  const [
    totalSupply,
    totalTransactions,
    meltAuthority,
    mintAuthority,
  ] = await Promise.all([
    getTotalSupply(mysql, tokenId),
    getTotalTransactions(mysql, tokenId),
    getAuthorityUtxo(mysql, tokenId, constants.TOKEN_MELT_MASK),
    getAuthorityUtxo(mysql, tokenId, constants.TOKEN_MINT_MASK),
  ]);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      details: {
        tokenInfo,
        totalSupply,
        totalTransactions,
        authorities: {
          mint: mintAuthority !== null,
          melt: meltAuthority !== null,
        },
      },
    }),
  };
});
