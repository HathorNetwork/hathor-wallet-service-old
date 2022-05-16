import { createLogger, format, transports, Logger } from 'winston';

const createDefaultLogger = (): Logger => createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.json(),
  transports: [
    new transports.Console(),
  ],
});

export default createDefaultLogger;
