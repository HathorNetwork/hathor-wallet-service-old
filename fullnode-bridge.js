/* eslint-disable */
const fs = require('fs');
const WebSocket = require('ws');
const AWS = require('aws-sdk');

// we need to set a region even if we don't make any calls
AWS.config.update({region:'us-east-1'});

const FULLNODE_URL = 'ws://localhost:8080/v1a/ws/';
const eventTemplate = fs.readFileSync('events/eventTemplate.json', 'utf8');

const ws = new WebSocket(FULLNODE_URL);

const lambda = new AWS.Lambda({
  apiVersion: '2015-03-31',
  endpoint: 'http://localhost:3002',
});


ws.on('open', () => {
  console.log('WS OPEN');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'network:new_tx_accepted') {
    console.log('new tx', msg.tx_id);
    const newEvent = JSON.parse(eventTemplate);
    const record = newEvent.Records[0];
    record.body = msg;
    record.attributes.MessageDeduplicationId = msg.tx_id;

    const params = {
      // FunctionName is composed of: service name - stage - function name
      FunctionName: 'hathor-wallet-service-local-onNewTxEvent',
      //InvocationType: 'Event',
      // we could just send the tx, but we'll use the template to emulate a SQS message
      Payload: JSON.stringify(newEvent),
    };
    lambda.invoke(params, (err, data) => {
      if (err) console.error('invoke', err);
      else console.log('lambda successfull for', msg.tx_id);
    });
  }
});
