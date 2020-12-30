import { APIGatewayProxyHandler } from 'aws-lambda';

import 'source-map-support/register';

import { ApiError } from '@src/api/errors';
import {
  getTxProposal,
  updateTxProposal,
  removeTxProposalOutputs,
} from '@src/db';
import { TxProposalStatus } from '@src/types';
import { closeDbConnection, getDbConnection, getUnixTimestamp } from '@src/utils';

const mysql = getDbConnection();

/*
 * Send a transaction.
 *
 * This lambda is called by API Gateway on DELETE /txproposals/{proposalId}
 */
export const destroy: APIGatewayProxyHandler = async (event) => {
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

  const txProposal = await getTxProposal(mysql, txProposalId);

  if (txProposal === null) {
    await closeDbConnection(mysql);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: ApiError.TX_PROPOSAL_NOT_FOUND }),
    };
  }

  const now = getUnixTimestamp();

  await updateTxProposal(
    mysql,
    txProposalId,
    now,
    TxProposalStatus.CANCELLED,
  );

  await removeTxProposalOutputs(mysql, txProposalId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      txProposalId,
    }),
  };
};
