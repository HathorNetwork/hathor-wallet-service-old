'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'tx_output',
      ['token_id'],
      {
        name: 'tx_output_token_id_idx',
        fields: 'token_id',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('tx_output', 'tx_output_token_id_idx');
  },
};
