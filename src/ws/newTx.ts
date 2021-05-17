/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { getUnixTimestamp } from '@src/utils';
import { connectionUrlFromEvent, sendMessageToClient } from '@src/ws/utils';
import { wsGetWalletConnections } from '@src/redis';
import { Transaction } from '@src/types';

export const handler = async (
  event: SQSEvent,
): Promise<APIGatewayProxyResult> => {
  const now = getUnixTimestamp();
  for (const evt of event.Records) {
    await notifyWallet(evt.body.walletID, now, evt.body.tx);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Sent notifications' }),
  };
};

const notifyWallet = async (
  walletID: string,
  now: number,
  tx: Transaction,
): Promise<any> => { // eslint-disable-line
  const connections = await wsGetWalletConnections(walletID)
  const proms = [];
  connections.forEach((connInfo) => {
    proms.push(sendMessageToClient(connInfo.url, connInfo.id, tx));
  });
  return Promise.all(proms);
};
