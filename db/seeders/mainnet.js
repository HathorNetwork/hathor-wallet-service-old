'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction((t) => {
      return Promise.all([
        queryInterface.bulkInsert('transaction', [{
          tx_id: '0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85',
          height: 0,
          timestamp: 1577836800,
          version: 0,
          voided: false,
        }], { transaction: t }),
        queryInterface.bulkInsert('tx_output', [{
          tx_id: '0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85',
          index: 0,
          token_id: '00',
          address: 'WdmDUMp8KvzhWB7KLgguA2wBiKsh4Ha8eX',
          value: 100000000000,
        }], { transaction: t }),
      ]);
    });
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction((t) => {
      return Promise.all([
        queryInterface.bulkDelete('transaction', {
          tx_id: '0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85',
        }, { transaction: t }),
        queryInterface.bulkDelete('tx_output', {
          tx_id: '0000033139d08176d1051fb3a272c3610457f0c7f686afbe0afe3d37f966db85',
          index: 0,
        }, { transaction: t }),
      ]);
    });
  },
};
