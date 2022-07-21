import hathorLib from '@hathor/wallet-lib';
import { MAX_METADATA_UPDATE_RETRIES, NftUtils } from '@src/utils/nft.utils';
import { getHandlerContext, getTransaction } from '@events/nftCreationTx';
import axios from 'axios';
import { Lambda as LambdaMock } from 'aws-sdk';

jest.mock('aws-sdk', () => {
  const mLambda = { invoke: jest.fn() };
  return { Lambda: jest.fn(() => mLambda) };
});

describe('isTransactionNFTCreation', () => {
  it('should return false on quick validations', () => {
    expect.hasAssertions();

    // Preparing mocks
    const spyCreateTx = jest.spyOn(hathorLib.helpersUtils, 'createTxFromHistoryObject');
    spyCreateTx.mockImplementation(() => ({}));
    let tx;
    let result;

    // Incorrect version
    tx = getTransaction();
    tx.version = hathorLib.constants.DEFAULT_TX_VERSION;
    result = NftUtils.isTransactionNFTCreation(tx);
    expect(result).toBe(false);
    expect(spyCreateTx).not.toHaveBeenCalled();

    // Missing name
    tx = getTransaction();
    tx.token_name = undefined;
    result = NftUtils.isTransactionNFTCreation(tx);
    expect(result).toBe(false);
    expect(spyCreateTx).not.toHaveBeenCalled();

    // Missing symbol
    tx = getTransaction();
    tx.token_symbol = undefined;
    result = NftUtils.isTransactionNFTCreation(tx);
    expect(result).toBe(false);
    expect(spyCreateTx).not.toHaveBeenCalled();

    // Reverting mocks
    spyCreateTx.mockRestore();
  });

  it('should return true when the wallet-lib validation does not fail', () => {
    expect.hasAssertions();

    // Preparing mocks
    const spyNftValidation = jest.spyOn(hathorLib.CreateTokenTransaction.prototype, 'validateNft');
    spyNftValidation.mockImplementation(() => undefined);

    // Validation
    const tx = getTransaction();
    const result = NftUtils.isTransactionNFTCreation(tx);
    expect(result).toBe(true);

    // Reverting mocks
    spyNftValidation.mockRestore();
  });

  it('should return true when the wallet-lib validation does not fail (unmocked)', () => {
    expect.hasAssertions();

    // Validation
    const tx = getTransaction();
    const result = NftUtils.isTransactionNFTCreation(tx);
    expect(result).toBe(true);
  });

  it('should return false when the wallet-lib validation throws', () => {
    expect.hasAssertions();

    // Preparing mocks
    const spyNftValidation = jest.spyOn(hathorLib.CreateTokenTransaction.prototype, 'validateNft');
    spyNftValidation.mockImplementation(() => {
      throw new Error('not a nft');
    });

    // Validation
    const tx = getTransaction();
    const result = NftUtils.isTransactionNFTCreation(tx);
    expect(result).toBe(false);

    // Reverting mocks
    spyNftValidation.mockRestore();
  });
});

describe('generateNFTTokenMetadataJSON', () => {
  it('should return a NFT token metadata json', () => {
    expect.hasAssertions();

    const result = NftUtils._generateNFTTokenMetadataJSON('sampleUid');
    expect(result).toStrictEqual({
      sampleUid: { id: 'sampleUid', nft: true },
    });
  });
});

describe('createOrUpdateNftMetadata', () => {
  const spyFetchMetadata = jest.spyOn(NftUtils, '_getTokenMetadata');
  const spyUpdateMetadata = jest.spyOn(NftUtils, '_updateMetadata');

  afterEach(() => {
    spyFetchMetadata.mockReset();
    spyUpdateMetadata.mockReset();
  });

  afterAll(() => {
    // Clear mocks
    spyFetchMetadata.mockRestore();
    spyUpdateMetadata.mockRestore();
  });

  it('should not update metadata when it already exists', async () => {
    expect.hasAssertions();

    spyFetchMetadata.mockImplementation(async () => ({
      sampleUid: {
        id: 'sampleUid',
        nft: true,
      },
    }));
    spyUpdateMetadata.mockImplementation(async () => ({}));
    await NftUtils.createOrUpdateNftMetadata('sampleUid');

    expect(spyFetchMetadata).toHaveBeenCalledTimes(1);
    expect(spyUpdateMetadata).toHaveBeenCalledTimes(0);
  });

  it('should create metadata with minimum nft data', async () => {
    expect.hasAssertions();
    const expectedUpdateRequest = { sampleUid: { id: 'sampleUid', nft: true } };
    const expectedUpdateResponse = { updated: 'ok' };

    spyFetchMetadata.mockImplementation(async () => ({}));
    spyUpdateMetadata.mockImplementation(async () => expectedUpdateResponse);
    const result = await NftUtils.createOrUpdateNftMetadata('sampleUid');

    expect(spyFetchMetadata).toHaveBeenCalledTimes(1);
    expect(spyUpdateMetadata).toHaveBeenCalledTimes(1);

    expect(spyUpdateMetadata).toHaveBeenCalledWith('sampleUid', expectedUpdateRequest);
    expect(result).toBeUndefined(); // The method returns void
  });

  it('should preserve existing metadata when adding nft field', async () => {
    expect.hasAssertions();
    const existingMetadata = {
      id: 'sampleUid',
      otherField: 1,
    };
    const expectedUpdateRequest = { sampleUid: { ...existingMetadata, nft: true } };

    spyFetchMetadata.mockImplementation(async () => ({ sampleUid: existingMetadata }));
    spyUpdateMetadata.mockImplementation(async () => ({ updated: 'ok' }));
    const result = await NftUtils.createOrUpdateNftMetadata('sampleUid');

    expect(spyFetchMetadata).toHaveBeenCalledTimes(1);
    expect(spyUpdateMetadata).toHaveBeenCalledTimes(1);

    expect(spyUpdateMetadata).toHaveBeenCalledWith('sampleUid', expectedUpdateRequest);
  });
});

describe('_getTokenMetadata', () => {
  const spyAxiosGet = jest.spyOn(axios, 'get');

  afterEach(() => {
    spyAxiosGet.mockReset();
  });

  afterAll(() => {
    spyAxiosGet.mockRestore();
  });

  it('should retrieve metadata from http response', async () => {
    expect.hasAssertions();
    const expectedHttpResponse = {
      status: 200,
      data: { mockedResponse: 'yes' },
    };
    spyAxiosGet.mockImplementation(async () => expectedHttpResponse);

    const results = await NftUtils._getTokenMetadata('sampleUid');
    expect(results).toStrictEqual(expectedHttpResponse.data);
  });

  it('should retrieve an empty object when the token metadata is not found', async () => {
    expect.hasAssertions();
    const expectedHttpError = {
      response: {
        status: 404,
        data: { whateverData: 'ignore' },
      },
    };
    spyAxiosGet.mockImplementation(async () => {
      throw expectedHttpError;
    });

    const results = await NftUtils._getTokenMetadata('sampleUid');
    expect(results).toStrictEqual({});
  });

  it('should rethrow when an axios error happens', async () => {
    expect.hasAssertions();
    const expectedHttpError = {
      response: {
        status: 500,
        data: { description: 'error message' },
      },
      toJSON: () => ({}),
    };
    // Mocking the axios helper
    expectedHttpError.toJSON = () => expectedHttpError.response;
    spyAxiosGet.mockImplementation(async () => {
      throw expectedHttpError;
    });

    await expect(NftUtils._getTokenMetadata('sampleUid'))
      .rejects.toStrictEqual(expectedHttpError.response);
  });

  it('should rethrow when an unknown error happens', async () => {
    expect.hasAssertions();
    const expectedError = new Error('unknown failure');
    spyAxiosGet.mockImplementation(async () => {
      throw expectedError;
    });

    await expect(NftUtils._getTokenMetadata('sampleUid'))
      .rejects.toThrow(expectedError);
  });

  it('should throw when the API url is not set', async () => {
    expect.hasAssertions();
    spyAxiosGet.mockImplementation(async () => ({}));

    // Mocking the API environment url
    const oldUrl = NftUtils.tokenMetadataApi;
    NftUtils.tokenMetadataApi = '';

    await expect(NftUtils._getTokenMetadata('sampleUid'))
      .rejects.toThrow(new Error('Missing TOKEN_METADATA_URL setting'));
    expect(spyAxiosGet).not.toHaveBeenCalled();

    // Reverting mocked value
    NftUtils.tokenMetadataApi = oldUrl;
  });
});

describe('_updateMetadata', () => {
  it('should return the update lambda response on success', async () => {
    expect.hasAssertions();

    // Building the mock lambda
    const expectedLambdaResponse = {
      StatusCode: 202,
      Payload: 'sampleData',
    };
    const mLambda = new LambdaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mLambda.invoke as jest.Mocked<any>).mockImplementationOnce(() => ({
      promise: async () => expectedLambdaResponse,
    }));

    const result = await NftUtils._updateMetadata('sampleUid', { sampleData: 'fake' });
    expect(result).toStrictEqual(expectedLambdaResponse);
  });

  it('should retry calling the update lambda a set number of times', async () => {
    expect.hasAssertions();

    // Building the mock lambda
    let failureCount = 0;
    const expectedLambdaResponse = {
      StatusCode: 202,
      Payload: 'sampleData',
    };
    const mLambda = new LambdaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mLambda.invoke as jest.Mocked<any>).mockImplementation(() => ({
      promise: async () => {
        if (failureCount < MAX_METADATA_UPDATE_RETRIES - 1) {
          ++failureCount;
          return {
            StatusCode: 500,
            Payload: 'failurePayload',
          };
        }
        return expectedLambdaResponse;
      },
    }));

    const result = await NftUtils._updateMetadata('sampleUid', { sampleData: 'fake' });
    expect(result).toStrictEqual(expectedLambdaResponse);
  });

  it('should throw after reaching retry count', async () => {
    expect.hasAssertions();

    // Building the mock lambda
    let failureCount = 0;
    const mLambda = new LambdaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mLambda.invoke as jest.Mocked<any>).mockImplementation(() => ({
      promise: async () => {
        if (failureCount < MAX_METADATA_UPDATE_RETRIES) {
          ++failureCount;
          return {
            StatusCode: 500,
            Payload: 'failurePayload',
          };
        }
        return {
          StatusCode: 202,
          Payload: 'sampleData',
        };
      },
    }));

    // eslint-disable-next-line jest/valid-expect
    expect(NftUtils._updateMetadata('sampleUid', { sampleData: 'fake' }))
      .rejects.toThrow(new Error('Metadata update failed.'));
  });
});

describe('invokeNftHandlerLambda', () => {
  it('should return the lambda response on success', async () => {
    expect.hasAssertions();

    // Building the mock lambda
    const expectedLambdaResponse: LambdaMock.InvocationResponse = {
      StatusCode: 202,
      Payload: JSON.stringify({ success: true }),
    };
    const mLambda = new LambdaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mLambda.invoke as jest.Mocked<any>).mockImplementationOnce(() => ({
      promise: async () => expectedLambdaResponse,
    }));

    await expect(NftUtils.invokeNftHandlerLambda('sampleUid')).resolves.toBeUndefined();
  });

  it('should throw when payload response status is invalid', async () => {
    expect.hasAssertions();

    // Building the mock lambda
    const mLambda = new LambdaMock();
    const expectedLambdaResponse: LambdaMock.InvocationResponse = {
      StatusCode: 500,
      Payload: {
        success: false,
        message: 'had a failure',
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mLambda.invoke as jest.Mocked<any>).mockImplementation(() => ({
      promise: async () => expectedLambdaResponse,
    }));

    await expect(NftUtils.invokeNftHandlerLambda('sampleUid'))
      .rejects.toThrow(new Error('NFT Handler lambda invoke failed'));
  });

  it('should throw when payload response payload is invalid', async () => {
    expect.hasAssertions();

    // Building the mock lambda
    const mLambda = new LambdaMock();
    const expectedLambdaResponse: LambdaMock.InvocationResponse = {
      StatusCode: 202,
      Payload: '{ "malformedJson": true, ',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mLambda.invoke as jest.Mocked<any>).mockImplementation(() => ({
      promise: async () => expectedLambdaResponse,
    }));

    await expect(NftUtils.invokeNftHandlerLambda('sampleUid'))
      .rejects.toThrow(new Error('Unable to parse invoke payload response: Unexpected end of JSON input'));
  });

  it('should throw when success is not true', async () => {
    expect.hasAssertions();

    // Building the mock lambda
    const mLambda = new LambdaMock();
    const expectedLambdaResponse: LambdaMock.InvocationResponse = {
      StatusCode: 202,
      Payload: JSON.stringify({ success: false, message: 'had a failure' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mLambda.invoke as jest.Mocked<any>).mockImplementation(() => ({
      promise: async () => expectedLambdaResponse,
    }));

    await expect(NftUtils.invokeNftHandlerLambda('sampleUid'))
      .rejects.toThrow(new Error('Unsuccessful invoke: had a failure'));
  });
});

describe('minor helpers', () => {
  it('should generate an event context', () => {
    expect.hasAssertions();

    const c = getHandlerContext();
    expect(c.done()).toBeUndefined();
    expect(c.fail('fail')).toBeUndefined();
    expect(c.getRemainingTimeInMillis()).toStrictEqual(0);
    expect(c.succeed('pass')).toBeUndefined();
  });

  it('should get the explorer service stage name', () => {
    expect.hasAssertions();

    expect(NftUtils.getExplorerServiceStage('dev-testnet')).toStrictEqual('dev');
    expect(NftUtils.getExplorerServiceStage('dev')).toStrictEqual('dev');
    expect(NftUtils.getExplorerServiceStage('testnet')).toStrictEqual('testnet');
    expect(NftUtils.getExplorerServiceStage('mainnet')).toStrictEqual('mainnet');
  });
});
