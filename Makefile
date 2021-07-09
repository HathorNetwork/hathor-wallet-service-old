.PHONY: deploy-lambdas-dev
deploy-lambdas-dev:
	serverless deploy --stage dev --region eu-central-1

.PHONY: deploy-lambdas-prod
deploy-lambdas-prod:
	serverless deploy --stage prod --region eu-central-1
