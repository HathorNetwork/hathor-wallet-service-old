# Database

The service requires the following databases to work.

```
// TODO most `varchar` fields can be converted to `binary`
// TODO create db indexes

CREATE TABLE `address` (
  `address` varchar(34) NOT NULL,
  `index` int unsigned DEFAULT NULL,
  `wallet_id` varchar(64) DEFAULT NULL,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`address`)
);

-- Unlocked authorities represents:
-- null or 0b00 - Has no authority
-- 0b01 - Mint authority
-- 0b11 - Mint and Melt authority
-- 0b10 - Melt authority

-- This is always up to date with the authorities in every
-- UTXO for this address.

CREATE TABLE `address_balance` (
  `address` varchar(34) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `unlocked_balance` bigint unsigned NOT NULL,
  `locked_balance` bigint unsigned NOT NULL,
  `unlocked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `locked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `timelock_expires` int unsigned,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`address`,`token_id`)
);

CREATE TABLE `address_tx_history` (
  `address` varchar(34) NOT NULL,
  `tx_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `balance` bigint NOT NULL,
  `timestamp` int unsigned NOT NULL,
  `dirty` tinyint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`address`,`tx_id`,`token_id`)
);

-- This should allow for only one row at a time
-- We do this by using the
CREATE TABLE `version_data` (
  `id` int unsigned NOT NULL DEFAULT 1,
  `timestamp` bigint unsigned NOT NULL,
  `version` varchar(11) NOT NULL,
  `network` varchar(8) NOT NULL,
  `min_weight` float unsigned NOT NULL,
  `min_tx_weight` float unsigned NOT NULL,
  `min_tx_weight_coefficient` float unsigned NOT NULL,
  `min_tx_weight_k` float unsigned NOT NULL,
  `token_deposit_percentage` float unsigned NOT NULL,
  `reward_spend_min_blocks` int unsigned NOT NULL,
  `max_number_inputs` int unsigned NOT NULL,
  `max_number_outputs` int unsigned NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `metadata` (
  `key` varchar(25) NOT NULL,
  `value` int unsigned NOT NULL,
  PRIMARY KEY (`key`)
);

CREATE TABLE `blocks` (
  `tx_id` VARCHAR(64) NOT NULL,
  `height` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`tx_id`)
);

CREATE TABLE `token` (
  `id` varchar(64) NOT NULL,
  `name` varchar(30) NOT NULL,
  `symbol` varchar(5) NOT NULL,
  PRIMARY KEY (`id`));

CREATE TABLE `tx_proposal` (
  `id` varchar(36) NOT NULL,
  `wallet_id` varchar(64) NOT NULL,
  `status` enum('open','sent','send_error','cancelled') NOT NULL,
  `created_at` int unsigned NOT NULL,
  `updated_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `tx_proposal_outputs` (
  `tx_proposal_id` varchar(36) NOT NULL,
  `index` tinyint unsigned NOT NULL,
  `address` varchar(34) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `value` bigint DEFAULT NULL,
  `timelock` int unsigned DEFAULT NULL,
  PRIMARY KEY (`tx_proposal_id`,`index`)
);

CREATE TABLE `tx_output` (
  `tx_id` varchar(64) NOT NULL, -- tx_id might point to a block
  `index` tinyint unsigned NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `address` varchar(34) NOT NULL,
  `value` bigint unsigned NOT NULL,
  `authorities` tinyint unsigned DEFAULT NULL,
  `timelock` int unsigned DEFAULT NULL,
  `heightlock` int unsigned DEFAULT NULL,
  `locked` tinyint unsigned NOT NULL DEFAULT '0',
  `tx_proposal` varchar(36) DEFAULT NULL,
  `tx_proposal_index` tinyint unsigned DEFAULT NULL,
  `spent_by` varchar(64) DEFAULT NULL,
  `dirty` tinyint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`tx_id`,`index`)
);

CREATE TABLE `wallet` (
  `id` varchar(64) NOT NULL,
  `xpubkey` varchar(120) NOT NULL,
  `status` enum('creating','ready','error') NOT NULL DEFAULT 'creating',
  `max_gap` smallint unsigned NOT NULL DEFAULT '20',
  `created_at` int unsigned NOT NULL,
  `ready_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
);

CREATE TABLE `wallet_balance` (
  `wallet_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `unlocked_balance` bigint unsigned NOT NULL,
  `locked_balance` bigint unsigned NOT NULL,
  `unlocked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `locked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `timelock_expires` int unsigned,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`wallet_id`,`token_id`)
);

CREATE TABLE `wallet_tx_history` (
  `wallet_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `tx_id` varchar(64) NOT NULL,
  `balance` bigint NOT NULL,
  `timestamp` int unsigned NOT NULL,
  `dirty` tinyint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`wallet_id`,`token_id`,`tx_id`)
);

CREATE TABLE `transaction` (
  `tx_id` varchar(64) NOT NULL,
  `timestamp` int unsigned NOT NULL,
  `version` tinyint unsigned NOT NULL,
  `voided` boolean NOT NULL DEFAULT false,
  `height` int unsigned DEFAULT NULL,
  PRIMARY KEY (`tx_id`)
);
```

# Genesis transactions

We need to add the genesis transactions to the database as the service expects to already have them.

## Mainnet
```
INSERT INTO `metadata` (`key`, `value`) VALUES ('height', 0);
INSERT INTO `blocks` (`tx_id`, `height`) VALUES ('000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc', 0);
INSERT INTO `utxo` (`tx_id`, `index`, `token_id`, `address`, `value`)
     VALUES ('000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
              0,
              '00',
              'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
              100000000000
              );
```

## Testnet

```
INSERT INTO `metadata` (`key`, `value`) VALUES ('height', 0);
INSERT INTO `blocks` (`tx_id`, `height`) VALUES ('0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85', 0);
INSERT INTO `utxo` (`tx_id`, `index`, `token_id`, `address`, `value`)
     VALUES ('0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85',
              0,
              '00',
              'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX',
              100000000000
              );
```
