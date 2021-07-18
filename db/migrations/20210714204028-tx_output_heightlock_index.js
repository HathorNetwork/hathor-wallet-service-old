'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'tx_output',
      ['heightlock'],
      {
        name: 'tx_output_heightlock_idx',
        fields: 'heightlock',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('tx_output', 'tx_output_heightlock_idx');
  },
};
