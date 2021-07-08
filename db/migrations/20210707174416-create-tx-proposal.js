'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tx_proposal', {
      id: {
        type: Sequelize.STRING(36),
        allowNull: false,
        primaryKey: true,
      },
      wallet_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(['open', 'sent', 'send_error', 'cancelled']),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('tx_proposal');
  },
};
