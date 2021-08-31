require('dotenv').config()

const fs = require('fs');

let development;

switch (process.env.DEV_DB) {
  case 'mysql':
    development = {
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      host: '127.0.0.1',
      port: process.env.DB_PORT || 3306,
      dialect: 'mysql',
      dialectOptions: {
        bigNumberStrings: true,
      },
    };
    break;
  default:
    development = {
      storage: process.env.DB_FILE || './db.sqlite3',
      dialect: 'sqlite',
    };
    break;
}

module.exports = {
  development,
  test: {
    username: process.env.CI_DB_USERNAME,
    password: process.env.CI_DB_PASSWORD,
    database: process.env.CI_DB_NAME,
    host: process.env.CI_DB_HOST || '127.0.0.1',
    port: process.env.CI_DB_PORT || 3306,
    dialect: 'mysql',
    dialectOptions: {
      bigNumberStrings: true,
    },
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_ENDPOINT,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectOptions: {
      bigNumberStrings: true,
    },
  },
};
