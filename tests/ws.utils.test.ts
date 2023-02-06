import { mockedAddAlert } from '@tests/utils/alerting.utils.mock';
import { connectionInfoFromEvent } from '@src/ws/utils';
import { Severity } from '@src/types';

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
  expect(connInfo).toStrictEqual({ id: 'abc123', url: `https://${process.env.WS_DOMAIN}` });
});

test('missing WS_DOMAIN should throw', () => {
  expect.hasAssertions();

  delete process.env.WS_DOMAIN;
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
  expect(() => connectionInfoFromEvent(event)).toThrow('Domain not on env variables');
  expect(mockedAddAlert).toHaveBeenCalledWith(
    'Erroed while fetching connection info',
    'Domain not on env variables',
    Severity.MINOR,
  );
});
