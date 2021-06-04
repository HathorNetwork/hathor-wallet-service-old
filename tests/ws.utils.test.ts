import {
  connectionInfoFromEvent,
} from '@src/ws/utils';

test('connectionInfoFromEvent', async () => {
  expect.hasAssertions();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const event = {
    requestContext: {
      connectionId: 'abc123',
      domainName: 'dom123',
      stage: 'test123',
    },
  };
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const connInfo = connectionInfoFromEvent(event);
  expect(connInfo).toStrictEqual({ id: 'abc123', url: 'https://dom123/test123' });
});
