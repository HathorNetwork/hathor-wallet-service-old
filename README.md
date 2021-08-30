# hathor-wallet-service

The hathor-wallet-service is the backend for all official Hathor wallets.

It's designed to run on AWS serverless environment and uses a MySQL database for persisting data. Upon receiving a new
transaction, a lambda handles updating the data. Later, when a wallet queries it, API lambdas only need to query the
database to get the information.

```
                      +─────────────+
        new           |             |         +──────────+
 ───────────────────▶ | txProcessor |         |          |
    transactions      |  (Lambda)   | ──────▶ | Database |
                      |             |         |          |
                      +─────────────+         +──────────+
                                                    ▲
                                                    |
                                                    ▼
                                        +────────────────────────+
                                        |          APIs          |
                                        | (API Gateway & Lambda) |
                                        +────────────────────────+
                                                    ▲
                                                    |
                                             wallet | requests
                                                    |
```


## Test locally

The plugin serverless-offline is used to emulate AWS Lambda and API Gateway on a local machine.

### Requirements
1. nodejs v12

### Local database

You need to run a mysql database. Check out [DATABASE.md](DATABASE.md) to see the necessary tables.

### .env file

Create a `.env` file on the top project folder. It should have the following variables:
```
STAGE=local
MAX_ADDRESS_GAP=10
NETWORK=mainnet
BLOCK_REWARD_LOCK=300
DB_ENDPOINT=localhost
DB_NAME=wallet_service
DB_USER=my_user
DB_PASS=password123
CONFIRM_FIRST_ADDRESS=true
SERVICE_NAME=hathor-wallet-service
DEFAULT_SERVER=https://node1.mainnet.hathor.network/v1a/
REDIS_HOST=localhost
REDIS_PORT=6379
ADMINTOKEN=foobar
```

Do not modify the `STAGE` variable. The other variables should be updated accordingly.

### AWS cli credentials

You need to have `awscli` [configured with your credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html).
It is required even to locally invoke lambdas.

### Start serverless-offline

```
npm run offline
```
By default, it listens for API calls on `http://localhost:3000`.

### Full-node bridge

```
node fullnode-bridge.js
```
This script connects to a fullnode websocket, listens for new transactions and calls a lambda function to handle it.
It's very simple and not much robust. The fullnode must be running before starting it. It also won't recover from
websocket disconnects.

Expects a full node running on `localhost:8080/v1a/`. You can edit the `FULLNODE_URL` variable on the file to change that.

### API calls

After serverless-offline is running, you can make API calls. Here are some examples.

#### Load a wallet
```
curl --header "Content-Type: application/json" \
  --request POST \
  --data '{"xpubkey":"xpub6EcBoi2vDFcCW5sPAiQpXDYYtXd1mKhUJD64tUi8CPRG1VQFDkAbL8G5gqTmSZD6oq4Yhr5PZ8pKf3Xmb3W3pGcgqzUdFNaCRKL7TZa3res"}' \
  http://localhost:3000/wallet/
```

#### Fetch wallet status
```
curl --request GET http://localhost:3000/wallet/?id=23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9
```

#### Fetch wallet balance
```
curl --request GET http://localhost:3000/balances/?id=23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9
```

#### Fetch wallet addresses
```
curl --request GET http://localhost:3000/addresses/?id=23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9
```

#### Fetch tx history
```
curl --request GET 'http://localhost:3000/txhistory/?id=23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9&count=5'
```

#### Create tx proposal
You need to have some balance for this to succeed.

```
curl --header "Content-Type: application/json" \
  --request POST \
  --data '{ "id": "23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9", "outputs": [{ "address": "H8F5neU87G8gs9XNbNY1XxN9DkAKQKhMoj", "value": 10, "token": "00", "timelock": null}] }' \
  http://localhost:3000/txproposals/
```

#### Send tx proposal
Proposal must have been created before. Use the proposal id in the path and also update the parents, inputs signatures, weight and nonce.
```
curl --header "Content-Type: application/json" \
  --request PUT \
  --data '{ "timestamp": 1599051796, "parents": ["0002ad8d1519daaddc8e1a37b14aac0b045129c01832281fb1c02d873c7abbf9", "0002d4d2a15def7604688e1878ab681142a7b155cbe52a6b4e031250ae96db0a"], "weight": 1, "nonce": 700, "inputsSignatures": ["aaaa"] }' \
  http://localhost:3000/txproposals/{txProposalId}/
```

### WebSocket API

It's designed to run on AWS serverless environment and uses Redis for ephemeral data (connection store).
API Gateway will manage connections while the lambda functions will handle incoming and outcoming messages.
If the lambda is responding to a client sent event it will have the information needed to respond to the client that initiated the call,
but if the event is not client initiated, the connection store should hold an updated list of connected clients and what information they are requesting
so the lambda can filter and send the message to the right clients.


```
                                               +───────────+
                      +─────────────+          |           |
                      |             |         +───────────+|        +───────────────────+
 ◀──────────────────▶ | API GATEWAY |         |           ||        |                   |
    ws connections    |             | ◀─────▶ | Lambda fn |+  ◀──── |        SQS        |
                      |             |         |           |         | (Real Time event) |
                      +─────────────+         +───────────+         |                   |
                                                    |               +───────────────────+
                                                    |
                                                    ▼
                                          +────────────────────+
                                          |       Redis        |
                                          | (Connection store) |
                                          +────────────────────+
```

#### WebSocket Action: PING
- Trigger: Client initiated
- body: `{"action":"ping"}`
- response: `{"message":"PONG"}`

This action is idempotent, the lambda just responds with a `PONG` message.

#### WebSocket Action: Join Wallet
- Trigger: Client initiated
- body: `{"action":"joinWallet", "wallet":"my-wallet-id"}`

This action will subscribe the client to any updates of the wallet identified by the id on the body.

#### WebSocket Action: New TX
- Trigger: SQS Event
- When: A new tx is processed by the wallet-service
- To: All wallets affected by the tx
- body: The tx in JSON format

#### WebSocket Action: Update TX
- Trigger: SQS Event
- When: An update is made to a tx that was already processed
- To: All wallets affected by the tx
- body: The update information and tx id

### Troubleshooting

#### bitcore-lib

> Error: More than one instance of bitcore-lib found

This is probably only a bug when running locally (I haven't tried deploying yet). Used this hack to get it working:
https://github.com/bitpay/bitcore/issues/1454#issuecomment-306900782

#### jest using old files

Sometimes, jest will use old cached js files, even after you modified the typescript code. Just run:
```
./node_modules/.bin/jest --clearCache
```

## Standard Operating Procedures