'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'tx_output',
      ['address'],
      {
        name: 'tx_output_address_idx',
        fields: 'address',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('tx_output', 'tx_output_address_idx');
  },
};
