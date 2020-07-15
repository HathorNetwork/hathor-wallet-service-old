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

CREATE TABLE `address_balance` (
  `address` varchar(34) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `unlocked_balance` bigint unsigned NOT NULL,
  `locked_balance` bigint unsigned NOT NULL,
  `timelock_expires` int unsigned NOT NULL,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`address`,`token_id`)
);

CREATE TABLE `address_tx_history` (
  `address` varchar(34) NOT NULL,
  `tx_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `balance` bigint NOT NULL,
  `timestamp` int unsigned NOT NULL,
  PRIMARY KEY (`address`,`tx_id`,`token_id`)
);

CREATE TABLE `info` (
  `key` varchar(25) NOT NULL,
  `value` int unsigned NOT NULL,
  PRIMARY KEY (`key`)
);

CREATE TABLE `utxo` (
  `tx_id` varchar(64) NOT NULL,
  `index` tinyint unsigned NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `address` varchar(34) NOT NULL,
  `value` bigint unsigned NOT NULL,
  `timelock` int unsigned DEFAULT NULL,
  `heightlock` int unsigned DEFAULT NULL,
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
  `timelock_expires` int unsigned NOT NULL,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`wallet_id`,`token_id`)
);

CREATE TABLE `wallet_tx_history` (
  `wallet_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `tx_id` varchar(64) NOT NULL,
  `balance` bigint NOT NULL,
  `timestamp` int unsigned NOT NULL,
  PRIMARY KEY (`wallet_id`,`token_id`,`tx_id`)
);
```
