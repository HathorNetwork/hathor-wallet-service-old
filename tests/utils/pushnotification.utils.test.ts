import { PushNotificationUtils, PushNotificationError } from '@src/utils/pushnotification.utils';
import { SendNotificationToDevice } from '@src/types';
import { messaging } from 'firebase-admin';
import { BatchResponse } from 'firebase-admin/messaging';

jest.mock('firebase-admin', () => {
  const mockMulticast = jest.fn(() => Promise.resolve({ failureCount: 0 }));
  const mockMessaging = { sendMulticast: mockMulticast };
  return {
    credential: { cert: jest.fn() },
    messaging: jest.fn(() => mockMessaging),
    initializeApp: jest.fn(),
  };
});

const spyOnSendMulticast = jest.spyOn(messaging(), 'sendMulticast');

describe('pushnotification.utils', () => {
  describe('sendToFcm', () => {
    beforeEach(() => {
      spyOnSendMulticast.mockClear();
    });

    it('should call sendMulticast with general interface', async () => {
      expect.hasAssertions();

      const deviceId = 'device1';
      const title = 'New transaction';
      const description = 'You have received 1 XYZ';
      const txId = 'tx1';

      const notification = {
        deviceId,
        title,
        description,
        metadata: { txId },
      } as SendNotificationToDevice;

      PushNotificationUtils.sendToFcm(notification);

      expect(spyOnSendMulticast).toHaveBeenCalledTimes(1);
      expect(spyOnSendMulticast).toHaveBeenCalledWith({
        tokens: [deviceId],
        notification: {
          title,
          body: description,
        },
        data: {
          txId,
        },
      });
    });

    it('should return success when multicast has no failure', async () => {
      expect.hasAssertions();
      spyOnSendMulticast.mockImplementation(() => Promise.resolve({
        failureCount: 0,
        successCount: 1,
        responses: [
          {
            success: false,
            messageId: undefined,
            error: {
              code: 'messaging/internal',
              message: 'internal error',
            },
          },
        ],
      } as BatchResponse));

      const deviceId = 'device1';
      const title = 'New transaction';
      const description = 'You have received 1 XYZ';
      const txId = 'tx1';

      const notification = {
        deviceId,
        title,
        description,
        metadata: { txId },
      } as SendNotificationToDevice;

      const result = await PushNotificationUtils.sendToFcm(notification);
      expect(result).toStrictEqual({ success: true });
    });

    it('should return fail when multicast has failure', async () => {
      expect.hasAssertions();

      spyOnSendMulticast.mockImplementation(() => Promise.resolve({
        responses: [
          {
            success: false,
            error: {
              code: 'messaging/invalid-argument',
              message: 'The registration token is not a valid FCM registration token',
            },
          },
        ],
        successCount: 0,
        failureCount: 1,
      } as BatchResponse));

      const deviceId = 'device1';
      const title = 'New transaction';
      const description = 'You have received 1 XYZ';
      const txId = 'tx1';

      const notification = {
        deviceId,
        title,
        description,
        metadata: { txId },
      } as SendNotificationToDevice;

      const result = await PushNotificationUtils.sendToFcm(notification);
      expect(result).toStrictEqual({ success: false, errorMessage: PushNotificationError.UNKNOWN });
    });

    it('should return fail with invalid-device-id when multicast fails with not-registered', async () => {
      expect.hasAssertions();
      spyOnSendMulticast.mockImplementation(() => Promise.resolve({
        responses: [
          {
            success: false,
            error: {
              code: 'messaging/registration-token-not-registered',
              message: 'Requested entity was not found.',
            },
          },
        ],
        successCount: 0,
        failureCount: 1,
      } as BatchResponse));

      const deviceId = 'device1';
      const title = 'New transaction';
      const description = 'You have received 1 XYZ';
      const txId = 'tx1';

      const notification = {
        deviceId,
        title,
        description,
        metadata: { txId },
      } as SendNotificationToDevice;

      const result = await PushNotificationUtils.sendToFcm(notification);
      expect(result).toStrictEqual({ success: false, errorMessage: PushNotificationError.INVALID_DEVICE_ID });
    });
  });
});
