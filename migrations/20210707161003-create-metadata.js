'use strict'; // eslint-disable-line
module.exports = {
  up: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.createTable('metadata', {
      key: {
        type: Sequelize.STRING(64),
        primaryKey: true,
        allowNull: false,
      },
      value: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
    });
  },
  down: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.dropTable('metadata');
  },
};
