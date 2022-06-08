'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn('transaction', 'created_at', {
        type: 'TIMESTAMP',
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      }, { transaction });

      await queryInterface.addColumn('transaction', 'updated_at', {
        type: 'TIMESTAMP',
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      }, { transaction });

      await queryInterface.addIndex(
        'transaction',
        ['updated_at'],
        {
          name: 'transaction_updated_at_idx',
          fields: 'updated_at',
          transaction,
        }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeColumn('transaction', 'created_at', { transaction });
      await queryInterface.removeColumn('transaction', 'updated_at', { transaction });
      await queryInterface.removeIndex('transaction', 'transaction_updated_at_idx', { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
};
