'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('transaction', 'weight', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('transaction', 'weight');
  }
};
