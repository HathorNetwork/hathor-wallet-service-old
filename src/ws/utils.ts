import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RedisClient } from 'redis';
import { addAlert } from '@src/utils/alerting.utils';

import AWS from 'aws-sdk';
import util from 'util';

import { WsConnectionInfo, Severity } from '@src/types';
import { endWsConnection } from '@src/redis';

export const connectionInfoFromEvent = (
  event: APIGatewayProxyEvent,
): WsConnectionInfo => {
  const connID = event.requestContext.connectionId;
  if (process.env.IS_OFFLINE === 'true') {
    // This will enter when running the service on serverless offline mode
    return {
      id: connID,
      url: 'http://localhost:3001',
    };
  }

  const domain = process.env.WS_DOMAIN;

  if (!domain) {
    addAlert(
      'Erroed while fetching connection info',
      'Domain not on env variables',
      Severity.MINOR,
    );

    // Throw so we receive an alert telling us that something is wrong with the env variable
    // instead of trying to invoke a lambda at https://undefined
    throw new Error('Domain not on env variables');
  }

  return {
    id: connID,
    url: util.format('https://%s', domain),
  };
};

export const sendMessageToClient = async (
  client: RedisClient,
  connInfo: WsConnectionInfo,
  payload: any, // eslint-disable-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const apiGwClient = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: connInfo.url,
  });
  // AWS.Request.promise() will make the request and return a thenable with the response
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Request.html#promise-property
  return apiGwClient.postToConnection(
    {
      ConnectionId: connInfo.id,
      Data: JSON.stringify(payload),
    },
  ).promise().catch(
    (err) => {
      // http GONE(410) means client is disconnected, but still exists on our connection store
      if (err.statusCode === 410) {
        // cleanup connection and subscriptions from redis if GONE
        return endWsConnection(client, connInfo.id);
      }
      throw err;
    },
  );
};

export const disconnectClient = async (
  client: RedisClient,
  connInfo: WsConnectionInfo,
): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const apiGwClient = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: connInfo.url,
  });
  return apiGwClient.deleteConnection(
    {
      ConnectionId: connInfo.id,
    },
  ).promise().catch(
    (err) => {
      // http GONE(410) means client is disconnected, but still exists on our connection store
      if (err.statusCode === 410) {
        // cleanup connection and subscriptions from redis if GONE
        return endWsConnection(client, connInfo.id);
      }
      throw err;
    },
  );
};

export const DEFAULT_API_GATEWAY_RESPONSE: APIGatewayProxyResult = {
  statusCode: 200,
  body: '',
};
