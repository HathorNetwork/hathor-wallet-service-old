'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.addIndex(
      'tx_output',
      ['spent_by'], {
        name: 'tx_output_spent_by_idx',
        fields: 'spent_by',
      },
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('tx_output', 'tx_output_spent_by_idx');
  },
};
