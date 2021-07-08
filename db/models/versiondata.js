'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class VersionData extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  VersionData.init({
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      defaultValue: 1,
    },
    timestamp: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    version: {
      type: DataTypes.STRING(11),
      allowNull: false,
    },
    network: {
      type: DataTypes.STRING(8),
      allowNull: false,
    },
    min_weight: {
      type: DataTypes.FLOAT.UNSIGNED,
      allowNull: false,
    },
    min_tx_weight: {
      type: DataTypes.FLOAT.UNSIGNED,
      allowNull: false,
    },
    min_tx_weight_coefficient: {
      type: DataTypes.FLOAT.UNSIGNED,
      allowNull: false,
    },
    min_tx_weight_k: {
      type: DataTypes.FLOAT.UNSIGNED,
      allowNull: false,
    },
    token_deposit_percentage: {
      type: DataTypes.FLOAT.UNSIGNED,
      allowNull: false,
    },
    reward_spend_min_blocks: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    max_number_inputs: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    max_number_outputs: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: 'VersionData',
    tableName: 'version_data',
    timestamps: false,
  });
  return VersionData;
};
