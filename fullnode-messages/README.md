# Wallet Service Messages

Connects the full node with the wallet service, listening for new specific websocket messages and adding them to a SQS queue.

# Run

- Create your configuration file (`cp src/config.ts.template src/config.ts`);
- Fill the variables at `src/config.ts`;
- Run `npm run tsc` to compile ts files to js;
- Run `npm start`.

# Linter

`npm run lint`