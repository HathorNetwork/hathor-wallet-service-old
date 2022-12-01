/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Handler } from 'aws-lambda';
import { closeDbConnection, getDbConnection } from '@src/utils';
import Joi, { ValidationError } from 'joi';
import { BalanceValue, SendNotificationToDevice, StringMap, WalletBalanceValue } from '@src/types';
import { getPushDeviceSettingsList } from '@src/db';
import createDefaultLogger from '@src/logger';
import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { Logger } from 'winston';

const mysql = getDbConnection();

export const pushNotificationMessage = {
  newTransaction: {
    title: 'New transaction received!',
    genericDescription: 'There is a new transaction in your wallet.',
  },
  invalidPayload: 'Failed due to invalid payload error. See details.',
  deviceSettinsNotFound: 'Failed due to device settings not found.',
};

class TxPushNotificationRequestValidator {
  static readonly authoritiesSchema = Joi.object({
    melt: Joi.boolean().required(),
    mint: Joi.boolean().required(),
  });

  static readonly walletBalanceSchema = Joi.array().items(
    Joi.object({
      tokenId: Joi.string().required(),
      totalAmountSent: Joi.number().required(),
      lockedAmount: Joi.number().required(),
      unlockedAmount: Joi.number().required(),
      lockedAuthorities: TxPushNotificationRequestValidator.authoritiesSchema,
      unlockedAuthorities: TxPushNotificationRequestValidator.authoritiesSchema,
      lockExpires: Joi.number().integer().min(0).valid(null),
      total: Joi.number().required(),
    }),
  ).required();

  static readonly bodySchema = Joi.object().pattern(Joi.string().required(), Joi.object({
    txId: Joi.string().max(256).required(),
    walletId: Joi.string().required(),
    addresses: Joi.array().items(Joi.string().required()).required(),
    walletBalanceForTx: TxPushNotificationRequestValidator.walletBalanceSchema,
  }).required()).required().min(1);

  static validate(payload: unknown): { value: StringMap<WalletBalanceValue>, error: ValidationError } {
    return TxPushNotificationRequestValidator.bodySchema.validate(payload, {
      abortEarly: false, // We want it to return all the errors not only the first
      convert: true, // We need to convert as parameters are sent on the QueryString
    }) as { value: StringMap<WalletBalanceValue>, error: ValidationError };
  }
}

/*
 * Handles a push notification request from post processing transaction.
 *
 * This lambda is called internally by an invoker.
 */
// eslint-disable-next-line max-len
export const handleRequest: Handler<{ body: StringMap<WalletBalanceValue> }, { success: boolean, message?: string, details?: unknown }> = async (event, context) => {
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
    logger.error('[ALERT] Invalid payload.', { details });
    return { success: false, message: pushNotificationMessage.invalidPayload, details };
  }

  const walletIdList = Object.keys(body);
  const deviceSettings = await getPushDeviceSettingsList(mysql, walletIdList);

  if (deviceSettings?.length === 0) {
    closeDbConnection(mysql);
    return { success: false, message: pushNotificationMessage.deviceSettinsNotFound };
  }

  const devicesEnabledToPush = deviceSettings
    .filter((eachSettings) => eachSettings.enablePush);

  const genericMessages = devicesEnabledToPush
    .filter((eachSettings) => !eachSettings.enableShowAmounts)
    .map((eachSettings) => {
      const wallet = body[eachSettings.walletId];
      return _assembleGenericMessage(eachSettings.deviceId, wallet.txId);
    });

  genericMessages.forEach(async (eachNotification) => {
    await _sendNotification(eachNotification, logger);
  });

  const specificMessages = devicesEnabledToPush
    .filter((eachSettings) => eachSettings.enableShowAmounts)
    .map((eachSettings) => {
      const wallet = body[eachSettings.walletId];
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
  title: pushNotificationMessage.newTransaction.title,
  description: pushNotificationMessage.newTransaction.genericDescription,
  metadata: {
    txId,
  },
} as SendNotificationToDevice);

const _assembleSpecificMessage = (deviceId: string, txId: string, tokenBalanceList: BalanceValue[]): SendNotificationToDevice => {
  const tokensCap = 2;
  const isTokensUnderCap = tokenBalanceList.length <= 2;

  const messageChunks = [];
  for (const eachBalance of tokenBalanceList.slice(0, tokensCap)) {
    const amount = eachBalance.totalAmountSent;
    // TODO: change tokenId to tokenSymbol
    const tokenSymbol = eachBalance.tokenId;
    messageChunks.push(`${amount} ${tokenSymbol}`);
  }

  if (!isTokensUnderCap) {
    const remainingTokens = tokenBalanceList.length - tokensCap;
    messageChunks.push(_remainingTokenChunkMessage(remainingTokens));
  }

  const description = `You have received ${isTokensUnderCap ? messageChunks.join(' and ') : messageChunks.join(', ')}.`;
  const notification = {
    deviceId,
    title: pushNotificationMessage.newTransaction.title,
    description,
    metadata: {
      txId,
    },
  } as SendNotificationToDevice;
  return notification;
};

const _remainingTokenChunkMessage = (remainingTokens: number): string => {
  const token = 'token';
  const tokens = 'tokens';
  const isSingular = remainingTokens === 1;
  return `and ${remainingTokens} other ${isSingular ? token : tokens} on a new transaction`;
};

const _sendNotification = async (notification: SendNotificationToDevice, logger: Logger): Promise<void> => {
  try {
    await PushNotificationUtils.invokeSendNotificationHandlerLambda(notification);
  } catch (error) {
    logger.error('[ALERT] unexpected failure while calling invokeSendNotificationHandlerLambda.', { ...notification });
  }
};
