'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Wallet extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  Wallet.init({
    id: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      allowNull: false,
    },
    xpubkey: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    auth_xpubkey: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(['creating', 'ready', 'error']),
      allowNull: false,
      defaultValue: 'creating',
    },
    retry_count: {
      type: DataTypes.SMALLINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    max_gap: {
      type: DataTypes.SMALLINT.UNSIGNED,
      allowNull: false,
      defaultValue: 20,
    },
    created_at: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    ready_at: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
  }, {
    sequelize,
    modelName: 'Wallet',
    tableName: 'wallet',
    timestamps: false,
  });
  return Wallet;
};
