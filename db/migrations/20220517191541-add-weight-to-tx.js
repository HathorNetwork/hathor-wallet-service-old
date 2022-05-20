'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('transaction', 'weight', {
      type: Sequelize.FLOAT.UNSIGNED,
      // We will temporarily support null values for weight until the first data migration is done.
      // After that, we must remove support for null values on weight column.
      allowNull: true,
      defaultValue: null,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('transaction', 'weight');
  }
};
