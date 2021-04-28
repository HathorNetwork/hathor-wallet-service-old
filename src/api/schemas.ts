/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Joi from 'joi';
import {
  TxVersion,
  TokenActionType,
} from '@src/types';

export const baseActionSchema = Joi.object({
  id: Joi.string().required(),
  actionType: Joi.string().valid(
    TokenActionType.REGULAR_TRANSACTION,
    TokenActionType.CREATE_TOKEN,
    TokenActionType.MINT_TOKEN,
    TokenActionType.MELT_TOKEN,
    TokenActionType.DELEGATE_MINT,
    TokenActionType.DELEGATE_MELT,
    TokenActionType.DESTROY_MINT,
    TokenActionType.DESTROY_MELT,
  ).default(TokenActionType.REGULAR_TRANSACTION),
}).unknown(true);

export const createTxSchema = Joi.object({
  outputs: Joi.array()
    .items(
      Joi.object({
        address: Joi.string()
          .alphanum()
          .required(),
        value: Joi.number()
          .integer()
          .positive()
          .required(),
        token: Joi.string()
          .alphanum(),
        timelock: Joi.number()
          .integer()
          .positive()
          .optional()
          .allow(null),
      }),
    )
    .min(1)
    .required(),
  inputs: Joi.array()
    .items(
      Joi.object({
        txId: Joi.string()
          .alphanum()
          .required(),
        index: Joi.number()
          .integer()
          .required()
          .min(0),
      }),
    ),
  inputSelectionAlgo: Joi.string(),
}).unknown(true);

export const createTokenSchema = Joi.object({
  name: Joi.string().required().max(30),
  symbol: Joi.string().required().max(5).min(2),
  amount: Joi.number().required(),
  destinationAddress: Joi.string().alphanum().max(34),
  changeAddress: Joi.string().alphanum().max(34),
  createMint: Joi.boolean().default(true),
  createMelt: Joi.boolean().default(true),
  meltDestination: Joi.string().alphanum().max(34),
  mintDestination: Joi.string().alphanum().max(34),
  version: Joi.number()
    .valid(TxVersion.TOKEN_CREATION_TRANSACTION)
    .default(TxVersion.TOKEN_CREATION_TRANSACTION),
  inputs: Joi.array()
    .items(
      Joi.object({
        txId: Joi.string()
          .alphanum()
          .required(),
        index: Joi.number()
          .integer()
          .required()
          .min(0),
      }),
    ),
}).unknown(true);

export const mintTokenSchema = Joi.object({
  amount: Joi.number().required(),
  token: Joi.string().alphanum().required(),
  createAnotherAuthority: Joi.boolean().default(true),
  destinationAddress: Joi.string().alphanum().max(34),
  changeAddress: Joi.string().alphanum().max(34),
  authorityAddress: Joi.string().alphanum().max(34),
  version: Joi.number()
    .valid(TxVersion.REGULAR_TRANSACTION)
    .default(TxVersion.REGULAR_TRANSACTION),
  inputs: Joi.array()
    .items(
      Joi.object({
        txId: Joi.string()
          .alphanum()
          .required(),
        index: Joi.number()
          .integer()
          .required()
          .min(0),
      }),
    ),
}).unknown(true);

export const meltTokenSchema = Joi.object({
  amount: Joi.number().required(),
  token: Joi.string().alphanum().required(),
  createAnotherAuthority: Joi.boolean().default(true),
  destinationAddress: Joi.string().alphanum().max(34),
  authorityAddress: Joi.string().alphanum().max(34),
  version: Joi.number()
    .valid(TxVersion.REGULAR_TRANSACTION)
    .default(TxVersion.REGULAR_TRANSACTION),
  inputs: Joi.array()
    .items(
      Joi.object({
        txId: Joi.string()
          .alphanum()
          .required(),
        index: Joi.number()
          .integer()
          .required()
          .min(0),
      }),
    ),
}).unknown(true);

export const delegateAuthoritySchema = Joi.object({
  createAnotherAuthority: Joi.boolean().default(true),
  destinationAddress: Joi.string().alphanum().max(34).required(),
  token: Joi.string().alphanum().required(),
  amount: Joi.number().required(),
  version: Joi.number()
    .valid(TxVersion.REGULAR_TRANSACTION)
    .default(TxVersion.REGULAR_TRANSACTION),
  inputs: Joi.array()
    .items(
      Joi.object({
        txId: Joi.string()
          .alphanum()
          .required(),
        index: Joi.number()
          .integer()
          .required()
          .min(0),
      }),
    ),
}).unknown(true);

export const destroyAuthoritySchema = Joi.object({
  token: Joi.string().alphanum().required(),
  amount: Joi.number().required(),
  version: Joi.number()
    .valid(TxVersion.REGULAR_TRANSACTION)
    .default(TxVersion.REGULAR_TRANSACTION),
  inputs: Joi.array()
    .items(
      Joi.object({
        txId: Joi.string()
          .alphanum()
          .required(),
        index: Joi.number()
          .integer()
          .required()
          .min(0),
      }),
    ),
}).unknown(true);
