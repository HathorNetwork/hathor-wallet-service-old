import Joi from 'joi';

export const txProposalCreateSchema = Joi.object({
  id: Joi.string().required(),
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
});

export const createTokenSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required().max(30),
  symbol: Joi.string().required().max(5).min(2),
  amount: Joi.number().required(),
  destinationAddress: Joi.string().alphanum().max(34),
  changeAddress: Joi.string().alphanum().max(34),
  createMint: Joi.boolean().default(true),
  createMelt: Joi.boolean().default(true),
  meltDestination: Joi.string().alphanum().max(34),
  mintDestination: Joi.string().alphanum().max(34),
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
});

export const mintTokenSchema = Joi.object({
  id: Joi.string().required(),
  amount: Joi.number().required(),
  token: Joi.string().alphanum().required(),
  createAnotherAuthority: Joi.boolean().default(true),
  destinationAddress: Joi.string().alphanum().max(34),
  changeAddress: Joi.string().alphanum().max(34),
  authorityAddress: Joi.string().alphanum().max(34),
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
});

export const meltTokenSchema = Joi.object({
  id: Joi.string().required(),
  amount: Joi.number().required(),
  createAnotherAuthority: Joi.boolean().default(true),
  destinationAddress: Joi.string().alphanum().max(34),
  authorityAddress: Joi.string().alphanum().max(34),
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
});

export const delegateAuthoritySchema = Joi.object({
  id: Joi.string().required(),
  createAnotherAuthority: Joi.boolean().default(true),
  destinationAddress: Joi.string().alphanum().max(34).required(),
  quantity: Joi.number().required(),
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
});

export const destroyAuthoritySchema = Joi.object({
  id: Joi.string().required(),
  token: Joi.string().alphanum().required(),
  quantity: Joi.number().required(),
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
});
