# Infrastructure Design

Date: 2021-07-29

Issue: https://github.com/HathorNetwork/hathor-wallet-service/issues/80

## Summary

- [Infrastructure Components](#infrastructure-components)
- [Continuous Integration](#continuous-integration)
- [Infra as Code](#infra-as-code)
- [Continuous Deployment](#continuous-deployment)
- [Monitoring](#monitoring)
- [Security](#security)

## Infrastructure Components
- MySQL Database
- Redis Server
- Api Gateway + Lambdas
- SQS Queue
- Daemon (Kubernetes)
- FullNode (Kubernetes)

We have a diagram of the interaction between them in https://github.com/HathorNetwork/ops-tools/blob/master/infra-diagram/img/hathor-wallet-service.png (private repo)

## Continuous Integration

- We will run tests on every PR, and spin up MySQL and Redis containers to be used in the tests
- The migrations and initial seed data will be run in this MySQL container before running the tests
- We will integrate with Codecov for test coverage reports

## Infra as Code
We will try to keep everything commited as code. To achieve this, 3 mechanisms will be used:

### Serverless
Will be used to describe and create the Lambdas, API Gateway and SQS Queue. The files will be commited in the same repo as the application.

### Terraform
Will be used to describe and create any additional AWS resources that we need, mainly Redis with Elasticache and MySQL with RDS, but also everything else, like Security Groups, Route53 domains, CloudWatch Alarms, etc.

Those files will be located in our infra private repo.

### Kubernetes
Will be used to describe and create what will be run inside it, which currently are the Daemon and the FullNode.

We will be using additional tools that are already installed in our cluster to support the application, like:
- NginxIngress to expose the FullNode internally in the VPC
- CertManager to generate SSL certificates for the FullNode's domain
- Flux as part of the CD pipeline. Check the [session below](#continuous-deployment)

Everything will be commited as code in our infra private repo.

## Continuous Deployment
We have two differente services to deploy, WalletService and Daemon.

WalletService's deploy will consist of:

- Run migrations in the database
- Deploy the new Lambdas

Daemon's deploy will consist of:
- Build and push a new Docker image
- Flux detects the image and updates the container

Those tasks will be orchestrated by AWS Code Pipeline, and will be automatically triggered by events in the Github repository. For deployments in the mainnet, the event will be the creation of a release tag. For testnet and dev environments, commits in master and dev branches.

The reason for choosing Code Pipeline is that it's capable of accessing the database through our VPC to perform migrations in a safe manner. Check this issue for more details about this decision: https://github.com/HathorNetwork/ops-tools/issues/113

The way it works is similar to Github Actions. We create a spec file declaring the steps that we want it to run, and configuring which branch we want to trigger the build. It seems to be possible to trigger it on GitHub releases too.

All the configuration needed by CodePipeline will be defined and created using Terraform.

### Maintenance mode
A maintenance mode will be implemented in the WalletService, if we need to warn users before we run some potentially dangerous or slow migration that could cause downtimes.

This maintenance mode will work by setting a flag in our Redis instance, that the service will use to know that this mode is enabled and warn the wallets.

A Lambda function will be built that enables/disables the mode, and its execution will be triggered by the developers before deploying a new version.

We will use CodePipeline's Manual Approval mechanism to ALWAYS stop the deployment pipeline and warn the user that he should think about whether the maintenance mode should be activated for this deployment or not.

It will be the developer's responsibility to make this decision.

If he/she thinks that it's safe to proceed, then the deployment can be approved. Otherwise, he/she will have to enable the maintenance mode manually before approving the deployment, and disabling it afterwards.

### Avoiding downtimes during schema migrations

The thing that inspired the maintenance mode above is the possibility we have of generating downtimes during database schema migrations.

There are 2 possible causes of downtime during schema migrations:

1. Downtime because of mismatch between DB schema and application code
2. Tables locked while migration runs

The first case is only solvable by making sure we only do backwards-compatible changes in the DB schema. This article has some good examples: https://spring.io/blog/2016/05/31/zero-downtime-deployment-with-a-database

The second case is more difficult to solve completely. It doesn't seem to be worth it to try, because it would introduce a lot of additional complexity to our setup. Probably something like a Blue-Green deployment would be needed, including replication of the database, and this creates too much complexity, like making sure the DBs are in-sync, which includes syncing them even when one has run the schema migrations while the other hasn't yet.

So the best option seems to be simply minimize the effects of possible locks in the database. And that's where the maintenance mode comes into hand.

#### How to know if a migration is downtime-safe

1. Make sure all changes in the schema are backwards compatible. To know this, just think: If I run the migrations but do not update the application, will it still work?

2. Make sure all operations run by the migrations do not lock whole tables, especially if they are big ones.

MySQL includes features for online schema changes, and a lot of operations already allow running DML operations while a DDL operation is running. So schema migrations that just run those operations could be run without locking the table: https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html#online-ddl-column-operations

In some cases it will work out of the box, but to be 100% sure, we should include the options `LOCK=NONE, ALGORITHM=INPLACE` in the schema migrations performed in big tables.

### Alternatives
Other options were discussed in https://github.com/HathorNetwork/hathor-wallet-service/issues/80#issuecomment-879973859

## Monitoring

We will employ different strategies to monitor the critical events we want to be alerted of.

This is a table summarizing the main events and how they will be monitored.

### Wallet Service

| Event | Proposed Solution |
|-----------------------------------------------------------------------------|--------------------------------------------------------------------------- |
| Error on balance calculation, on MySQL connection or on FullNode connection | Log an error or exit error in the Lambda, then put CloudWatch alarms on then. |
| WalletService and FullNode out of sync | Expose the highest block height to Prometheus through API Gateway, and compare with the FullNode. |


### Daemon

|  Event | Proposed Solution |
|-----------------------------------------------------------------------------|------------------------------------------------------------------------ |
| A reorg is detected with more than 1000 blocks difference | Log this event with a marker, then create Alarms when the marker appears |
| More than X minutes/seconds without a new block from the connected fullnode | Already monitored in the full-nodes. | | |
| Websocket connection lost with the full-node after X retries | Log this event with a marker, then create Alarms when the marker appears |
| Daemon and FullNode out of sync | Expose the highest block height from the Daemon to Prometheus |


### Databases

| Event | Proposed Solution |
|-----------------------------------------------------------------------------|------------------------------------------------------------------------- |
| AWS RDS metrics | CloudWatch alarms to warn about the most important ones |
| Locks in tables | Use MySQL Exporter to extract metrics to Prometheus and create alerts on this |
| Slow Queries | Use MySQL Exporter to extract metrics to Prometheus and create alerts on this |
| Slow Migrations | Measure the time they take to run in AWS CodePipeline |

## Security

Those are the security measures we will be taking:

- The Database, Redis Server and FullNode will be exposed only inside our VPC
- Rate Limits will be configured in Api Gateway
- An authentication mechanism to assure only the owner can listen to a wallet in websocket is being designed in https://github.com/HathorNetwork/hathor-wallet-service/issues/84

## Other Aspects

- The MySQL Database will have daily backups in AWS RDS
- To upgrade the full-node, one just has to do the same as in https://github.com/HathorNetwork/ops-tools/pull/71/files
