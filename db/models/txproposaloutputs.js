'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class TxProposalOutputs extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  TxProposalOutputs.init({
    tx_proposal_id: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      allowNull: false,
    },
    index: {
      type: DataTypes.TINYINT.UNSIGNED,
      primaryKey: true,
      allowNull: false,
    },
    address: {
      type: DataTypes.STRING(34),
      allowNull: false,
    },
    token_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    value: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: null,
    },
    timelock: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
  }, {
    sequelize,
    modelName: 'TxProposalOutputs',
    tableName: 'tx_proposal_outputs',
    timestamps: false,
  });
  return TxProposalOutputs;
};
