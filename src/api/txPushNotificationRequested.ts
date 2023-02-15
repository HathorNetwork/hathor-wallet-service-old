/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Handler } from 'aws-lambda';
import { closeDbConnection, getDbConnection } from '@src/utils';
import Joi, { ValidationError } from 'joi';
import {
  Severity,
  TokenBalanceValue,
  LocalizeMetadataNotification,
  SendNotificationToDevice,
  StringMap,
  WalletBalanceValue,
} from '@src/types';
import { getPushDeviceSettingsList } from '@src/db';
import createDefaultLogger from '@src/logger';
import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { Logger } from 'winston';
import { addAlert } from '@src/utils/alerting.utils';

const mysql = getDbConnection();

export const pushNotificationMessage = {
  newTransaction: {
    titleKey: 'new_transaction_received_title',
    withoutTokens: {
      descriptionKey: 'new_transaction_received_description_without_tokens',
    },
    withTokens: {
      descriptionKey: 'new_transaction_received_description_with_tokens',
    },
  },
  invalidPayload: 'Failed due to invalid payload error. See details.',
  deviceSettingsNotFound: 'Failed due to device settings not found.',
};

class TxPushNotificationRequestValidator {
  static readonly authoritiesSchema = Joi.object({
    melt: Joi.boolean().required(),
    mint: Joi.boolean().required(),
  });

  static readonly walletBalanceSchema = Joi.array().items(
    Joi.object({
      tokenId: Joi.string().required(),
      tokenSymbol: Joi.string().required(),
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
export const handleRequest: Handler<StringMap<WalletBalanceValue>, { success: boolean, message?: string, details?: unknown }> = async (event, context) => {
  const logger = createDefaultLogger();
  // Logs the request id on every line, so we can see all logs from a request
  logger.defaultMeta = {
    module: __filename,
    scope: handleRequest.name,
    requestId: context.awsRequestId,
  };

  const { value: body, error } = TxPushNotificationRequestValidator.validate(event);

  if (error) {
    const details = error.details.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    closeDbConnection(mysql);
    await addAlert(
      'Invalid payload while handling push notification request.',
      '-',
      Severity.MINOR,
      { details },
    );
    logger.error('Invalid payload while handling push notification request.', { details });
    return { success: false, message: pushNotificationMessage.invalidPayload, details };
  }

  const walletIdList = Object.keys(body);
  const deviceSettings = await getPushDeviceSettingsList(mysql, walletIdList);

  const noDeviceSettingsFound = deviceSettings?.length === 0;
  if (noDeviceSettingsFound) {
    closeDbConnection(mysql);
    return { success: false, message: pushNotificationMessage.deviceSettingsNotFound };
  }

  const devicesEnabledToPush = deviceSettings
    .filter((eachSettings) => eachSettings.enablePush)
    // filter wallets in which the token balance > 0
    .filter((eachSettings) => {
      const wallet = body[eachSettings.walletId];
      // verify by the first token balance
      return wallet.walletBalanceForTx[0].total > 0;
    });

  const genericMessages = devicesEnabledToPush
    .filter((eachSettings) => !eachSettings.enableShowAmounts)
    .map((eachSettings) => {
      const wallet = body[eachSettings.walletId];
      return _assembleGenericMessage(eachSettings.deviceId, wallet.txId);
    });

  for (const eachNotification of genericMessages) {
    await _sendNotification(eachNotification, logger);
  }

  const specificMessages = devicesEnabledToPush
    .filter((eachSettings) => eachSettings.enableShowAmounts)
    .map((eachSettings) => {
      const wallet = body[eachSettings.walletId];
      return _assembleSpecificMessage(eachSettings.deviceId, wallet.txId, wallet.walletBalanceForTx);
    });

  for (const eachNotification of specificMessages) {
    await _sendNotification(eachNotification, logger);
  }

  return {
    success: true,
  };
};

const _assembleGenericMessage = (deviceId, txId): SendNotificationToDevice => {
  const localize = {
    titleLocKey: pushNotificationMessage.newTransaction.titleKey,
    bodyLocKey: pushNotificationMessage.newTransaction.withoutTokens.descriptionKey,
  } as LocalizeMetadataNotification;

  return {
    deviceId,
    metadata: {
      txId,
      ...localize,
    },
  } as SendNotificationToDevice;
};

const _assembleSpecificMessage = (deviceId: string, txId: string, tokenBalanceList: TokenBalanceValue[]): SendNotificationToDevice => {
  const upperLimit = 2;
  const isTokensOverLimit = tokenBalanceList.length > upperLimit;

  const tokens = [];
  for (const eachBalance of tokenBalanceList.slice(0, upperLimit)) {
    const amount = eachBalance.total;
    const tokenSymbol = eachBalance.tokenSymbol;
    tokens.push(`${amount} ${tokenSymbol}`);
  }

  if (isTokensOverLimit) {
    const remainingTokens = tokenBalanceList.length - upperLimit;
    tokens.push(remainingTokens.toString());
  }

  const localize = {
    titleLocKey: pushNotificationMessage.newTransaction.titleKey,
    bodyLocKey: pushNotificationMessage.newTransaction.withTokens.descriptionKey,
    bodyLocArgs: JSON.stringify(tokens),
  } as LocalizeMetadataNotification;

  return {
    deviceId,
    metadata: {
      txId,
      ...localize,
    },
  } as SendNotificationToDevice;
};

const _sendNotification = async (notification: SendNotificationToDevice, logger: Logger): Promise<void> => {
  try {
    await PushNotificationUtils.invokeSendNotificationHandlerLambda(notification);
  } catch (error) {
    await addAlert(
      'Unexpected failure while calling invokeSendNotificationHandlerLambda',
      '-',
      Severity.MINOR,
      { ...notification },
    );
    logger.error('Unexpected failure while calling invokeSendNotificationHandlerLambda.', { ...notification, error });
  }
};
