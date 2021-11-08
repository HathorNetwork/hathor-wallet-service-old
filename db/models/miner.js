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
    first_block: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: false,
    },
    last_block: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: false,
    },
    count: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: false,
    },
  }, {
    sequelize,
    modelName: 'Miner',
    tableName: 'miner',
    timestamps: false,
  });
  return Transaction;
};
