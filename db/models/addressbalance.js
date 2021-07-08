'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class AddressBalance extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  AddressBalance.init({
    address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      primaryKey: true,
    },
    token_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
    },
    unlocked_balance: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    locked_balance: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    unlocked_authorities: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    locked_authorities: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    timelock_expires: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    transactions: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: 'AddressBalance',
    tableName: 'address_balance',
    timestamps: false,
  });
  return AddressBalance;
};
