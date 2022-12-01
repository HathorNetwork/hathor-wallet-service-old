export const fcmConfigMock = jest.fn();

// By default load no file
jest.mock('@src/utils/fcm.config.json', () => fcmConfigMock.mockImplementation(() => (undefined))(), { virtual: true });
