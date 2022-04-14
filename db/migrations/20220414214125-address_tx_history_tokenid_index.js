'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'address_tx_history',
      ['token_id'],
      {
        name: 'address_tx_history_tokenid_idx',
        fields: 'token_id',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('address_tx_history', 'address_tx_history_tokenid_idx');
  },
};
