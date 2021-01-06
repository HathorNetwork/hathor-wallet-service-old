import { APIGatewayProxyHandler } from 'aws-lambda';
import hathorLib from '@hathor/wallet-lib';

import Joi from 'joi';

import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import {
  getTxProposal,
  getTxProposalInputs,
  getTxProposalOutputs,
  updateTxProposal,
  removeTxProposalOutputs,
} from '@src/db';
import { TxProposalStatus, ApiResponse } from '@src/types';
import {
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
  validateWeight,
} from '@src/utils';

import {
  maybeRefreshWalletConstants,
} from '@src/commons';

const mysql = getDbConnection();

const paramsSchema = Joi.object({
  txProposalId: Joi.string()
    .guid({
      version: [
        'uuidv4',
        'uuidv5',
      ],
    })
    .required(),
});

const bodySchema = Joi.object({
  timestamp: Joi.date()
    .timestamp()
    .required(),
  parents: Joi.array()
    .required()
    .length(2),
  weight: Joi.number()
    .required(),
  nonce: Joi.number()
    .required(),
  inputsSignatures: Joi.array()
    .required(),
});

/*
 * Send a transaction.
 *
 * This lambda is called by API Gateway on PUT /txproposals/{proposalId}
 */
export const send: APIGatewayProxyHandler = async (event) => {
  if (!event.pathParameters) {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        error: ApiError.MISSING_PARAMETER,
        parameter: 'txProposalId', // this is our only param, so this is safe
      }),
    };
  }

  const { value, error } = paramsSchema.validate(event.pathParameters);

  if (error) {
    // There is only one parameter on this API (txProposalId) and it is on path 0
    const parameter = error.details[0].path[0];

    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_PARAMETER,
        parameter,
      }),
    };
  }

  const { txProposalId } = value;

  const bodyValidation = bodySchema.validate(JSON.parse(event.body));

  if (bodyValidation.error) {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.INVALID_PAYLOAD }),
    };
  }

  const {
    timestamp,
    parents,
    weight,
    nonce,
    inputsSignatures,
  } = bodyValidation.value;

  const txProposal = await getTxProposal(mysql, txProposalId);

  if (txProposal === null) {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.TX_PROPOSAL_NOT_FOUND }),
    };
  }

  if (txProposal.status !== TxProposalStatus.OPEN && txProposal.status !== TxProposalStatus.SEND_ERROR) {
    // we can only send if it's still open or there was an error sending before
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.TX_PROPOSAL_NOT_OPEN, status: txProposal.status }),
    };
  }

  // TODO validate max input signature size
  // input: tx_id, index, data
  const inputs = [];
  const usedUtxos = await getTxProposalInputs(mysql, txProposalId);
  for (const [i, utxo] of usedUtxos.entries()) {
    // Deserialize from base64
    const inputSignature = Buffer.from(inputsSignatures[i], 'base64');

    inputs.push({
      tx_id: utxo.txId,
      index: utxo.index,
      data: inputSignature,
    });
  }

  const proposalOutputs = await getTxProposalOutputs(mysql, txProposalId);
  const tokensSet = new Set(proposalOutputs.map((output) => (output.token)));
  tokensSet.delete(hathorLib.constants.HATHOR_TOKEN_CONFIG.uid);
  const tokens = Array.from(tokensSet);

  // output: value, tokenData, address, timelock
  const outputs = [];
  for (const output of proposalOutputs) {
    outputs.push({
      value: output.value,
      address: output.address,
      timelock: output.timelock,
      tokenData: output.token === hathorLib.constants.HATHOR_TOKEN_CONFIG.uid ? 0 : tokens.indexOf(output.token) + 1,
    });
  }

  const txData = {
    version: hathorLib.constants.DEFAULT_TX_VERSION,
    parents,
    timestamp,
    weight,
    nonce,
    tokens,
    inputs,
    outputs,
  };

  await maybeRefreshWalletConstants(mysql);

  // Validate TX_WEIGHT
  const calculatedTxWeight = hathorLib.transaction.calculateTxWeight(txData);

  if (!validateWeight(calculatedTxWeight, txData.weight)) {
    await closeDbConnection(mysql);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        error: ApiError.INVALID_TX_WEIGHT,
        message: `Expected weight >= ${calculatedTxWeight}`,
      }),
    };
  }

  const txHex = hathorLib.transaction.getTxHexFromData(txData);

  const now = getUnixTimestamp();

  try {
    const response: ApiResponse = await new Promise((resolve) => {
      hathorLib.txApi.pushTx(txHex, false, resolve);
    });

    if (!response.success) throw new Error(response.message);

    await updateTxProposal(
      mysql,
      txProposalId,
      now,
      TxProposalStatus.SENT,
    );

    await removeTxProposalOutputs(mysql, txProposalId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        txProposalId,
        txHex,
      }),
    };
  } catch (e) {
    await updateTxProposal(
      mysql,
      txProposalId,
      now,
      TxProposalStatus.SEND_ERROR,
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        message: e.message,
        txProposalId,
        txHex,
      }),
    };
  } finally {
    await closeDbConnection(mysql);
  }
};
