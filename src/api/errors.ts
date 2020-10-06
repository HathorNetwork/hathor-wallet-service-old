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
  WALLET_NOT_FOUND = 'wallet-not-found',
  WALLET_NOT_READY = 'wallet-not-ready',
  WALLET_ALREADY_CREATED = 'wallet-already-created',
}
