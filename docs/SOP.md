# Standard Operating Procedures

## Deploying

The deployment is partially automated with CodeBuild and CodePipeline in AWS.

It's triggered when commits are made to `dev` or `master` branches, and when tags with names like `v*` are created.

Each case deploys to a different environment:
- `dev` branch -> `dev-testnet` environment
- `master` branch -> `testnet` environment
- `v*` tags -> `mainnet` environment

All of them require manual approval to proceed. You should keep an eye in the `#deploys` channel in Slack, the approval requests are sent there.

If you need to know the exact steps that take place during deployment, check [this document](2021-07-29-infrastructure-design.md#how-the-process-works)

### Avoiding downtime
We always want to make sure the migrations do not generate downtimes while running.

Check [this document](2021-07-29-infrastructure-design.md#avoiding-downtimes-during-schema-migrations) for more info on how to build safe migrations.

In case it's not possible to build a downtime-safe migration (this can happen), we have a maintenance mode in place that should be enabled before deploying, or before approving the deployment request in CodePipeline. Check below how to enable it.


## Enabling debug logs

The logger is set on the INFO level by default.

To enable more verbose debug logs, we need to change the `LOG_LEVEL` environment variable. This can be done by either changing the default deploy variable on `$PROJECT_DIR/.codebuild/buildspec.yml` and triggering a new deploy by following the steps on the **Deploying** section or by manually setting it on the AWS Lambda configuration tab for the Lamdba you desire to change the log level, valid severity values are `error`, `warn`, `info`, `verbose`, `debug` and `silly`

Changing the environment will cause the lambda to be restarted, so the next request will already be logged

## Enabling Maintenance Mode
TODO - This is not implemented yet
