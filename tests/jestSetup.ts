/* eslint-disable @typescript-eslint/no-empty-function */
import { config } from 'dotenv';

Object.defineProperty(global, '_bitcore', { get() { return undefined; }, set() {} });

config();
