/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import { Lambda } from 'aws-sdk';
import { Transaction } from '@src/types';
import hathorLib from '@hathor/wallet-lib';
import createDefaultLogger from '@src/logger';

const MAX_METADATA_UPDATE_RETRIES: number = parseInt(process.env.MAX_METADATA_UPDATE_RETRIES || '3', 10);

/**
 * A helper for reading, generating and updating a NFT Token's metadata.
 */

/**
 * Url of the API that provides and updates token metadata
 */
const tokenMetadataApi: string = process.env.TOKEN_METADATA_URL || 'https://explorer-service.hathor.network/metadata/dag';

export class NftUtils {
/**
 * Returns if the transaction in the parameter is an NFT Creation.
 * @param {Transaction} tx
 * @returns {boolean}
 */
  static isTransactionNFTCreation(tx: Transaction): boolean {
  /*
   * To fully check if a transaction is an NFT creation, we need to instantiate a new Transaction object in the lib.
   * So first we do some very fast checks to filter the bulk of the requests for NFTs with minimum processing.
   */
    if (
      tx.version !== hathorLib.constants.CREATE_TOKEN_TX_VERSION // Must be a token creation tx
    || tx.outputs.length < 2 // Must have at least 2 outputs
    || tx.outputs[0].value !== 1 // One of the conditions of the DataScript output
    ) {
      return false;
    }

    // Continue with a deeper validation
    let isNftCreationTx;
    const libTx: hathorLib.CreateTokenTransaction = hathorLib.helpersUtils.createTxFromHistoryObject(tx);
    try {
      libTx.validateNftCreation(); // This method will throw if the transaction is not an NFT Creation
      isNftCreationTx = true;
    } catch (ex) {
      isNftCreationTx = false;
    }

    return isNftCreationTx;
  }

  /**
 * Generates a JSON containing the basic metadata for an NFT, based on the token uid passed as parameter
 * @param {string} nftUid
 * @returns {Record<string,{id:string,nft:boolean}>}
 */
  static generateNFTTokenMetadataJSON(nftUid: string): Record<string, { id: string, nft: boolean }> {
    const nftMetadata = {};
    nftMetadata[nftUid] = {
      id: nftUid,
      nft: true,
    };
    return nftMetadata;
  }

  /**
 * Gets the token metadata from the Explorer Service API.
 * @param {string} tokenUid
 * @returns {Promise<Record<string, unknown>>} Token metadata
 */
  static async _getTokenMetadata(tokenUid: string): Promise<Record<string, unknown>> {
    const metadataResponse = await axios.get(
      tokenMetadataApi,
      { params: { id: tokenUid } },
    );

    if (metadataResponse.status === 404) {
      return {};
    }

    return metadataResponse.data;
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
      FunctionName: `hathor-explorer-service-${process.env.STAGE}-put_dag_metadata_handler`,
      InvocationType: 'Event',
      Payload: JSON.stringify({
        query: { id: nftUid },
        body: metadata,
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
  // Fetching current metadata for this token
    const existingMetadata = await NftUtils._getTokenMetadata(nftUid) || {};

    // Metadata already exists and is correct: Do nothing.
    const tokenMetadata = existingMetadata[nftUid] as { nft: boolean };
    if (tokenMetadata && tokenMetadata.nft === true) {
      return;
    }

    // Metadata already exists, but does not have the NFT flag: Update existing data.
    if (tokenMetadata) {
      tokenMetadata.nft = true;
      await NftUtils._updateMetadata(nftUid, existingMetadata);
      return;
    }

    // There is no metadata for this token: create and upload it.
    const newMetadata = NftUtils.generateNFTTokenMetadataJSON(nftUid);
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
      Payload: txId,
    };

    const response = await lambda.invoke(params).promise();

    // Event InvocationType returns 202 for a successful invokation
    if (response.StatusCode !== 202) {
      throw new Error('NFT Handler lambda invoke failed');
    }
  }
}
