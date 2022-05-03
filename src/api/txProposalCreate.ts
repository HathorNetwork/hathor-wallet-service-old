/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';

import { ApiError } from '@src/api/errors';
import { maybeRefreshWalletConstants, walletIdProxyHandler } from '@src/commons';
import {
  createTxProposal,
  getUtxos,
  getWallet,
  getWalletAddresses,
  getWalletAddressDetail,
  markUtxosWithProposalId,
} from '@src/db';
import {
  AddressInfo,
  IWalletInput,
  DbTxOutput,
} from '@src/types';
import { closeDbAndGetError } from '@src/api/utils';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
import middy from '@middy/core';
import cors from '@middy/http-cors';
import hathorLib from '@hathor/wallet-lib';

const mysql = getDbConnection();

const bodySchema = Joi.object({
  txHex: Joi.string().alphanum(),
});

/*
 * Create a tx-proposal.
 *
 * This lambda is called by API Gateway on POST /txproposals
 */
export const create = middy(walletIdProxyHandler(async (walletId, event) => {
  await maybeRefreshWalletConstants(mysql);

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

  const body = value;
  const tx: hathorLib.Transaction = hathorLib.helpersUtils.createTxFromHex(body.txHex, new hathorLib.Network(process.env.NETWORK));

  if (tx.outputs.length > hathorLib.transaction.getMaxOutputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_OUTPUTS, { outputs: tx.outputs.length });
  }

  const inputs: IWalletInput[] = tx.inputs.map((input) => ({
    txId: input.hash,
    index: input.index,
  }));

  const status = await getWallet(mysql, walletId);

  if (!status) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_FOUND);
  }

  if (!status.readyAt) {
    return closeDbAndGetError(mysql, ApiError.WALLET_NOT_READY);
  }

  const now = getUnixTimestamp();

  // fetch the utxos that will be used
  const inputUtxos: DbTxOutput[] = await getUtxos(mysql, inputs);
  const missing = checkMissingUtxos(inputs, inputUtxos);

  if (missing.length > 0) {
    return closeDbAndGetError(mysql, ApiError.INPUTS_NOT_FOUND, { missing });
  }

  // check if the inputs sent by the user belong to his wallet
  const denied = await validateUtxoAddresses(walletId, inputUtxos);

  if (denied.length > 0) {
    return closeDbAndGetError(mysql, ApiError.INPUTS_NOT_IN_WALLET, { missing });
  }

  // check if inputs sent by user are not part of another tx proposal
  if (checkUsedUtxos(inputUtxos)) {
    return closeDbAndGetError(mysql, ApiError.INPUTS_ALREADY_USED);
  }

  if (inputUtxos.length > hathorLib.transaction.getMaxInputsConstant()) {
    return closeDbAndGetError(mysql, ApiError.TOO_MANY_INPUTS, { inputs: inputUtxos.length });
  }

  // mark utxos with tx-proposal id
  const txProposalId = uuidv4();
  markUtxosWithProposalId(mysql, txProposalId, inputUtxos);

  await createTxProposal(mysql, txProposalId, walletId, now);

  await closeDbConnection(mysql);

  const inputPromises = inputUtxos.map(async (utxo) => {
    const addressDetail: AddressInfo = await getWalletAddressDetail(mysql, walletId, utxo.address);
    // XXX We should store in address table the path of the address, not the index
    // For now we return the hardcoded path with only the address index as variable
    // The client will be prepared to receive any path when we add this in the service in the future
    const addressPath = `m/44'/${hathorLib.constants.HATHOR_BIP44_CODE}'/0'/0/${addressDetail.index}`;
    return { txId: utxo.txId, index: utxo.index, addressPath };
  });

  const retInputs = await Promise.all(inputPromises);

  return {
    statusCode: 201,
    body: JSON.stringify({
      success: true,
      txProposalId,
      inputs: retInputs,
    }),
  };
})).use(cors());

/**
 * Confirm that all inputs requested by the user have been fetched.
 *
 * @param inputs - List of inputs sent by the user
 * @param utxos - List of UTXOs retrieved from database
 * @returns A list with the missing UTXOs, if any
 */
export const checkMissingUtxos = (inputs: IWalletInput[], utxos: DbTxOutput[]): IWalletInput[] => {
  if (inputs.length === utxos.length) return [];

  const remaining = new Set(inputs.map((input) => `${input.txId}_${input.index}`));
  for (const utxo of utxos) {
    remaining.delete(`${utxo.txId}_${utxo.index}`);
  }

  const missing = [];
  for (const utxo of remaining) {
    missing.push({ txId: utxo[0], index: utxo[1] });
  }
  return missing;
};

/**
 * Confirm that the inputs requested by the user are not already being used on another TxProposal
 *
 * @param utxos - List of UTXOs retrieved from database
 * @returns A list with the missing UTXOs, if any
 */
export const checkUsedUtxos = (utxos: DbTxOutput[]): boolean => {
  for (let x = 0; x < utxos.length; x++) {
    if (utxos[x].txProposalId) {
      return true;
    }
  }

  return false;
};

/**
 * Confirm that the requested utxos belongs to the user's wallet
 *
 * @param walletId - The user wallet id
 * @param utxos - List of UTXOs to validate
 * @returns A list with the denied UTXOs, if any
 */
export const validateUtxoAddresses = async (walletId: string, utxos: DbTxOutput[]): Promise<DbTxOutput[]> => {
  // fetch all addresses that belong to this wallet
  const walletAddresses = await getWalletAddresses(mysql, walletId);
  const flatAddresses = walletAddresses.map((walletAddress) => walletAddress.address);
  const denied: DbTxOutput[] = [];

  for (let i = 0; i < utxos.length; i++) {
    if (!flatAddresses.includes(utxos[i].address)) {
      denied.push(utxos[i]);
    }
  }

  return denied;
};
