import { APIGatewayProxyHandler } from 'aws-lambda';
import hathorLib from '@hathor/wallet-lib';

import Joi from 'joi';

import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import {
  getTxProposal,
  getTxProposalInputs,
  updateTxProposal,
} from '@src/db';
import {
  TxProposalStatus,
  ApiResponse,
} from '@src/types';
import {
  closeDbConnection,
  getDbConnection,
  getUnixTimestamp,
} from '@src/utils';

import {
  walletIdProxyHandler,
} from '@src/commons';

import { closeDbAndGetError } from '@src/api/utils';
import middy from '@middy/core';
import cors from '@middy/http-cors';

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
  txHex: Joi.string().alphanum(),
});

/*
 * Send a transaction.
 *
 * This lambda is called by API Gateway on PUT /txproposals/{proposalId}
 */
export const send: APIGatewayProxyHandler = middy(walletIdProxyHandler(async (walletId, event) => {
  if (!event.pathParameters) {
    return closeDbAndGetError(mysql, ApiError.MISSING_PARAMETER, { parameter: 'txProposalId' });
  }

  const { value, error } = paramsSchema.validate(event.pathParameters);

  if (error) {
    // There is only one parameter on this API (txProposalId) and it is on path 0
    const parameter = error.details[0].path[0];

    return closeDbAndGetError(mysql, ApiError.INVALID_PARAMETER, { parameter });
  }

  const { txProposalId } = value;

  const bodyValidation = bodySchema.validate(JSON.parse(event.body));

  if (bodyValidation.error) {
    return closeDbAndGetError(mysql, ApiError.INVALID_PAYLOAD);
  }

  const { txHex } = bodyValidation.value;
  const txProposal = await getTxProposal(mysql, txProposalId);

  if (txProposal === null) {
    return closeDbAndGetError(mysql, ApiError.TX_PROPOSAL_NOT_FOUND);
  }

  if (txProposal.walletId !== walletId) {
    return closeDbAndGetError(mysql, ApiError.FORBIDDEN);
  }

  // we can only send if it's still open or there was an error sending before
  if (txProposal.status !== TxProposalStatus.OPEN && txProposal.status !== TxProposalStatus.SEND_ERROR) {
    return closeDbAndGetError(mysql, ApiError.TX_PROPOSAL_NOT_OPEN, { status: txProposal.status });
  }

  const now = getUnixTimestamp();
  const txProposalInputs = await getTxProposalInputs(mysql, txProposalId);
  const tx = hathorLib.helpersUtils.createTxFromHex(txHex, new hathorLib.Network(process.env.NETWORK));

  if (tx.inputs.length !== txProposalInputs.length) {
    return closeDbAndGetError(mysql, ApiError.TX_PROPOSAL_NO_MATCH);
  }

  const txHexInputHashes = tx.inputs.map((input) => input.hash);

  for (let i = 0; i < txProposalInputs.length; i++) {
    // Validate that the inputs on the txHex are the same as those sent on txProposalCreate
    if (txHexInputHashes.indexOf(txProposalInputs[i].txId) < 0) {
      return closeDbAndGetError(mysql, ApiError.TX_PROPOSAL_NO_MATCH);
    }
  }

  try {
    const response: ApiResponse = await new Promise((resolve) => {
      hathorLib.txApi.pushTx(txHex, false, resolve);
    });

    if (!response.success) throw new Error(response.message);

    await updateTxProposal(
      mysql,
      [txProposalId],
      now,
      TxProposalStatus.SENT,
    );

    await closeDbConnection(mysql);

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
      [txProposalId],
      now,
      TxProposalStatus.SEND_ERROR,
    );

    return closeDbAndGetError(mysql, ApiError.TX_PROPOSAL_SEND_ERROR, {
      message: e.message,
      txProposalId,
      txHex,
    });
  }
})).use(cors());
