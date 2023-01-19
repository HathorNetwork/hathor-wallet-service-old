import fullnode from '@src/fullnode';

test('downloadTx', async () => {
  expect.hasAssertions();

  const mockData = {
    success: true,
    tx: {
      hash: 'tx1',
    },
    meta: {},
  };

  const apiGetSpy = jest.spyOn(fullnode.api, 'get');
  apiGetSpy.mockImplementation(() => Promise.resolve({
    status: 200,
    data: mockData,
  }));

  const response = await fullnode.downloadTx('tx1');
  expect(response).toStrictEqual(mockData);
});

test('getConfirmationData', async () => {
  expect.hasAssertions();

  const mockData = {
    success: true,
    accumulated_weight: 67.45956109191802,
    accumulated_bigger: true,
    stop_value: 67.45416781056525,
    confirmation_level: 1,
  };

  const apiGetSpy = jest.spyOn(fullnode.api, 'get');
  apiGetSpy.mockImplementation(() => Promise.resolve({
    status: 200,
    data: mockData,
  }));

  const response = await fullnode.getConfirmationData('tx1');
  expect(response).toStrictEqual(mockData);
});

test('queryGraphvizNeighbours', async () => {
  expect.hasAssertions();

  const mockData = 'diagraph {}';

  const apiGetSpy = jest.spyOn(fullnode.api, 'get');
  apiGetSpy.mockImplementation(() => Promise.resolve({
    status: 200,
    data: mockData,
  }));

  const response = await fullnode.queryGraphvizNeighbours('tx1', 'test', 1);
  expect(response).toStrictEqual(mockData);
});
