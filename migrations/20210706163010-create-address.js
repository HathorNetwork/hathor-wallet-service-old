'use strict'; // eslint-disable-line
module.exports = {
  up: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.createTable('address', {
      address: {
        primaryKey: true,
        allowNull: false,
        type: Sequelize.STRING(34),
      },
      index: {
        allowNull: true,
        defaultValue: null,
        type: Sequelize.INTEGER.UNSIGNED,
      },
      wallet_id: {
        allowNull: true,
        defaultValue: null,
        type: Sequelize.STRING(64),
      },
      transactions: {
        allowNull: false,
        type: Sequelize.INTEGER.UNSIGNED,
      },
    });
  },
  down: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.dropTable('address');
  },
};
