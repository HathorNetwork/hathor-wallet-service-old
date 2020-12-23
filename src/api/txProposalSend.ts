import { APIGatewayProxyHandler } from 'aws-lambda';
import hathorLib from '@hathor/wallet-lib';

import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import {
  getTxProposal,
  getTxProposalInputs,
  getTxProposalOutputs,
  updateTxProposal,
  removeTxProposalOutputs,
} from '@src/db';
import { TxProposalStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';

const mysql = getDbConnection();

hathorLib.network.setNetwork('mainnet');

/*
 * Send a transaction.
 *
 * This lambda is called by API Gateway on PUT /txproposals/{proposalId}
 */
export const send: APIGatewayProxyHandler = async (event) => {
  const params = event.pathParameters;
  let txProposalId: string;
  if (params && params.txProposalId) {
    txProposalId = params.txProposalId;
  } else {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.MISSING_PARAMETER, parameter: 'txProposalId' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
    // event.body might be null, which is also parsed to null
    if (!body) throw new Error('body is null');
  } catch (e) {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.INVALID_PAYLOAD }),
    };
  }

  // TODO validate params, maybe use Joi (https://joi.dev/api/)

  const timestamp = body.timestamp;
  const parents = body.parents;
  const weight = body.weight;
  const nonce = body.nonce;
  const inputsSignatures = body.inputsSignatures;

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
    inputs.push({
      tx_id: utxo.txId,
      index: utxo.index,
      data: inputsSignatures[i],
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

  const txHex = hathorLib.transaction.getTxHexFromData(txData);

  // TODO update database (update proposal table, remove from tx_proposal_outputs)

  await closeDbConnection(mysql);

  try {
    await hathorLib.txApi.pushTx(txHex, false);

    const now = getUnixTimestamp();

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
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        txProposalId,
        txHex,
      }),
    };
  }
};
