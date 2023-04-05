/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Lambda } from 'aws-sdk';
import { addAlert } from '@src/utils/alerting.utils';
import { Transaction, Severity } from '@src/types';
import hathorLib from '@hathor/wallet-lib';
import createDefaultLogger from '@src/logger';

export const MAX_METADATA_UPDATE_RETRIES: number = parseInt(process.env.MAX_METADATA_UPDATE_RETRIES || '3', 10);

/**
 * A helper for generating and updating a NFT Token's metadata.
 */

/** This env-var based feature toggle can be used to disable this feature */
export const isNftAutoReviewEnabled = (): boolean => process.env.NFT_AUTO_REVIEW_ENABLED === 'true';

export class NftUtils {
  /**
   * Returns whether we should invoke our NFT handler for this tx
   * @param {Transaction} tx
   * @returns {boolean}
   */
  static shouldInvokeNftHandlerForTx(tx: Transaction): boolean {
    return isNftAutoReviewEnabled() && this.isTransactionNFTCreation(tx);
  }

  /**
   * Returns if the transaction in the parameter is a NFT Creation.
   * @param {Transaction} tx
   * @returns {boolean}
   */
  static isTransactionNFTCreation(tx: Transaction): boolean {
  /*
   * To fully check if a transaction is a NFT creation, we need to instantiate a new Transaction object in the lib.
   * So first we do some very fast checks to filter the bulk of the requests for NFTs with minimum processing.
   */
    if (
      tx.version !== hathorLib.constants.CREATE_TOKEN_TX_VERSION // Must be a token creation tx
    || !tx.token_name // Must have a token name
    || !tx.token_symbol // Must have a token symbol
    ) {
      return false;
    }

    // Continue with a deeper validation
    const logger = createDefaultLogger();
    let isNftCreationTx;
    let libTx: hathorLib.CreateTokenTransaction;

    // Transaction parsing failures should be alerted
    try {
      libTx = hathorLib.helpersUtils.createTxFromHistoryObject(tx);
    } catch (ex) {
      logger.error('[ALERT] Error when parsing transaction on isTransactionNFTCreation', {
        transaction: tx,
        error: ex,
      });

      // isTransactionNFTCreation should never throw. We will just raise an alert and exit gracefully.
      return false;
    }

    // Validate the token: the validateNft will throw if the transaction is not a NFT Creation
    try {
      libTx.validateNft(new hathorLib.Network(process.env.NETWORK));
      isNftCreationTx = true;
    } catch (ex) {
      isNftCreationTx = false;
    }

    return isNftCreationTx;
  }

  /**
   * Calls the token metadata on the Explorer Service API to update a token's metadata
   * @param {string} nftUid
   * @param {Record<string, unknown>} metadata
   */
  static async _updateMetadata(nftUid: string, metadata: Record<string, unknown>): Promise<unknown> {
  // invoke lambda asynchronously to metadata update
    const lambda = new Lambda({
      apiVersion: '2015-03-31',
      endpoint: process.env.EXPLORER_SERVICE_LAMBDA_ENDPOINT,
    });

    const params = {
      FunctionName: `hathor-explorer-service-${process.env.EXPLORER_SERVICE_STAGE}-create_or_update_dag_metadata`,
      InvocationType: 'Event',
      Payload: JSON.stringify({
        id: nftUid,
        metadata,
      }),
    };

    const logger = createDefaultLogger();
    let retryCount = 0;
    while (retryCount < MAX_METADATA_UPDATE_RETRIES) {
      const response = await lambda.invoke(params).promise();

      // Event InvocationType returns 202 for a successful invokation
      if (response.StatusCode === 202) {
      // End the loop successfully
        return response;
      }

      logger.warn('Failed metadata update', {
        nftUid,
        retryCount,
        statusCode: response.StatusCode,
        message: response.Payload.toString(),
      });
      ++retryCount;
    }

    // Exceeded retry limit
    throw new Error(`Metadata update failed for tx_id: ${nftUid}.`);
  }

  /**
   * Identifies if the metadata for a NFT needs updating and, if it does, update it.
   * @param {string} nftUid
   * @returns {Promise<void>} No data is returned after a successful update or skip
   */
  static async createOrUpdateNftMetadata(nftUid: string): Promise<void> {
    // The explorer service automatically merges the metadata content if it already exists.
    const newMetadata = {
      id: nftUid,
      nft: true,
    };
    await NftUtils._updateMetadata(nftUid, newMetadata);
  }

  /**
   * Invokes this application's own intermediary lambda `onNewNftEvent`.
   * This is to improve the failure tolerance on this non-critical step of the sync loop.
   */
  static async invokeNftHandlerLambda(txId: string): Promise<void> {
  // invoke lambda asynchronously to handle NFT metadata addition
    const lambda = new Lambda({
      apiVersion: '2015-03-31',
      endpoint: process.env.WALLET_SERVICE_LAMBDA_ENDPOINT,
    });

    const params = {
      FunctionName: `hathor-wallet-service-${process.env.STAGE}-onNewNftEvent`,
      InvocationType: 'Event',
      Payload: JSON.stringify({ nftUid: txId }),
    };

    const response = await lambda.invoke(params).promise();

    // Event InvocationType returns 202 for a successful invokation
    if (response.StatusCode !== 202) {
      addAlert(
        'Error on NFTHandler lambda',
        'Erroed on invokeNftHandlerLambda invocation',
        Severity.MINOR,
        { TxId: txId },
      );
      throw new Error(`onNewNftEvent lambda invoke failed for tx: ${txId}`);
    }
  }
}
