'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('token', 'created_at', {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    });

    await queryInterface.addColumn('token', 'updated_at', {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
    })
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('token', 'created_at');
    await queryInterface.removeColumn('token', 'updated_at');
  }
};
