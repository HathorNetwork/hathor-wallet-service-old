.PHONY: deploy-lambdas-dev-testnet
deploy-lambdas-dev-testnet:
	serverless deploy --stage dev-testnet --region eu-central-1

.PHONY: deploy-lambdas-testnet
deploy-lambdas-testnet:
	serverless deploy --stage testnet --region eu-central-1

.PHONY: deploy-lambdas-mainnet
deploy-lambdas-mainnet:
	serverless deploy --stage mainnet --region eu-central-1

.PHONY: migrate
migrate:
	@echo "Migrating..."
	npx sequelize-cli db:migrate

.PHONY: seed_testnet
seed_testnet:
	npx sequelize-cli db:seed --seed testnet

.PHONY: seed_mainnet
seed_mainnet:
	npx sequelize-cli db:seed --seed mainnet

.PHONY: cleanup
cleanup:
	rm db.sqlite3
