'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tx_output', {
      tx_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        primaryKey: true,
      },
      index: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
      },
      token_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      address: {
        type: Sequelize.STRING(34),
        allowNull: false,
      },
      value: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
      },
      authorities: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
      timelock: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
      heightlock: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
      locked: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      tx_proposal: {
        type: Sequelize.STRING(36),
        allowNull: true,
        defaultValue: null,
      },
      tx_proposal_index: {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
      spent_by: {
        type: Sequelize.STRING(64),
        allowNull: true,
        defaultValue: null,
      },
      voided: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('tx_output');
  }
};
