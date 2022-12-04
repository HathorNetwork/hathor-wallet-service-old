export const sendMulticastMock = jest.fn();
export const messaging = jest.fn();

export default jest.mock('firebase-admin', () => ({
  credential: {
    cert: jest.fn(),
  },
  initializeApp: jest.fn(),
  messaging: messaging.mockImplementation(() => ({
    sendMulticast: sendMulticastMock.mockReturnValue({
      failureCount: 0,
    }),
  })),
}));
