SELECT Concat('TRUNCATE TABLE ',table_schema,'.',TABLE_NAME, ';') FROM INFORMATION_SCHEMA.TABLES where  table_schema in ('hathor');

TRUNCATE TABLE hathor.address;
TRUNCATE TABLE hathor.address_balance;
TRUNCATE TABLE hathor.address_tx_history;
TRUNCATE TABLE hathor.metadata;
TRUNCATE TABLE hathor.token;
TRUNCATE TABLE hathor.tx_proposal;
TRUNCATE TABLE hathor.tx_proposal_outputs;
TRUNCATE TABLE hathor.utxo;
TRUNCATE TABLE hathor.version_data;
TRUNCATE TABLE hathor.wallet;
TRUNCATE TABLE hathor.wallet_balance;
TRUNCATE TABLE hathor.wallet_tx_history;
