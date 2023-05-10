'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.addIndex(
      'tx_output',
      ['voided'], {
        name: 'tx_output_voided_idx',
        fields: 'voided',
      },
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('tx_output', 'tx_output_voided_idx');
  },
};
