'use strict'; // eslint-disable-line
module.exports = {
  up: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.createTable('address_tx_history', {
      address: {
        type: Sequelize.STRING(34),
        allowNull: false,
        primaryKey: true,
      },
      tx_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: true,
      },
      token_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: true,
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
  down: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.dropTable('address_tx_history');
  },
};
