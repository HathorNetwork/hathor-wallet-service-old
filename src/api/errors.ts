/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export enum ApiError {
  MISSING_PARAMETER = 'missing-parameter',
  INVALID_BODY = 'invalid-body',
  INVALID_TX_WEIGHT = 'invalid-tx-weight',
  INVALID_SELECTION_ALGORITHM = 'invalid-selection-algorithm',
  UNKNOWN_ERROR = 'unknown-error',
  INPUTS_NOT_FOUND = 'inputs-not-found',
  INPUTS_ALREADY_USED = 'inputs-already-used',
  INPUTS_NOT_IN_WALLET = 'inputs-not-in-wallet',
  INSUFFICIENT_FUNDS = 'insufficient-funds',
  INSUFFICIENT_INPUTS = 'insufficient-inputs',
  INVALID_PARAMETER = 'invalid-parameter',
  AUTH_INVALID_SIGNATURE = 'invalid-auth-signature',
  INVALID_PAYLOAD = 'invalid-payload',
  TOO_MANY_INPUTS = 'too-many-inputs',
  TOO_MANY_OUTPUTS = 'too-many-outputs',
  TX_PROPOSAL_NOT_FOUND = 'tx-proposal-not-found',
  TX_PROPOSAL_NOT_OPEN = 'tx-proposal-not-open',
  TX_PROPOSAL_SEND_ERROR = 'tx-proposal-send-error',
  TX_PROPOSAL_NO_MATCH = 'tx-proposal-no-match',
  WALLET_NOT_FOUND = 'wallet-not-found',
  WALLET_NOT_READY = 'wallet-not-ready',
  WALLET_ALREADY_LOADED = 'wallet-already-loaded',
  WALLET_MAX_RETRIES = 'wallet-max-retries',
  ADDRESS_NOT_IN_WALLET = 'address-not-in-wallet',
  ADDRESS_NOT_FOUND = 'address-not-found',
  TX_OUTPUT_NOT_IN_WALLET = 'tx-output-not-in-wallet',
  TOKEN_NOT_FOUND = 'token-not-found',
  FORBIDDEN = 'forbidden',
  UNAUTHORIZED = 'unauthorized',
  DEVICE_NOT_FOUND = 'device-not-found',
  TX_NOT_FOUND = 'tx-not-found',
}
