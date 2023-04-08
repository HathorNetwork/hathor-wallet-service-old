set -e;

send_slack_message() {
    DEPLOYED_VERSION=$1;

    curl -H "Content-type: application/json" \
        --data "{\"channel\":\"${SLACK_CHANNEL_ID}\",\"blocks\":[{\"type\":\"section\",\"text\":{\"type\":\"mrkdwn\",\"text\":\"*Hathor Wallet Service*\nNew version deployed: ${DEPLOYED_VERSION}\"}}]}" \
        -H "Authorization: Bearer ${SLACK_OAUTH_TOKEN}" \
        -X POST https://slack.com/api/chat.postMessage;
}

if expr "${GIT_REF_TO_DEPLOY}" : "master" >/dev/null; then
    # Gets all env vars with `testnet_` prefix and re-exports them without the prefix
    for var in "${!testnet_@}"; do
    export ${var#testnet_}="${!var}"
    done
    make migrate;
    make deploy-lambdas-testnet;
elif expr "${GIT_REF_TO_DEPLOY}" : "v[0-9]\+\.[0-9]\+\.[0-9]\+-rc\.[0-9]\+" >/dev/null; then
    # Gets all env vars with `mainnet_staging_` prefix and re-exports them without the prefix
    for var in "${!mainnet_staging_@}"; do
    export ${var#mainnet_staging_}="${!var}"
    done
    make migrate;
    make deploy-lambdas-mainnet-staging;
    send_slack_message "${GIT_REF_TO_DEPLOY}"
elif expr "${GIT_REF_TO_DEPLOY}" : "v.*" >/dev/null; then
    # Gets all env vars with `mainnet_` prefix and re-exports them without the prefix
    for var in "${!mainnet_@}"; do
    export ${var#mainnet_}="${!var}"
    done
    make migrate;
    make deploy-lambdas-mainnet;
    send_slack_message "${GIT_REF_TO_DEPLOY}"
else
    # Gets all env vars with `dev_` prefix and re-exports them without the prefix
    for var in "${!dev_@}"; do
    export ${var#dev_}="${!var}"
    done
    make migrate;
    make deploy-lambdas-dev-testnet;
    send_slack_message "${GIT_REF_TO_DEPLOY}"  # TODO: Remove this from here
fi;
