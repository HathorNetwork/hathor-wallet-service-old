import 'source-map-support/register';
import Joi from 'joi';

import { walletIdProxyHandler } from '@src/commons';
import { ApiError } from '@src/api/errors';
import {
  filterUtxos,
  getWalletAddresses,
  getUtxo,
} from '@src/db';
import {
  DbTxOutput,
  DbTxOutputWithPath,
  IFilterUtxo,
  AddressInfo,
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
  txId: Joi.string().optional(),
  index: Joi.number().optional().min(0),
}).and('txId', 'index');

/*
 * Filter utxos
 *
 * This lambda is called by API Gateway on GET /wallet/utxos
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
    txId: queryString.txId,
    index: queryString.index,
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

  const walletAddresses = await getWalletAddresses(mysql, walletId);

  if (value.txId !== undefined) {
    const utxo: DbTxOutput = await getUtxo(mysql, value.txId, value.index);

    if (!utxo) {
      return closeDbAndGetError(mysql, ApiError.UTXO_NOT_FOUND);
    }

    // check if the utxo is a member of the user's wallet
    const denied = await validateAddresses(walletAddresses, [utxo.address]);

    if (denied.length > 0) {
      // the requested utxo does not belong to the user's wallet.
      return closeDbAndGetError(mysql, ApiError.FORBIDDEN);
    }

    const utxoList: DbTxOutputWithPath[] = mapUtxosWithPath(walletAddresses, [utxo]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        utxos: utxoList,
      }),
    };
  }

  if (value.addresses) {
    const denied = await validateAddresses(walletAddresses, value.addresses);

    if (denied.length > 0) {
      return closeDbAndGetError(mysql, ApiError.ADDRESS_NOT_IN_WALLET, { missing: denied });
    }
  } else {
    value.addresses = walletAddresses.map((addressInfo) => addressInfo.address);
  }

  const body: IFilterUtxo = value;
  const utxos: DbTxOutput[] = await filterUtxos(mysql, body);
  const utxosWithPath: DbTxOutputWithPath[] = mapUtxosWithPath(walletAddresses, utxos);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      utxos: utxosWithPath,
    }),
  };
});

/**
 * Returns a new list of utxos with the addressPaths for each utxo
 *
 * @param walletAddress - A list of addresses for the user's wallet
 * @param utxos - A list of utxos to map
 * @returns A list with the mapped utxos
 */
export const mapUtxosWithPath = (walletAddresses: AddressInfo[], utxos: DbTxOutput[]): DbTxOutputWithPath[] => utxos.map((utxo) => {
  const addressDetail: AddressInfo = walletAddresses.find((address) => address.address === utxo.address);
  if (!addressDetail) {
    // this should never happen, so we will throw here
    throw new Error('Utxo address not in user\'s wallet');
  }
  const addressPath = `m/44'/${constants.HATHOR_BIP44_CODE}'/0'/0/${addressDetail.index}`;
  return { ...utxo, addressPath };
});

/**
 * Confirm that the requested addresses belongs to the user's wallet
 *
 * @param walletAddresses - The user wallet id
 * @param addresses - List of addresses to validate
 * @returns A list with the denied addresses, if any
 */
export const validateAddresses = async (walletAddresses: AddressInfo[], addresses: string[]): Promise<string[]> => {
  const flatAddresses = walletAddresses.map((walletAddress) => walletAddress.address);
  const denied: string[] = [];

  for (let i = 0; i < addresses.length; i++) {
    if (!flatAddresses.includes(addresses[i])) {
      denied.push(addresses[i]);
    }
  }

  return denied;
};
