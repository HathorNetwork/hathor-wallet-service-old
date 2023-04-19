'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class TxOutput extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  TxOutput.init({
    // tx_id might point to a block
    tx_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
    },
    index: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
    },
    token_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    address: {
      type: DataTypes.STRING(34),
      allowNull: false,
    },
    value: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    authorities: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    timelock: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    heightlock: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    locked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    tx_proposal: {
      type: DataTypes.STRING(36),
      allowNull: true,
      defaultValue: null,
    },
    tx_proposal_index: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    spent_by: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: null,
    },
    voided: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    sequelize,
    modelName: 'TxOutput',
    tableName: 'tx_output',
    timestamps: false,
    indexes: [{
      name: 'tx_output_token_id_idx',
      fields: ['token_id'],
    }, {
      name: 'tx_output_address_idx',
      fields: ['address'],
    }, {
      name: 'tx_output_heightlock_idx',
      fields: 'heightlock',
    }, {
      name: 'tx_output_timelock_idx',
      fields: 'timelock',
    }, {
      name: 'tx_output_txproposal_idx',
      fields: 'tx_proposal',
    }, {
      name: 'tx_output_spent_by_idx',
      fields: 'spent_by',
    }, {
      name: 'tx_output_voided_idx',
      fields: 'voided',
    }, {
      name: 'tx_output_locked_idx',
      fields: 'locked',
    }],
  });
  return TxOutput;
};
