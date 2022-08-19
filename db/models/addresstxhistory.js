'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class AddressTxHistory extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  AddressTxHistory.init({
    address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      primaryKey: true,
    },
    tx_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
    },
    token_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
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
    modelName: 'AddressTxHistory',
    tableName: 'address_tx_history',
    timestamps: false,
    indexes: [{
      name: 'address_tx_history_txid_idx',
      fields: ['tx_id'],
    }, {
      name: 'address_tx_history_tokenid_idx',
      fields: ['token_id'],
    }, {
      name: 'address_tx_history_timestamp_idx',
      fields: ['timestamp'],
    }, {
      name: 'address_tx_history_voided_idx',
      fields: ['voided'],
    }],
  });
  return AddressTxHistory;
};
