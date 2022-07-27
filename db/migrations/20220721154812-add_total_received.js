'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addIndex(
      'address_tx_history',
      ['timestamp'],
      {
        name: 'address_tx_history_timestamp_idx',
        fields: 'timestamp',
      },
    );

    await queryInterface.addColumn('address_balance', 'total_received', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('address_tx_history', 'address_tx_history_timestamp_idx');
    await queryInterface.removeColumn('address_balance', 'total_received');
  },
};
