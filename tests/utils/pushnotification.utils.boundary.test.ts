/* eslint-disable jest/no-disabled-tests */
import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { SendNotificationToDevice } from '@src/types';

const registrationToken = 'fGw0qy4TGgk:APA91bGtWGjuhp4WRhHXgbabIYp1jxEKI08ofj_v1bKhWAGJQ4e3arRCW'
  + 'zeTfHaLz83mBnDh0aPWB1AykXAVUUGl2h1wT4XI6XazWpvY7RBUSYfoxtqSWGIm2nvWh2BOP1YG501SsRoE';
const invalidRegistrationToken = 'invalid-registration-token';

// This test was designed to make real call to FCM.
// NOTE: Use a testing project. Do not use production project.
describe('pushnotification.utils', () => {
  describe('sendToFcm', () => {
    it.skip('should call FCM', async () => {
      expect.hasAssertions();

      const deviceId = invalidRegistrationToken;
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
