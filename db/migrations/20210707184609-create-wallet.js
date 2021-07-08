'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('wallet', {
      id: {
        type: Sequelize.STRING(64),
        primaryKey: true,
        allowNull: false,
      },
      xpubkey: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(['creating', 'ready', 'error']),
        allowNull: false,
        defaultValue: 'creating',
      },
      max_gap: {
        type: Sequelize.SMALLINT.UNSIGNED,
        allowNull: false,
        defaultValue: 20,
      },
      created_at: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
      ready_at: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('wallet');
  }
};
