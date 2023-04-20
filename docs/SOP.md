# Standard Operating Procedures

## Deploying

The deployment is partially automated with CodeBuild and CodePipeline in AWS.

It's triggered when commits are made to `dev` or `master` branches, and when tags with names like `v*` are created.

Each case deploys to a different environment:
- `dev` branch -> `dev-testnet` environment
- `master` branch -> `testnet` environment
- `v*` tags -> `mainnet` environment

All of them require manual approval to proceed. You should keep an eye in the `#wallet-service-deploys` channel in Slack, the approval requests are sent there.

If you need to know the exact steps that take place during deployment, check [this document](2021-07-29-infrastructure-design.md#how-the-process-works)

### Avoiding downtime
We always want to make sure the migrations do not generate downtimes while running.

Check [this document](2021-07-29-infrastructure-design.md#avoiding-downtimes-during-schema-migrations) for more info on how to build safe migrations.

In case it's not possible to build a downtime-safe migration (this can happen), we have a maintenance mode in place that should be enabled before deploying, or before approving the deployment request in CodePipeline. Check below how to enable it.

## Adding new environment variables

If you need to add new environment variables, there are some steps that should be taken.

Let's say we want to add the `ENV_VAR_1` env var.

First step would be to add it to the [serverless.yml](https://github.com/HathorNetwork/hathor-wallet-service/blob/master/serverless.yml) file, under `provider.environment`.

Then, you need to add it in [.codebuild/buildspec.yml](https://github.com/HathorNetwork/hathor-wallet-service/blob/master/.codebuild/buildspec.yml). If it's not a secret, just add it under `env.variables`. 

If it's a secret, you'll need to add it to `env.secrets-manager`, and one for each environment we have (`dev`, `testnet` and `mainnet`). You should use the same name for it as you did in the `serverless.yml` file, but adding a prefix indicating the name of the environment. The value should be the path to a key in AWS Secrets Manager. Ask some account admin for help on adding the secrets there and providing you with the key path.

## Creating a new DB migration

To create a new DB migration, run:

```bash
make new-migration NAME=migration_name
```

It will create an empty migration file for you. You should include your migration logic there.

To run your migration:

```bash
make migrate
```

The migrations will run in the database specified in your local environment configuration. If you need to configure it for a local database, check [this](https://github.com/HathorNetwork/hathor-wallet-service/blob/dev/README.md#local-database).

## Enabling debug logs

The logger is set on the INFO level by default.

To enable more verbose debug logs, we need to change the `LOG_LEVEL` environment variable. This can be done by either changing the default deploy variable on `$PROJECT_DIR/.codebuild/buildspec.yml` and triggering a new deploy by following the steps on the **Deploying** section or by manually setting it on the AWS Lambda configuration tab for the Lamdba you desire to change the log level, valid severity values are `error`, `warn`, `info`, `verbose`, `debug` and `silly`

Changing the environment will cause the lambda to be restarted, so the next request will already be logged

## Enabling Maintenance Mode
TODO - This is not implemented yet
