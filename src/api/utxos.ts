import { APIGatewayProxyHandler } from 'aws-lambda';
import 'source-map-support/register';
import Joi from 'joi';

import { ApiError } from '@src/api/errors';
import {
  filterUtxos,
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
  addresses: Joi.array()
    .items(Joi.string().alphanum())
    .min(1)
    .required(),
  tokenId: Joi.string().default('00'),
  authority: Joi.number().default(0).integer().positive(),
  ignoreLocked: Joi.boolean().optional(),
  biggerThan: Joi.number().integer().positive(),
  smallerThan: Joi.number().integer().positive(),
  maxUtxos: Joi.number().integer().positive().default(constants.MAX_OUTPUTS),
});

/*
 * Filter utxos
 *
 * This lambda is called by API Gateway on POST /filter_utxos
 */
export const getFilteredUtxos: APIGatewayProxyHandler = async (event) => {
  const eventBody = (function parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }(event.body));

  const { value, error } = bodySchema.validate(eventBody, {
    abortEarly: false, // We want it to return all the errors not only the first
    convert: false, // We want it to be strict with the parameters and not parse a string as integer
  });

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD, { details });
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
};
