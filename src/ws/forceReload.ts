/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// import AWS from 'aws-sdk';

import { sendMessageToClient } from '@src/ws/utils';
import { wsGetAllConnections } from '@src/redis';

export const handler = async (): Promise<{statusCode: number}> => {
  const proms = [];
  const connections = await wsGetAllConnections();
  const payload = { message: 'force-full-reload' };

  connections.forEach((connInfo) => {
    proms.push(sendMessageToClient(connInfo, payload));
  });
  await Promise.all(proms);
  return { statusCode: 200 };
};
