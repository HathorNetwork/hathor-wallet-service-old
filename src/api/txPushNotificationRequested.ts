/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Handler } from 'aws-lambda';
import { closeDbConnection, getDbConnection } from '@src/utils';
import Joi, { ValidationError } from 'joi';
import { BalanceValue, SendNotificationToDevice, WalletBalanceValue } from '@src/types';
import { getPushDeviceSettingsList } from '@src/db';
import createDefaultLogger from '@src/logger';
import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { Logger } from 'winston';

const mysql = getDbConnection();

class TxPushNotificationRequestValidator {
  static readonly authoritiesSchema = Joi.object({
    melt: Joi.boolean().required(),
    mint: Joi.boolean().required(),
  }).required();

  static readonly walletBalanceSchema = Joi.array().items(
    Joi.object({
      tokenId: Joi.string().required(),
      totalAmountSent: Joi.number().required(),
      lockedAmount: Joi.number().required(),
      unlockedAmount: Joi.number().required(),
      lockedAuthorities: this.authoritiesSchema,
      unlockedAuthorities: this.authoritiesSchema,
      lockExpires: Joi.number().integer().min(0).valid(null),
      total: Joi.number().required(),
    }),
  ).required();

  static readonly bodySchema = Joi.object({
    txId: Joi.string().max(256).required(),
    walletId: Joi.string().max(256).required(),
    addresses: Joi.string().max(256).required(),
    walletBalanceForTx: this.walletBalanceSchema,
  });

  static validate(payload: unknown): { value: WalletBalanceValue[], error: ValidationError } {
    return TxPushNotificationRequestValidator.bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    }) as { value: WalletBalanceValue[], error: ValidationError };
  }
}

/*
 * Handles a push notification request from post processing transaction.
 *
 * This lambda is called internally by an invoker.
 */
export const handleRequest: Handler<{ body: WalletBalanceValue }, { success: boolean, message?: string }> = async (event, context) => {
  const logger = createDefaultLogger();
  // Logs the request id on every line, so we can see all logs from a request
  logger.defaultMeta = {
    requestId: context.awsRequestId,
  };

  const { value: body, error } = TxPushNotificationRequestValidator.validate(event.body);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    closeDbConnection(mysql);
    logger.error('Invalid payload.', { details });
    return { success: false, message: `Failed due to invalid payload. See details: ${details}.` };
  }

  const walletIdList = body.map((eachWallet) => eachWallet.walletId);
  const deviceSettings = await getPushDeviceSettingsList(mysql, walletIdList);

  if (deviceSettings?.length === 0) {
    closeDbConnection(mysql);
    return { success: false, message: 'Failed due to device settings not found.' };
  }

  const devicesEnabledToPush = deviceSettings
    .filter((eachSettings) => eachSettings.enablePush);

  const genericMessages = devicesEnabledToPush
    .filter((eachSettings) => !eachSettings.enableShowAmounts)
    .map((eachSettings) => {
      const wallet = body.find((eachWallet) => eachWallet.walletId === eachSettings.walletId);
      return _assembleGenericMessage(eachSettings.deviceId, wallet.txId);
    });

  genericMessages.forEach(async (eachNotification) => {
    await _sendNotification(eachNotification, logger);
  });

  const specificMessages = devicesEnabledToPush
    .filter((eachSettings) => eachSettings.enableShowAmounts)
    .map((eachSettings) => {
      const wallet = body.find((eachWallet) => eachWallet.walletId === eachSettings.walletId);
      return _assembleSpecificMessage(eachSettings.deviceId, wallet.txId, wallet.walletBalanceForTx);
    });

  specificMessages.forEach(async (eachNotification) => {
    await _sendNotification(eachNotification, logger);
  });

  return {
    success: true,
  };
};

const _assembleGenericMessage = (deviceId, txId): SendNotificationToDevice => ({
  deviceId,
  title: 'New transaction received!',
  description: 'There is a new transaction in your wallet.',
  metadata: {
    txId,
  },
} as SendNotificationToDevice);

const _assembleSpecificMessage = (deviceId: string, txId: string, tokenBalanceList: BalanceValue[]): SendNotificationToDevice => {
  let description = 'You have received';

  tokenBalanceList.forEach((eachTokenBalance) => {
    const amount = eachTokenBalance.totalAmountSent;
    // TODO: change tokenId to tokenSymbol
    const tokenSymbol = eachTokenBalance.tokenId;
    description += ` ${amount} ${tokenSymbol}`;
  });

  description += '.';

  const notification = {
    deviceId,
    title: 'New transaction received!',
    description,
    metadata: {
      txId,
    },
  } as SendNotificationToDevice;
  return notification;
};

const _sendNotification = async (notification: SendNotificationToDevice, logger: Logger): Promise<void> => {
  try {
    await PushNotificationUtils.invokeSendNotificationHandlerLambda(notification);
  } catch (error) {
    logger.error('[ALERT] unexpected failure while calling invokeSendNotificationHandlerLambda.', { ...notification });
  }
};
