'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('wallet', 'auth_xpubkey', {
      type: Sequelize.STRING(120),
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('wallet', 'auth_xpubkey')
  }
};
