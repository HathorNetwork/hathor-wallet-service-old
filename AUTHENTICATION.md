# Authentication

### Protected functions

- wallet
    - get
- addresses
    - get
- balances
    - get
- txhistory
    - get
- txproposals
    - post
    - put
    - delete

### JWT Authentication

To request a JWT token you need to provide some information to the `auth/token` view.
The method below creates the object with the information needed (must provide xprivkey).

```typescript
import hathorLib from '@hathor/wallet-lib';
import bitcore from 'bitcore-lib';

const createSignatureData = (
  xprivkey: string
): string => {
  const hdprivkey = new bitcore.HDPrivateKey(xprivkey);

  // derive hdprivkey to desired path
  // skip this step if xprivkey was already a derived key
  const derivedPrivKey = hdprivkey.deriveChild("m/44'/280'/0'/0");

  const timestamp = Math.floor(Date.now() / 1000);
  // remember to use hathor's wallet-lib network, not bitcore default nertwork
  const address = derivedPrivKey.publicKey.toAddress(hathorLib.network.getNetwork()).toString();
  // walletId == sha256sha256 of xpubkey as hex
  const walletId = getWalletId(derivedPrivKey.xpubkey);

  // message is a concatenation of known data: timestamp+walletId+address
  const message = new bitcore.Message(String(timestamp).concat(walletId).concat(address));

  return {
    'ts': timestamp,
    'xpub': derivedPrivKey.xpubkey,
    'sign': message.sign(derivedPrivKey.privateKey),
  };
};
```

The endpoint will return a JSON response with:

```ts
{
  "success": true,
  "token": "..."
}
```

The token in this response shoud be used to authenticate the caller on any calls listed on [#Protected functions]()

### Authentication Header

For http(s) triggers, the caller should include the token on the `Authorization` header using the bearer scheme. (i.e. `Bearer abc123token`)
