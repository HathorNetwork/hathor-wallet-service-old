/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Lambda } from 'aws-sdk';
import { Transaction } from '@src/types';
import hathorLib from '@hathor/wallet-lib';
import createDefaultLogger from '@src/logger';

export const MAX_METADATA_UPDATE_RETRIES: number = parseInt(process.env.MAX_METADATA_UPDATE_RETRIES || '3', 10);

/**
 * A helper for reading, generating and updating a NFT Token's metadata.
 */

export class NftUtils {
  static getExplorerServiceStage(walletStage: string): string {
    if (walletStage === 'dev-testnet') {
      return 'dev';
    }

    return walletStage;
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
    let isNftCreationTx;
    const libTx: hathorLib.CreateTokenTransaction = hathorLib.helpersUtils.createTxFromHistoryObject(tx);
    try {
      libTx.validateNft(new hathorLib.Network(process.env.NETWORK)); // This method will throw if the transaction is not a NFT Creation
      isNftCreationTx = true;
    } catch (ex) {
      isNftCreationTx = false;
    }

    return isNftCreationTx;
  }

  /**
 * Generates a JSON containing the basic metadata for a NFT, based on the token uid passed as parameter
 */
  static _generateNFTTokenMetadataJSON(nftUid: string): { id: string; nft: boolean } {
    return {
      id: nftUid,
      nft: true,
    };
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
      endpoint: process.env.STAGE === 'dev'
        ? 'http://localhost:3001'
        : 'https://lambda.eu-central-1.amazonaws.com',
    });

    const params = {
    // FunctionName is composed of: service name - stage - function name
      FunctionName: `hathor-explorer-service-${NftUtils.getExplorerServiceStage(process.env.STAGE)}-create_or_update_dag_metadata`,
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
        statusCode: response.StatusCode,
        message: response.Payload.toString(),
      });
      ++retryCount;
    }

    // Exceeded retry limit
    throw new Error('Metadata update failed.');
  }

  /**
   * Identifies if the metadata for a NFT needs updating and, if it does, update it.
   * @param {string} nftUid
   * @returns {Promise<void>} No data is returned after a successful update or skip
   */
  static async createOrUpdateNftMetadata(nftUid: string): Promise<void> {
    // The explorer service automatically merges the metadata content if it already exists.
    const newMetadata = NftUtils._generateNFTTokenMetadataJSON(nftUid);
    await NftUtils._updateMetadata(nftUid, newMetadata);
  }

  static async invokeNftHandlerLambda(txId: string): Promise<void> {
  // invoke lambda asynchronously to handle NFT metadata addition
    const lambda = new Lambda({
      apiVersion: '2015-03-31',
      endpoint: process.env.STAGE === 'dev'
        ? 'http://localhost:3002'
        : `https://lambda.${process.env.AWS_REGION}.amazonaws.com`,
    });

    const params = {
    // FunctionName is composed of: service name - stage - function name
      FunctionName: `${process.env.SERVICE_NAME}-${process.env.STAGE}-onNewNftEvent`,
      InvocationType: 'Event',
      Payload: JSON.stringify({ nftUid: txId }),
    };

    const response = await lambda.invoke(params).promise();

    // Event InvocationType returns 202 for a successful invokation
    if (response.StatusCode !== 202) {
      throw new Error(`onNewNftEvent lambda invoke failed for tx: ${txId}`);
    }
  }
}
