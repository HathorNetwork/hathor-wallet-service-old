export class WalletLimitExceeded extends Error {
  name: string;

  constructor(m: string) {
    super(m);
    // https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, WalletLimitExceeded.prototype);
    this.name = 'WalletLimitExceeded';
  }
}
