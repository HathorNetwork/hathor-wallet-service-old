# hathor-wallet-service

[add introduction]


## Test locally

The plugin serverless-offline is used to emulate AWS Lambda and API Gateway on a local machine.

### Requirements
1. nodejs v12

### Local database

You need to run a mysql database. Check out DATABASE.md to see the necessary tables.

### .env file

Create a `.env` file on the top project folder. It should have the following variables:
```
STAGE=local
MAX_ADDRESS_GAP=10
DB_ENDPOINT=localhost
DB_NAME=wallet_service
DB_USER=my_user
DB_PASS=password123
```

Do not modify the `STAGE` variable. The other variables should be updated accordingly.

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
curl --request GET http://localhost:3000/balance/?id=23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9
```

#### Fetch wallet addresses
```
curl --request GET http://localhost:3000/addresses/?id=23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9
```

#### Fetch tx history
```
curl --request GET 'http://localhost:3000/txhistory/?id=23b44673413f093180ed37ce34b6577d7dedbdec9c1d909fe42be1b0bc341ec9&count=5'
```

### Troubleshooting

> Error: More than one instance of bitcore-lib found

This is probably only a bug when running locally (I haven't tried deploying yet). Used this hack to get it working:
https://github.com/bitpay/bitcore/issues/1454#issuecomment-306900782
