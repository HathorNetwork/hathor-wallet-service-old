import 'source-map-support/register';
import Joi from 'joi';

import { walletIdProxyHandler } from '@src/commons';
import { ApiError } from '@src/api/errors';
import {
  filterUtxos,
  getWalletAddresses,
} from '@src/db';
import {
  DbTxOutput,
  IFilterUtxo,
} from '@src/types';
import { closeDbAndGetError } from '@src/api/utils';
import { getDbConnection } from '@src/utils';
import { constants } from '@hathor/wallet-lib';

const mysql = getDbConnection();

const bodySchema = Joi.object({
  id: Joi.string().optional(),
  addresses: Joi.array()
    .items(Joi.string().alphanum())
    .min(1)
    .optional(),
  tokenId: Joi.string().default('00'),
  authority: Joi.number().default(0).integer().positive(),
  ignoreLocked: Joi.boolean().optional(),
  biggerThan: Joi.number().integer().positive().default(-1),
  smallerThan: Joi.number().integer().positive().default(constants.MAX_OUTPUT_VALUE + 1),
  maxUtxos: Joi.number().integer().positive().default(constants.MAX_OUTPUTS),
});

/*
 * Filter utxos
 *
 * This lambda is called by API Gateway on POST /filter_utxos
 */
export const getFilteredUtxos = walletIdProxyHandler(async (walletId, event) => {
  const multiQueryString = event.multiValueQueryStringParameters || {};
  const queryString = event.queryStringParameters || {};

  const eventBody = {
    addresses: multiQueryString.addresses,
    tokenId: queryString.tokenId,
    authority: queryString.authority,
    ignoreLocked: queryString.ignoreLocked,
    biggerThan: queryString.biggerThan,
    smallerThan: queryString.smallerThan,
  };

  const { value, error } = bodySchema.validate(eventBody, {
    abortEarly: false, // We want it to return all the errors not only the first
    convert: true, // We need to convert as parameters are sent on the QueryString
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
  }

  if (!value.addresses) {
    const walletAddresses = await getWalletAddresses(mysql, walletId);

    value.addresses = walletAddresses.map((addressInfo) => addressInfo.address);
  }

  const body: IFilterUtxo = value;
  const utxos: DbTxOutput[] = await filterUtxos(mysql, body);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      utxos,
    }),
  };
});
