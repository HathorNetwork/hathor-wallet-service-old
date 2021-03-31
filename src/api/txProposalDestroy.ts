import { APIGatewayProxyHandler } from 'aws-lambda';

import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import {
  getTxProposal,
  updateTxProposal,
  removeTxProposalOutputs,
  releaseTxProposalUtxos,
} from '@src/db';
import { TxProposalStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';
import { closeDbAndGetError } from '@src/api/utils';

const mysql = getDbConnection();

/*
 * Destroy a txProposal.
 *
 * This lambda is called by API Gateway on DELETE /txproposals/{proposalId}
 */
export const destroy: APIGatewayProxyHandler = async (event) => {
  const params = event.pathParameters;
  let txProposalId: string;

  if (params && params.txProposalId) {
    txProposalId = params.txProposalId;
  } else {
    return closeDbAndGetError(mysql, ApiError.MISSING_PARAMETER, { parameter: 'txProposalId' });
  }

  const txProposal = await getTxProposal(mysql, txProposalId);

  if (txProposal === null) {
    return closeDbAndGetError(mysql, ApiError.TX_PROPOSAL_NOT_FOUND);
  }

  if (txProposal.status !== TxProposalStatus.OPEN && txProposal.status !== TxProposalStatus.SEND_ERROR) {
    return closeDbAndGetError(mysql, ApiError.TX_PROPOSAL_NOT_OPEN);
  }

  const now = getUnixTimestamp();

  await updateTxProposal(
    mysql,
    txProposalId,
    now,
    TxProposalStatus.CANCELLED,
  );

  // Delete elements from tx proposal outputs table
  await removeTxProposalOutputs(mysql, txProposalId);

  // Remove tx_proposal_id and tx_proposal_index from utxo table
  await releaseTxProposalUtxos(mysql, txProposalId);

  await closeDbConnection(mysql);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      txProposalId,
    }),
  };
};
