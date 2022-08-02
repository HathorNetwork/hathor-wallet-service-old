'use strict';
const {
  Model
} = require('sequelize');

// XXX: Be aware that changes to this table could impact the data extraction performed by the query in https://github.com/HathorNetwork/ops-tools/tree/master/kubernetes/apps/logstash-pipeline/base/logstash-config/logstash-jdbc.conf

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
    // Height is the block's height if it's a block and the height of the `first_block` if it is a transaction.
    height: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    // We will support null only for the first data migration. The current entries do not have this value and manual insertion will be needed.
    // Once we backfill the old data, we must stop accepting null for weight
    weight: {
      type: DataTypes.FLOAT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    created_at: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
    },
  }, {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transaction',
    timestamps: false,
    underscored: true,
    indexes: [{
      name: 'transaction_version_idx',
      fields: ['version'],
      using: 'HASH',
    }, {
      name: 'transaction_height_idx',
      fields: ['height'],
    }, {
      name: 'transaction_updated_at_idx',
      fields: ['updated_at'],
    }],
  });
  return Transaction;
};
