'use strict';

module.exports = {
  up: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addIndex(
        'tx_output',
        ['spent_by'],
        {
          name: 'tx_output_spent_by_idx',
          fields: 'spent_by',
        }, {
          transaction,
        },
      );

      await queryInterface.addIndex(
        'tx_output',
        ['voided'],
        {
          name: 'tx_output_voided_idx',
          fields: 'voided',
        }, {
          transaction,
        },
      );

      await queryInterface.addIndex(
        'tx_output',
        ['locked'],
        {
          name: 'tx_output_locked_idx',
          fields: 'locked',
        }, {
          transaction,
        },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('tx_output', 'tx_output_spent_by_idx');
    await queryInterface.removeIndex('tx_output', 'tx_output_voided_idx');
    await queryInterface.removeIndex('tx_output', 'tx_output_locked_idx');
  },
};
