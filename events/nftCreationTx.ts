import eventTemplate from '@events/eventTemplate.json';
import { SQSEvent } from 'aws-lambda';

export const nftCreationTx = {
  tx_id: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
  version: 2,
  weight: 8.000001,
  timestamp: 1656543561,
  is_voided: false,
  inputs: [
    {
      value: 100,
      token_data: 0,
      script: 'dqkUaf+xVJ8uAPML/AzwuSB+2W9/M7qIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WYLW8ujPemSuLJwbeNvvH6y7nakaJ6cEwT',
        timelock: null,
      },
      token: '00',
      tx_id: '00d749e2ca22edcb231696caaf9df77f489058bd20b6dd26237be24ec918153a',
      index: 1,
    },
  ],
  outputs: [
    {
      value: 1,
      token_data: 0,
      // Decoded script: 5ipfs://QmPCSXNDyPdhU9oQFpxFsNN3nTjg9ZoqESKY5n9Gp1XSJc
      script: 'NWlwZnM6Ly9RbVBDU1hORHlQZGhVOW9RRnB4RnNOTjNuVGpnOVpvcUVTS1k1bjlHcDFYU0pjrA==',
      decoded: {},
      token: '00',
      spent_by: null,
      selected_as_input: false,
    },
    {
      value: 98,
      token_data: 0,
      script: 'dqkUQcQx/3rV1s5VZXqZPc1dkQbPo6eIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WUfmqHWQZWn7aodAFadwmSDfh2QaUUgCRJ',
        timelock: null,
      },
      token: '00',
      spent_by: null,
    },
    {
      value: 1,
      token_data: 1,
      script: 'dqkUQcQx/3rV1s5VZXqZPc1dkQbPo6eIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WUfmqHWQZWn7aodAFadwmSDfh2QaUUgCRJ',
        timelock: null,
      },
      token: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
      spent_by: null,
    },
    {
      value: 1,
      token_data: 129,
      script: 'dqkU1YP+t130UoYD+3ys9MYt1zkWeY6IrA==',
      decoded: {
        type: 'P2PKH',
        address: 'Wi8zvxdXHjaUVAoCJf52t3WovTZYcU9aX6',
        timelock: null,
      },
      token: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
      spent_by: null,
    },
    {
      value: 2,
      token_data: 129,
      script: 'dqkULlcsARvA+pQS8qytBr6Ryjc/SLeIrA==',
      decoded: {
        type: 'P2PKH',
        address: 'WSu4PZVu6cvi3aejtG8w7bomVmg77DtqYt',
        timelock: null,
      },
      token: '0025a6488045d7466639ead179a7f6beb188320f41cdb6df3a971db2ee86dbc3',
      spent_by: null,
    },
  ],
  parents: [
    '00d749e2ca22edcb231696caaf9df77f489058bd20b6dd26237be24ec918153a',
    '004829631be87e5835ff7ec3112f1ab28b59fd96b27c67395e3901555b26bd7e',
  ],
  token_name: 'New NFT',
  token_symbol: 'NNFT',
  tokens: [],
  // Properties exclusive to the wallet-service, in comparison with the lib's sample tx
  is_block: false,
  type: 'network:new_tx_accepted',
  throttled: false,
};

const cloneObj = (obj) => JSON.parse(JSON.stringify(obj));

const evt: SQSEvent = cloneObj(eventTemplate);
evt.Records[0].body = cloneObj(nftCreationTx);
export const nftCreationEvt = evt;
