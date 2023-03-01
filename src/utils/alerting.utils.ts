/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import AWS from 'aws-sdk';
import { Severity } from '@src/types';
import { assertEnvVariablesExistence } from '@src/utils';
import createDefaultLogger from '@src/logger';

assertEnvVariablesExistence([
  'NETWORK',
  'APPLICATION_NAME',
  'ACCOUNT_ID',
  'ALERT_MANAGER_REGION',
  'ALERT_MANAGER_TOPIC',
]);

/**
 * Adds a message to the SQS alerting queue
 *
 * @param fnName - The lambda function name
 * @param payload - The payload to be sent
 */
export const addAlert = async (
  title: string,
  message: string,
  severity: Severity,
  metadata?: unknown,
): Promise<void> => {
  const logger = createDefaultLogger();
  const preparedMessage = {
    title,
    message,
    severity,
    metadata,
    environment: process.env.NETWORK,
    application: process.env.APPLICATION_NAME,
  };

  const sqs = new AWS.SQS({ apiVersion: '2015-03-31' });
  const {
    ACCOUNT_ID,
    ALERT_MANAGER_REGION,
    ALERT_MANAGER_TOPIC,
  } = process.env;

  const QUEUE_URL = `https://sqs.${ALERT_MANAGER_REGION}.amazonaws.com/${ACCOUNT_ID}/${ALERT_MANAGER_TOPIC}`;
  const params = {
    MessageBody: JSON.stringify(preparedMessage),
    QueueUrl: QUEUE_URL,
    MessageAttributes: {
      None: {
        DataType: 'String',
        StringValue: '--',
      },
    },
  };

  await new Promise<void>((resolve) => {
    sqs.sendMessage(params, (err) => {
      if (err) {
        logger.error('[ALERT] Erroed while sending message to the alert sqs queue', err);
      }

      resolve();
    });
  });
};
