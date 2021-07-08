'use strict'; // eslint-disable-line
module.exports = {
  up: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.createTable('version_data', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        defaultValue: 1,
      },
      timestamp: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
      },
      version: {
        type: Sequelize.STRING(11),
        allowNull: false,
      },
      network: {
        type: Sequelize.STRING(8),
        allowNull: false,
      },
      min_weight: {
        type: Sequelize.FLOAT.UNSIGNED,
        allowNull: false,
      },
      min_tx_weight: {
        type: Sequelize.FLOAT.UNSIGNED,
        allowNull: false,
      },
      min_tx_weight_coefficient: {
        type: Sequelize.FLOAT.UNSIGNED,
        allowNull: false,
      },
      min_tx_weight_k: {
        type: Sequelize.FLOAT.UNSIGNED,
        allowNull: false,
      },
      token_deposit_percentage: {
        type: Sequelize.FLOAT.UNSIGNED,
        allowNull: false,
      },
      reward_spend_min_blocks: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
      max_number_inputs: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
      max_number_outputs: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
    });
  },
  down: async (queryInterface, Sequelize) => { // eslint-disable-line
    await queryInterface.dropTable('version_data');
  },
};
