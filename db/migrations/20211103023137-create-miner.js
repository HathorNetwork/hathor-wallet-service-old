'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('miner', {
      address: {
        type: Sequelize.STRING(34),
        allowNull: false,
        primaryKey: true,
      },
      first_block: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: false,
      },
      last_block: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: false,
      },
      count: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: false,
      },
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('miner');
  },
};
