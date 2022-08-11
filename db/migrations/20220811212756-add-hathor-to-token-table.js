'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('token', [{
      id: '00',
      name: 'Hathor',
      symbol: 'HTR',
      transactions: 0,
    }]);
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('token', [{
      id: '00',
      name: 'Hathor',
      symbol: 'HTR',
    }]);
  },
};
