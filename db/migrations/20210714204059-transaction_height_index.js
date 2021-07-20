'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addIndex(
      'transaction',
      ['height'],
      {
        name: 'transaction_height_idx',
        fields: 'height',
      }
    )
  },
  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('transaction', 'transaction_height_idx');
  },
};
