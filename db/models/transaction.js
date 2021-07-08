'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Transaction extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  Transaction.init({
    tx_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
    },
    timestamp: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    version: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
    },
    voided: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    height: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
  }, {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transaction',
    timestamps: false,
    indexes: [
      {
        name: 'transaction_version_idx',
        fields: ['version'],
        using: 'HASH',
      },
    ],
  });
  return Transaction;
};
