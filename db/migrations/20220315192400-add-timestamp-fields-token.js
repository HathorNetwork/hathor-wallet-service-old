'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {

    await queryInterface.addColumn('token', 'insertion_time', {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    });

    await queryInterface.addColumn('token', 'modification_time', {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
    })
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('token', 'insertion_time');
    await queryInterface.removeColumn('token', 'modification_time');
  }
};
