'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    queryInterface.removeColumn('push_devices', 'enable_only_new_tx');
  },

  async down(queryInterface, Sequelize) {
    queryInterface.addColumn('push_devices', 'enable_only_new_tx', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },
};
