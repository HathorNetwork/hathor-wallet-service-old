export const mockedAddAlert = jest.fn();
export default jest.mock('@src/utils/alerting.utils', () => ({
  addAlert: mockedAddAlert.mockReturnValue(Promise.resolve()),
}));
