import { APIGatewayProxyEvent } from 'aws-lambda';

import { WsConnectionInfo } from '@src/types';
import AWS from 'aws-sdk';
import util from 'util';

/*
 * TODO: make sure this would format connection url properly on the lambda
 *
 * */
export const connectionInfoFromEvent = (
  event: APIGatewayProxyEvent,
): WsConnectionInfo => {
  const connID = event.requestContext.connectionId;
  if (process.env.IS_OFFLINE === 'true') {
    return {
      id: connID,
      url: 'http://localhost:3001',
    };
  }
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  // return util.format(util.format('https://%s/%s', domain, stage));
  return {
    id: connID,
    url: util.format(util.format('https://%s/%s/@connections/%s', domain, stage, connID)),
  };
};

export const sendMessageToClient = async (
  connInfo: WsConnectionInfo,
  payload: any, // eslint-disable-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
): Promise<any> => new Promise((resolve, reject) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: connInfo.url,
  });
  apigatewaymanagementapi.postToConnection(
    {
      ConnectionId: connInfo.id,
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

export const disconnectClient = async (
  connInfo: WsConnectionInfo,
): Promise<any> => new Promise((resolve, reject) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: connInfo.url,
  });
  apigatewaymanagementapi.deleteConnection(
    {
      ConnectionId: connInfo.id,
    },
    (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    },
  );
});

export const sendAndReturn = async (
  connInfo: WsConnectionInfo,
  statusCode: number,
  payload: any, // eslint-disable-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
): Promise<{statusCode: number}> => {
  await sendMessageToClient(connInfo, payload);
  return { statusCode };
};
