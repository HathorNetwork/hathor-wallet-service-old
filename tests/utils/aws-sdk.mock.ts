export const promiseMock = jest.fn();
export const invokeMock = jest.fn();
export const newLambdaMock = jest.fn().mockReturnValue({
  invoke: invokeMock.mockReturnValue({
    promise: promiseMock.mockReturnValue({
      StatusCode: 202,
    }),
  }),
});

jest.mock('aws-sdk', () => ({
  Lambda: newLambdaMock,
}));
