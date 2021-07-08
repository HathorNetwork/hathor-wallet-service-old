'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('wallet_tx_history', {
      wallet_id: {
        type: Sequelize.STRING(64),
        primaryKey: true,
        allowNull: false,
      },
      token_id: {
        type: Sequelize.STRING(64),
        primaryKey: true,
        allowNull: false,
      },
      tx_id: {
        type: Sequelize.STRING(64),
        primaryKey: true,
        allowNull: false,
      },
      balance: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      timestamp: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
      voided: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('wallet_tx_history');
  }
};
