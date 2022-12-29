/* eslint-disable jest/no-disabled-tests */
import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { SendNotificationToDevice } from '@src/types';

const registrationToken = 'fR4TqxCASDCtV1sWs53ZO0:APA91bE0lw-t44auU5AS0-cj3qcUiIH_bGY8m_TwnNvnx5xEus3yPYy-95zmz-h6PNp9tKFazyfu0wb7E0o_zqjR3eqP3Q1lSMbgK9X6NQIUAhkLtAmDE1LaEoN7ql1p18XPHQClM5P0';
const invalidRegistrationToken = 'invalid-registration-token';

// This test was designed to make real call to FCM.
// NOTE: Use a testing project. Do not use production project.
describe('pushnotification.utils', () => {
  describe('sendToFcm', () => {
    it('should call FCM', async () => {
      expect.hasAssertions();

      const deviceId = registrationToken;
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

      expect(result).toStrictEqual({});
    });
  });
});
