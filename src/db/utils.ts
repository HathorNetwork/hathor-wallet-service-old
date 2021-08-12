import { ServerlessMysql } from 'serverless-mysql';

/**
 * Begins a transaction on the current connection
 *
 * @param mysql - Database connection
 */
export const beginTransaction = async (
  mysql: ServerlessMysql,
): Promise<void> => {
  await mysql.query('START TRANSACTION');
};

/**
 * Commits the transaction opened on the current connection
 *
 * @param mysql - Database connection
 */
export const commitTransaction = async (
  mysql: ServerlessMysql,
): Promise<void> => {
  await mysql.query('COMMIT');
};

/**
 * Rollback the transaction opened on the current connection
 *
 * @param mysql - Database connection
 */
export const rollbackTransaction = async (
  mysql: ServerlessMysql,
): Promise<void> => {
  await mysql.query('ROLLBACK');
};

export async function transactionDecorator(_mysql: ServerlessMysql, wrapped: Function): Promise<Function> {
  return async function wrapper(...args) {
    try {
      await beginTransaction(_mysql);
      await wrapped.apply(this, args);
      await commitTransaction(_mysql);
    } catch (e) {
      await rollbackTransaction(_mysql);

      // propagate the error
      throw e;
    }
  };
}
