'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.addIndex(
      'tx_output',
      ['locked'], {
        name: 'tx_output_locked_idx',
        fields: 'locked',
      },
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('tx_output', 'tx_output_locked_idx');
  },
};
