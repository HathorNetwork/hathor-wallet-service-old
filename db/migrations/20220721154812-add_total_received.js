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

    await queryInterface.addIndex(
      'address_balance',
      ['updated_at'],
      {
        name: 'address_balance_updated_at_idx',
        fields: 'updated_at',
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
    await queryInterface.removeIndex('address_balance', 'address_balance_updated_at_idx');
    await queryInterface.removeColumn('address_balance', 'total_received');
  },
};
