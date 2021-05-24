import { APIGatewayProxyEvent } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
import { RedisClient } from 'redis';

import AWS from 'aws-sdk';
import util from 'util';

import { WsConnectionInfo } from '@src/types';
import { closeDbConnection } from '@src/utils';
import { closeRedisClient, endWsConnection } from '@src/redis';

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
  return {
    id: connID,
    url: util.format(util.format('https://%s/%s', domain, stage)),
  };
};

export const sendMessageToClient = async (
  connInfo: WsConnectionInfo,
  client: RedisClient,
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
        // http GONE(410) means client is disconnected, but still exists on our connection store
        if (err.statusCode === 410) {
          // cleanup connection and subscriptions from redis if GONE
          resolve(endWsConnection(client, connInfo.id));
        }
        reject(err);
      }
      resolve(data);
    },
  );
});

export const disconnectClient = async (
  connInfo: WsConnectionInfo,
  client: RedisClient,
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
        // http GONE(410) means client is disconnected, but still exists on our connection store
        if (err.statusCode === 410) {
          // cleanup connection and subscriptions from redis if GONE
          resolve(endWsConnection(client, connInfo.id));
        }
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
  redisClient?: RedisClient,
  mysql?: ServerlessMysql,
): Promise<{statusCode: number}> => {
  if (mysql) {
    await closeDbConnection(mysql);
  }
  await sendMessageToClient(connInfo, redisClient, payload);
  // sendMessage may use redisClient, so we need to close after sending message
  if (redisClient) {
    await closeRedisClient(redisClient);
  }
  return { statusCode };
};
