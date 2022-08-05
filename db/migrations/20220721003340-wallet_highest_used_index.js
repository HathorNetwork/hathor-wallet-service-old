'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.addColumn('wallet', 'last_used_address_index', {
      type: 'INTEGER',
      allowNull: false,
      defaultValue: -1,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('wallet', 'last_used_address_index');
  },
};
