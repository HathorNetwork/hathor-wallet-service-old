'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Miner extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  Miner.init({
    address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      primaryKey: true,
    },
  }, {
    sequelize,
    modelName: 'Miner',
    tableName: 'miner',
    timestamps: false,
  });
  return Transaction;
};
