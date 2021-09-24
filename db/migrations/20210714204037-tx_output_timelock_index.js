'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'tx_output',
      ['timelock'],
      {
        name: 'tx_output_timelock_idx',
        fields: 'timelock',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('tx_output', 'tx_output_timelock_idx');
  },
};
