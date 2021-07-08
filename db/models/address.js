'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Address extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  Address.init({
    address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      primaryKey: true,
    },
    index: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    wallet_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: null,
    },
    transactions: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: 'Address',
    tableName: 'address',
    timestamps: false,
  });
  return Address;
};
