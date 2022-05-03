import 'source-map-support/register';
import Joi from 'joi';

import { walletIdProxyHandler } from '@src/commons';
import { ApiError } from '@src/api/errors';
import {
  filterTxOutputs,
  getWalletAddresses,
  getTxOutput,
} from '@src/db';
import {
  DbTxOutput,
  DbTxOutputWithPath,
  IFilterTxOutput,
  AddressInfo,
} from '@src/types';
import { closeDbAndGetError } from '@src/api/utils';
import { getDbConnection } from '@src/utils';
import { constants } from '@hathor/wallet-lib';
import middy from '@middy/core';
import cors from '@middy/http-cors';

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
  maxOutputs: Joi.number().integer().positive().default(constants.MAX_OUTPUTS),
  skipSpent: Joi.boolean().optional().default(true),
  txId: Joi.string().optional(),
  index: Joi.number().optional().min(0),
}).and('txId', 'index');

/*
 * Filter utxos
 *
 * This lambda is called by API Gateway on GET /wallet/utxos
 *
 * NOTICE: This method will be deprecated in the future, we are only keeping it because our deployed mobile wallet
 * uses it. As soon as it is updated and we are sure that no users are using that old version, we should remove this
 * API
 */
export const getFilteredUtxos = middy(walletIdProxyHandler(async (walletId, event) => {
  const multiQueryString = event.multiValueQueryStringParameters || {};
  const queryString = event.queryStringParameters || {};

  const eventBody = {
    id: queryString.id,
    addresses: multiQueryString.addresses,
    tokenId: queryString.tokenId,
    authority: queryString.authority,
    ignoreLocked: queryString.ignoreLocked,
    biggerThan: queryString.biggerThan,
    smallerThan: queryString.smallerThan,
    skipSpent: true, // utxo is always unspent
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

  const response = await _getFilteredTxOutputs(walletId, value);

  // The /wallet/utxos API expects `utxos` on the response body, we should transform the
  // response accordingly
  if (response.statusCode === 200) {
    const body = JSON.parse(response.body);
    body.utxos = body.txOutputs;
    delete body.txOutputs;

    response.body = JSON.stringify(body);
  }

  return response;
})).use(cors());

/*
 * Filter tx_outputs
 *
 * This lambda is called by API Gateway on GET /wallet/tx_outputs
 */
export const getFilteredTxOutputs = middy(walletIdProxyHandler(async (walletId, event) => {
  const multiQueryString = event.multiValueQueryStringParameters || {};
  const queryString = event.queryStringParameters || {};

  const eventBody = {
    id: queryString.id,
    addresses: multiQueryString.addresses,
    tokenId: queryString.tokenId,
    authority: queryString.authority,
    ignoreLocked: queryString.ignoreLocked,
    biggerThan: queryString.biggerThan,
    smallerThan: queryString.smallerThan,
    skipSpent: queryString.skipSpent,
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

  return _getFilteredTxOutputs(walletId, value);
})).use(cors());

const _getFilteredTxOutputs = async (walletId: string, filters: IFilterTxOutput) => {
  const walletAddresses = await getWalletAddresses(mysql, walletId);

  // txId will only be on the body when the user is searching for specific tx outputs
  if (filters.txId !== undefined) {
    let txOutputList: DbTxOutputWithPath[] = [];
    const txOutput: DbTxOutput = await getTxOutput(mysql, filters.txId, filters.index, filters.skipSpent);

    if (txOutput) {
      // check if the utxo is a member of the user's wallet
      const denied = validateAddresses(walletAddresses, [txOutput.address]);

      if (denied.length > 0) {
        // the requested utxo does not belong to the user's wallet.
        return closeDbAndGetError(mysql, ApiError.TX_OUTPUT_NOT_IN_WALLET);
      }

      txOutputList = mapTxOutputsWithPath(walletAddresses, [txOutput]);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        txOutputs: txOutputList,
      }),
    };
  }

  const newFilters = {
    ...filters,
  };

  if (newFilters.addresses) {
    const denied = validateAddresses(walletAddresses, newFilters.addresses);

    if (denied.length > 0) {
      return closeDbAndGetError(mysql, ApiError.ADDRESS_NOT_IN_WALLET, { missing: denied });
    }
  } else {
    newFilters.addresses = walletAddresses.map((addressInfo) => addressInfo.address);
  }

  const txOutputs: DbTxOutput[] = await filterTxOutputs(mysql, newFilters);
  const txOutputsWithPath: DbTxOutputWithPath[] = mapTxOutputsWithPath(walletAddresses, txOutputs);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      txOutputs: txOutputsWithPath,
    }),
  };
};

/**
 * Returns a new list of utxos with the addressPaths for each tx_output
 *
 * @param walletAddress - A list of addresses for the user's wallet
 * @param txOutputs - A list of txOutputs to map
 * @returns A list with the mapped tx_outputs
 */
export const mapTxOutputsWithPath = (walletAddresses: AddressInfo[], txOutputs: DbTxOutput[]): DbTxOutputWithPath[] => txOutputs.map((txOutput) => {
  const addressDetail: AddressInfo = walletAddresses.find((address) => address.address === txOutput.address);
  if (!addressDetail) {
    // this should never happen, so we will throw here
    throw new Error('Tx output address not in user\'s wallet');
  }
  const addressPath = `m/44'/${constants.HATHOR_BIP44_CODE}'/0'/0/${addressDetail.index}`;
  return { ...txOutput, addressPath };
});

/**
 * Confirm that the requested addresses belongs to the user's wallet
 *
 * @param walletAddresses - The user wallet id
 * @param addresses - List of addresses to validate
 * @returns A list with the denied addresses, if any
 */
export const validateAddresses = (walletAddresses: AddressInfo[], addresses: string[]): string[] => {
  const flatAddresses = walletAddresses.map((walletAddress) => walletAddress.address);
  const denied: string[] = [];

  for (let i = 0; i < addresses.length; i++) {
    if (!flatAddresses.includes(addresses[i])) {
      denied.push(addresses[i]);
    }
  }

  return denied;
};
