'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class WalletTxHistory extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  WalletTxHistory.init({
    wallet_id: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      allowNull: false,
    },
    token_id: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      allowNull: false,
    },
    tx_id: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      allowNull: false,
    },
    balance: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    voided: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    sequelize,
    modelName: 'WalletTxHistory',
    tableName: 'wallet_tx_history',
    timestamps: false,
  });
  return WalletTxHistory;
};
