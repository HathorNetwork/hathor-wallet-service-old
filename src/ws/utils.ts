import { APIGatewayProxyEvent } from 'aws-lambda';

import AWS from 'aws-sdk';
import util from 'util';

/*
 * TODO: make sure this would format connection url properly on the lambda
 *
 * */
export const connectionUrlFromEvent = (
  connectionId: string,
  event: APIGatewayProxyEvent,
): string => {
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;

  if (stage === 'local') {
    return 'http://localhost:3001';
  }
  // return util.format(util.format('https://%s/%s', domain, stage));
  return util.format(util.format('https://%s/%s/@connections/%s', domain, stage, connectionId));
};

export const sendMessageToClient = (
  url: string,
  connectionId: string,
  payload: any, // eslint-disable-line
): Promise<any> => new Promise((resolve, reject) => { // eslint-disable-line
  const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: url,
  });
  apigatewaymanagementapi.postToConnection(
    {
      ConnectionId: connectionId, // connectionId of the receiving ws-client
      Data: JSON.stringify(payload),
    },
    (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    },
  );
});
