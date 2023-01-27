import { PushNotificationUtils } from '@src/utils/pushnotification.utils';
import { SendNotificationToDevice } from '@src/types';

/**
 * README
 * To make this test work, you need to comment the line
 * `'<rootDir>/tests/utils/pushnotification.utils.boundary.test.ts',` in jest.config.js.
 *
 * You need to configure the firebase environment variables in the .env file.
 *
 * ATTENTION!
 * - The tests in this file are not run by default because they trigger real calls to FCM.
 * - Do NOT use production configuration to run the tests.
 */

/**
 * Run the following test to send a notification to your device.
 * @example
 * npx jest --testPathPattern=pushnotification.utils.boundary.test.ts -t=sendToFcm
 */
test('sendToFcm', async () => {
  expect.hasAssertions();

  const buildNotification = (deviceId: string, metadata?: Record<string, unknown>) => ({
    deviceId,
    metadata: {
      txId: '00c30fc8a1b9a326a766ab0351faf3635297d316fd039a0eda01734d9de40185',
      bodyLocKey: 'new_transaction_received_description_without_tokens',
      titleLocKey: 'new_transaction_received_title',
      ...metadata,
    },
  } as SendNotificationToDevice);

  // Go to the wallet-mobile and log the deviceId in the push notification saga initialization.
  const notification = buildNotification('<add-your-device-id>');

  const result = await PushNotificationUtils.sendToFcm(notification);

  expect(result.success).toStrictEqual(true);
});
