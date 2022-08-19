'use strict';

module.exports = {
  up: async (queryInterface) => queryInterface.addIndex(
    'address_tx_history',
    ['voided'], {
      name: 'address_tx_history_voided_idx',
      fields: 'voided',
    },
  ),
  down: async (queryInterface) => queryInterface.removeIndex(
    'address_tx_history',
    'address_tx_history_voided_idx',
  ),
};
