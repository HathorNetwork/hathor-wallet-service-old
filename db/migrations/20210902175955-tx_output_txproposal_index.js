'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'tx_output',
      ['tx_proposal'],
      {
        name: 'tx_output_txproposal_idx',
        fields: 'tx_proposal',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('tx_output', 'tx_output_txproposal_idx');
  },
};
