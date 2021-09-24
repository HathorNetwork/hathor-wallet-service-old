'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('tx_proposal_outputs');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tx_proposal_outputs', {
      tx_proposal_id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false,
      },
      index: {
        type: Sequelize.TINYINT.UNSIGNED,
        primaryKey: true,
        allowNull: false,
      },
      address: {
        type: Sequelize.STRING(34),
        allowNull: false,
      },
      token_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      value: {
        type: Sequelize.BIGINT,
        allowNull: true,
        defaultValue: null,
      },
      timelock: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
    });
  }
};
