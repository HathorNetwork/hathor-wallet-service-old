'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PushDevices extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  PushDevices.init(
    {
      device_id: {
        type: DataTypes.STRING(256),
        allowNull: false,
        primaryKey: true,
      },
      push_provider: {
        type: DataTypes.ENUM(['ios', 'android']),
        allowNull: false,
      },
      wallet_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        references: {
          model: 'wallet',
          key: 'id',
        },
      },
      enable_push: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      enable_show_amounts: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      updated_at: {
        type: 'TIMESTAMP',
        allowNull: false,
        defaultValue: DataTypes.literal(
          'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        ),
      },
    },
    {
      sequelize,
      modelName: 'PushDevices',
      tableName: 'push_devices',
      timestamps: false,
    },
  );
  return PushDevices;
};
