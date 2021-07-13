'use strict'; // eslint-disable-line
module.exports = {
  up: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.createTable('address_balance', {
      address: {
        type: Sequelize.STRING(34),
        allowNull: false,
        primaryKey: true,
      },
      token_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: true,
      },
      unlocked_balance: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
      },
      locked_balance: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
      },
      unlocked_authorities: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      locked_authorities: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      timelock_expires: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      transactions: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
    });
  },
  down: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.dropTable('address_balance');
  },
};
