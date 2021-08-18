'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction((t) => {
      return Promise.all([
        queryInterface.bulkInsert('transaction', [{
          tx_id: '000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
          height: 0,
          timestamp: 1578075305,
          version: 0,
          voided: false,
        }], { transaction: t }),
        queryInterface.bulkInsert('tx_output', [{
          tx_id: '000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
          index: 0,
          token_id: '00',
          address: 'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
          value: 100000000000,
        }], { transaction: t }),
        queryInterface.bulkInsert('address', [{
          address: 'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
          transactions: 1,
        }], { transaction: t }),
        queryInterface.bulkInsert('address_balance', [{
          address: 'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
          token_id: '00',
          unlocked_balance: 100000000000,
          locked_balance: 0,
          unlocked_authorities: 0,
          locked_authorities: 0,
          timelock_expires: 0,
          transactions: 1,
        }], { transaction: t }),
        queryInterface.bulkInsert('address_tx_history', [{
          address: 'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
          tx_id: '000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
          token_id: '00',
          balance: 100000000000,
          timestamp: 1578075305,
          voided: false,
        }], { transaction: t }),
      ]);
    });
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction((t) => {
      return Promise.all([
        queryInterface.bulkDelete('transaction', {
          tx_id: '000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
        }, { transaction: t }),
        queryInterface.bulkDelete('tx_output', {
          tx_id: '000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
          index: 0,
        }, { transaction: t }),
        queryInterface.bulkDelete('address', {
          address: 'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
        }, { transaction: t }),
        queryInterface.bulkDelete('address_balance', {
          address: 'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
          token: '00',
        }, { transaction: t }),
        queryInterface.bulkDelete('address_tx_history', {
          address: 'HJB2yxxsHtudGGy3jmVeadwMfRi2zNCKKD',
          tx_id: '000006cb93385b8b87a545a1cbb6197e6caff600c12cc12fc54250d39c8088fc',
          token: '00',
        }, { transaction: t }),
      ]);
    });
  },
};
