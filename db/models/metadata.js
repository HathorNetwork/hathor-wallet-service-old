'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Metadata extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  Metadata.init({
    key: {
      type: DataTypes.STRING(25),
      allowNull: false,
      primaryKey: true,
    },
    value: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: 'Metadata',
    tableName: 'metadata',
    timestamps: false,
  });
  return Metadata;
};
