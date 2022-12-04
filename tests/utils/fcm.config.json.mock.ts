export const fcmConfigMock = jest.fn().mockImplementation(() => ({}));

// By default load no file
jest.mock('@src/utils/fcm.config.json', () => fcmConfigMock(), { virtual: true });
