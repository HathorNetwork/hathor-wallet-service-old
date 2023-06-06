'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.addIndex(
      'address',
      ['index'], {
        name: 'address_index_idx',
        fields: 'index',
      },
    );
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('address', 'address_index_idx');
  },
};
