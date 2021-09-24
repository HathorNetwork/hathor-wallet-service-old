/* eslint-disable */

/*
 * This script starts a connection with a local full node and listens to new transactions. Upon
 * receiving a tx, it invokes the wallet-service lambda to handle it.
 *
 * This code is to be used on dev environments only.
 */

const fs = require('fs');
const WebSocket = require('ws');
const AWS = require('aws-sdk');

// we need to set a region even if we don't make any calls
AWS.config.update({region:'us-east-1'});

const FULLNODE_URL = 'ws://localhost:8080/v1a/ws/';
const eventTemplate = fs.readFileSync('events/eventTemplate.json', 'utf8');

const ws = new WebSocket(FULLNODE_URL);

const queue = [];

let count = 0;

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
    count += 1;
    console.log('new tx, count', count, 'height', msg.height, msg.tx_id);
    
    if (msg.is_voided) {
      console.log('** voided', msg.tx_id);
      return;
    }

    queue.push(msg);
    if (queue.length === 1) {
      sendEvent(msg);
    }

  }
});

const sendEvent = (msg) => {
  const newEvent = JSON.parse(eventTemplate);
  const record = newEvent.Records[0];
  record.body = msg;
  record.messageId = msg.tx_id;
  record.md5OfBody = msg.tx_id;
  record.attributes.MessageDeduplicationId = msg.tx_id;

  const params = {
    // FunctionName is composed of: service name - stage - function name
    FunctionName: 'hathor-wallet-service-local-onNewTxEvent',
    // we could just send the tx, but we'll use the template to emulate a SQS message
    Payload: JSON.stringify(newEvent),
  };
  lambda.invoke(params, (err, data) => {
    if (err) {
      console.error('ERROR', msg.tx_id, err);
      return process.exit(1);
    }
    else {
      console.log('lambda successfull for', msg.tx_id);
      queue.shift();
      if (queue.length > 0) {
        const tx = queue[0];
        console.log('process from queue', tx.tx_id, 'height', tx.height);
        sendEvent(tx);
      }
    }
  });
};
