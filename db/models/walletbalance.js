'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class WalletBalance extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  WalletBalance.init({
    wallet_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
    },
    token_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
    },
    total_received: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
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
    modelName: 'WalletBalance',
    tableName: 'wallet_balance',
    timestamps: false,
  });
  return WalletBalance;
};
