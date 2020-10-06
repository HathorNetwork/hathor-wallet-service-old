-- MySQL dump 10.13  Distrib 5.7.21, for osx10.12 (x86_64)
--
-- Host: localhost    Database: wallet_service
-- ------------------------------------------------------
-- Server version	8.0.20

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `address`
--

DROP TABLE IF EXISTS `address`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `address` (
  `address` varchar(34) NOT NULL,
  `index` int unsigned DEFAULT NULL,
  `wallet_id` varchar(64) DEFAULT NULL,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `address`
--

LOCK TABLES `address` WRITE;
/*!40000 ALTER TABLE `address` DISABLE KEYS */;
/*!40000 ALTER TABLE `address` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `address_balance`
--

DROP TABLE IF EXISTS `address_balance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `address_balance` (
  `address` varchar(34) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `unlocked_balance` bigint unsigned NOT NULL,
  `locked_balance` bigint unsigned NOT NULL,
  `unlocked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `locked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `timelock_expires` int unsigned DEFAULT NULL,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`address`,`token_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `address_balance`
--

LOCK TABLES `address_balance` WRITE;
/*!40000 ALTER TABLE `address_balance` DISABLE KEYS */;
/*!40000 ALTER TABLE `address_balance` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `address_tx_history`
--

DROP TABLE IF EXISTS `address_tx_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `address_tx_history` (
  `address` varchar(34) NOT NULL,
  `tx_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `balance` bigint NOT NULL,
  `timestamp` int unsigned NOT NULL,
  PRIMARY KEY (`address`,`tx_id`,`token_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `address_tx_history`
--

LOCK TABLES `address_tx_history` WRITE;
/*!40000 ALTER TABLE `address_tx_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `address_tx_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `info`
--

DROP TABLE IF EXISTS `info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `info` (
  `key` varchar(25) NOT NULL,
  `value` int unsigned NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `info`
--

LOCK TABLES `info` WRITE;
/*!40000 ALTER TABLE `info` DISABLE KEYS */;
/*!40000 ALTER TABLE `info` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `token`
--

DROP TABLE IF EXISTS `token`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `token` (
  `id` varchar(64) NOT NULL,
  `name` varchar(150) NOT NULL,
  `symbol` varchar(30) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `token`
--

LOCK TABLES `token` WRITE;
/*!40000 ALTER TABLE `token` DISABLE KEYS */;
/*!40000 ALTER TABLE `token` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tx_proposal`
--

DROP TABLE IF EXISTS `tx_proposal`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tx_proposal` (
  `id` varchar(36) NOT NULL,
  `wallet_id` varchar(64) NOT NULL,
  `status` enum('open','sent','send_error','cancelled') NOT NULL,
  `created_at` int unsigned NOT NULL,
  `updated_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tx_proposal`
--

LOCK TABLES `tx_proposal` WRITE;
/*!40000 ALTER TABLE `tx_proposal` DISABLE KEYS */;
/*!40000 ALTER TABLE `tx_proposal` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tx_proposal_outputs`
--

DROP TABLE IF EXISTS `tx_proposal_outputs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tx_proposal_outputs` (
  `tx_proposal_id` varchar(36) NOT NULL,
  `index` tinyint unsigned NOT NULL,
  `address` varchar(34) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `value` bigint DEFAULT NULL,
  `timelock` int unsigned DEFAULT NULL,
  PRIMARY KEY (`tx_proposal_id`,`index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tx_proposal_outputs`
--

LOCK TABLES `tx_proposal_outputs` WRITE;
/*!40000 ALTER TABLE `tx_proposal_outputs` DISABLE KEYS */;
/*!40000 ALTER TABLE `tx_proposal_outputs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `utxo`
--

DROP TABLE IF EXISTS `utxo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `utxo` (
  `tx_id` varchar(64) NOT NULL,
  `index` tinyint unsigned NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `address` varchar(34) NOT NULL,
  `value` bigint unsigned NOT NULL,
  `authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `timelock` int unsigned DEFAULT NULL,
  `heightlock` int unsigned DEFAULT NULL,
  `locked` tinyint(1) NOT NULL,
  `tx_proposal` varchar(36) DEFAULT NULL,
  `tx_proposal_index` tinyint unsigned DEFAULT NULL,
  PRIMARY KEY (`tx_id`,`index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `utxo`
--

LOCK TABLES `utxo` WRITE;
/*!40000 ALTER TABLE `utxo` DISABLE KEYS */;
/*!40000 ALTER TABLE `utxo` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `wallet`
--

DROP TABLE IF EXISTS `wallet`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `wallet` (
  `id` varchar(64) NOT NULL,
  `xpubkey` varchar(120) NOT NULL,
  `status` enum('creating','ready','error') NOT NULL DEFAULT 'creating',
  `max_gap` smallint unsigned NOT NULL DEFAULT '20',
  `created_at` int unsigned NOT NULL,
  `ready_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wallet`
--

LOCK TABLES `wallet` WRITE;
/*!40000 ALTER TABLE `wallet` DISABLE KEYS */;
/*!40000 ALTER TABLE `wallet` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `wallet_balance`
--

DROP TABLE IF EXISTS `wallet_balance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `wallet_balance` (
  `wallet_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `unlocked_balance` bigint unsigned NOT NULL,
  `locked_balance` bigint unsigned NOT NULL,
  `unlocked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `locked_authorities` tinyint unsigned NOT NULL DEFAULT '0',
  `timelock_expires` int unsigned DEFAULT NULL,
  `transactions` int unsigned NOT NULL,
  PRIMARY KEY (`wallet_id`,`token_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wallet_balance`
--

LOCK TABLES `wallet_balance` WRITE;
/*!40000 ALTER TABLE `wallet_balance` DISABLE KEYS */;
/*!40000 ALTER TABLE `wallet_balance` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `wallet_tx_history`
--

DROP TABLE IF EXISTS `wallet_tx_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `wallet_tx_history` (
  `wallet_id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `tx_id` varchar(64) NOT NULL,
  `balance` bigint NOT NULL,
  `timestamp` int unsigned NOT NULL,
  PRIMARY KEY (`wallet_id`,`token_id`,`tx_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wallet_tx_history`
--

LOCK TABLES `wallet_tx_history` WRITE;
/*!40000 ALTER TABLE `wallet_tx_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `wallet_tx_history` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2020-09-08 14:40:25
