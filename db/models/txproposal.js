'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class TxProposal extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  TxProposal.init({
    id: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true,
    },
    wallet_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(['open', 'sent', 'send_error', 'cancelled']),
      allowNull: false,
    },
    created_at: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
  }, {
    sequelize,
    modelName: 'TxProposal',
    tableName: 'tx_proposal',
    timestamps: false,
  });
  return TxProposal;
};
