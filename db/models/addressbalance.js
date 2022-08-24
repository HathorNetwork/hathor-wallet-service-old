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

  // Unlocked authorities represents:
  // null or 0b00 - Has no authority
  // 0b01 - Mint authority
  // 0b11 - Mint and Melt authority
  // 0b10 - Melt authority

  // This is always up to date with the authorities in every
  // UTXO for this address.

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
    created_at: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: DataTypes.literal('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: DataTypes.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
    },
  }, {
    sequelize,
    modelName: 'AddressBalance',
    tableName: 'address_balance',
    timestamps: false,
    indexes: [{
      name: 'address_balance_updated_at_idx',
      fields: ['updated_at'],
    }],
  });
  return AddressBalance;
};
