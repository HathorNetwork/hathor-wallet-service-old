import hathorLib from '@hathor/wallet-lib';
import { NftUtils } from '@src/utils/nft.utils';
import { getTransaction } from '@events/nftCreationTx';

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
