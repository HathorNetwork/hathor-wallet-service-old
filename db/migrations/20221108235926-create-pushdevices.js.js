'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('push_devices', {
      device_id: {
        type: Sequelize.STRING(256),
        allowNull: false,
        primaryKey: true,
      },
      push_provider: {
        type: Sequelize.ENUM(['ios', 'android']),
        allowNull: false,
      },
      wallet_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        references: {
          model: 'wallet',
          key: 'id',
        },
      },
      enable_push: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      enable_show_amounts: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      enable_only_new_tx: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      updated_at: {
        type: 'TIMESTAMP',
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('push_devices');
  },
};
