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
The main tasks that will be performed during deploy are:

- Run migrations in the database
- Deploy the new Lambdas
- Deploy the new Daemon

Those tasks will be orchestrated by AWS Code Pipeline.

The reason for choosing Code Pipeline is that it's capable of accesing the database through our VPC to perform migrations.

The way it works is similar to Github Actions. We create a spec file declaring the steps that we want it to run, and configuring which branch we want to trigger the build. It seems to be possible to trigger it on GitHub releases too.

Also, we need to create the Pipeline in AWS CodePipeline, create a connection to GitHub, create a build configuration in AWs CodeBuild, among other things.

We will create those AWS resources using Terraform.

### Deployment Steps
The steps to be run by CodePipeline are:

- Run our migrations command defined in Makefile. This will make it connect directly to the database.
- Run our `serverless deploy` command defined in Makefile. This makes it build and upload the Lambdas.
- Build a new Docker image for the daemon and push to our ECR repository. We will configure Flux inside our Kubernetes to monitor this repository and rollout the Daemon to run the new version whenever a new image is detected.

### Alternatives
Other options were discussed in https://github.com/HathorNetwork/hathor-wallet-service/issues/80#issuecomment-879973859

## Monitoring

We will employ different strategies to monitor the critical events we want to be alerted of.

This is a table summarizing the main events and how they will be monitored. We will talk about each solution in the sequence.

### Wallet Service

| Event | Proposed Solution | Alternative Solution 1 | Alternative Solution 2 |
|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|-----------------------------------------------------------|
| Error on balance calculation, on MySQL connection or on FullNode connection | Log an error or exit error in the Lambda, then put CloudWatch alarms on then. | Have the involved Lambdas send a message to SNS | |
| Database metrics alerts, like CPU credits used up | CloudWatch alarms | | |
| WalletService and FullNode out of sync | Expose the highest block height to Prometheus, and compare with the FullNode. | Have a Lambda that compares the FullNode metric with `getLatestBlock` Lambda return | CloudWatch alarm when `onNewTxRequest` stops being called |

#### WalletService and FullNode out of sync
The proposed solution for this is also the one with the highest uncertainty.

To be able to expose metrics to Prometheus, we have 2 options:
- Deploy a PushGateway. Then we would need to make the Lambdas send the metrics to PushGateway.
- Expose an endpoint with API Gateway, then configure Prometheus to scrape from this endpoint.

The alternative solution 1 is simpler, but also needs some additional work to create the Lambda that would manage this.

The alternative solution 2 is the simplest, but would not get delays on the sync, it would alert only in case of full stop.


### Daemon

|  Event | Proposed Solution | Alternative Solution 1 | Alternative Solution 2 |
|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|-----------------------------------------------------------|
| A reorg is detected with more than 1000 blocks difference | Log this event with a marker, then create Alarms when the marker appears | Monitor this in the FullNodes instead | Have the daemon send a message to SNS |
| More than X minutes/seconds without a new block from the connected fullnode | Already monitored in the full-nodes. | | |
| Websocket connection lost with the full-node after X retries | Log this event with a marker, then create Alarms when the marker appears | | |
| Daemon and FullNode out of sync | Expose the highest block height from the Daemon to Prometheus | Do not monitor this and use only the WalletService <> FullNode monitoring | |

#### Daemon and FullNode out of sync
This one is optional. It's needed only if we want a more precise alerting, that already points whether the sync stopped between the FullNode and Daemon or between the Daemon and WalletService.

If we think we don't need this, this could be left out.

## Security

Those are the security measures we will be taking:

- The Database, Redis Server and FullNode will be exposed only inside our VPC
- Rate Limits will be configure in Api Gateway
    - TODO: Which ones?
- An authentication mechanism to assure only the owner can listen to a wallet in websocket is being designed in https://github.com/HathorNetwork/hathor-wallet-service/issues/84

## Other Aspects

- The MySQL Database will have daily backups in AWS RDS
- To upgrade the full-node, one just has to do the same as in https://github.com/HathorNetwork/ops-tools/pull/71/files