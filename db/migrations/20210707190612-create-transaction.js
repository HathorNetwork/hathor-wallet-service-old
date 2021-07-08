'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('transaction', {
      tx_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: true,
      },
      timestamp: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
      version: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
      },
      voided: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      height: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
    }).then(() => queryInterface.addIndex(
      'transaction',
      ['version'],
      {
        name: 'transaction_version_idx',
        fields: ['version'],
        using: 'HASH',
      },
    ));
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('transaction');
  },
};
