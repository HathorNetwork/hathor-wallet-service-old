import hathorLib from '@hathor/wallet-lib';
import { NftUtils } from '@src/utils/nft.utils';
import { getTransaction } from '@events/nftCreationTx';
import axios from 'axios';
import { Lambda } from 'aws-sdk';

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
      throw new Error('not an nft');
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
    const expectedHttpResponse = {
      status: 404,
      data: { whateverData: 'ignore' },
    };
    spyAxiosGet.mockImplementation(async () => {
      throw expectedHttpResponse;
    });

    const results = await NftUtils._getTokenMetadata('sampleUid');
    expect(results).toStrictEqual({});
  });

  it('should rethrow when an error happens', async () => {
    expect.hasAssertions();
    const expectedHttpResponse = {
      status: 500,
      data: { description: 'error message' },
    };
    spyAxiosGet.mockImplementation(async () => {
      throw expectedHttpResponse;
    });

    const result = await NftUtils._getTokenMetadata('sampleUid')
      .catch((err) => err);

    expect(result).toStrictEqual(expectedHttpResponse);
  });
});

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('_updateMetadata', () => {
  // const spyLambdaInvoke = jest.spyOn(Lambda.prototype, 'invoke');
  // afterEach(() => {
  //   spyLambdaInvoke.mockReset();
  // });
  // afterAll(() => {
  //   spyLambdaInvoke.mockRestore();
  // });

  it('should return the update lambda response on success', async () => {
    expect.hasAssertions();

    const expectedResponse = {
      StatusCode: 202,
      Payload: 'sampleData',
    };

    // Typescript demands this object to be more complex than the tests need. Supressing these requirements.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    spyLambdaInvoke.mockImplementation(async () => ({
      promise: async () => expectedResponse,
    }));

    const result = await NftUtils._updateMetadata('sampleUid', { sampleData: 'fake' });
    expect(result).toStrictEqual(expectedResponse);
  });
});
