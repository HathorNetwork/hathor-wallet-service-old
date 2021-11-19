'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'address_tx_history',
      ['tx_id'],
      {
        name: 'address_tx_history_txid_idx',
        fields: 'tx_id',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('address_tx_history', 'address_tx_history_txid_idx');
  },
};
