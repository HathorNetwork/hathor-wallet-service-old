'use strict';
const {
  Model
} = require('sequelize');

// XXX: Be aware that changes to this table could impact the data extraction performed by the query in https://github.com/HathorNetwork/ops-tools/tree/master/kubernetes/apps/logstash-pipeline/base/logstash-config/logstash-jdbc.conf

module.exports = (sequelize, DataTypes) => {
  class Token extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  Token.init({
    id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    symbol: {
      type: DataTypes.STRING(5),
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
    transactions: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: 'Token',
    tableName: 'token',
    underscored: true,
  });
  return Token;
};
