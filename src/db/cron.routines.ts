/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import 'source-map-support/register';
import {
  countStalePushDevices,
  deleteStalePushDevices,
} from '@src/db';
import {
  closeDbConnection,
  getDbConnection,
} from '@src/utils';
import createDefaultLogger from '@src/logger';

const mysql = getDbConnection();

/**
 * Function called to clean stale push devices.
 *
 * @remarks
 * This is a lambda function that should be triggered by an scheduled event. This will run by default with
 * frequency of 15 days (configurable on serverless.yml) and will query for devices not updated more than 1 month.
 */
export const cleanStalePushDevices = async (): Promise<void> => {
  const logger = createDefaultLogger();

  const staleDevices: number = await countStalePushDevices(mysql);
  logger.debug(`Found ${staleDevices} stale devices to be cleaned up.`, {
    staleDevices,
  });

  await deleteStalePushDevices(mysql);

  await closeDbConnection(mysql);
};
