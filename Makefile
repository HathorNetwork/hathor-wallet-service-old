.PHONY: deploy-lambdas-dev
deploy-lambdas-dev:
	serverless deploy --stage dev --region eu-central-1

.PHONY: deploy-lambdas-prod
deploy-lambdas-prod:
	serverless deploy --stage prod --region eu-central-1

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
