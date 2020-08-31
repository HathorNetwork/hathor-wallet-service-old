/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export enum ApiError {
  MISSING_PARAMETER = 'missing-parameter',
  INVALID_BODY = 'invalid-body',
  INVALID_PARAMETER = 'invalid-parameter',
  UNKNOWN_ERROR = 'unknown-error',
  INPUTS_NOT_FOUND = 'inputs-not-found',
  INSUFFICIENT_FUNDS = 'insufficient-funds',
  INSUFFICIENT_INPUTS = 'insufficient-inputs',
  INVALID_PAYLOAD = 'invalid-payload',
  TOO_MANY_INPUTS = 'too-many-inputs',
  TOO_MANY_OUTPUTS = 'too-many-outputs',
  TX_PROPOSAL_NOT_FOUND = 'tx-proposal-not-found',
  TX_PROPOSAL_NOT_OPEN = 'tx-proposal-not-open',
  WALLET_NOT_FOUND = 'wallet-not-found',
  WALLET_NOT_READY = 'wallet-not-ready',
  WALLET_ALREADY_CREATED = 'wallet-already-created',
}
