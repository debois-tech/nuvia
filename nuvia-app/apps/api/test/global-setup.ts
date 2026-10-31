import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgres://nuvia:nuvia_dev@127.0.0.1:5432/nuvia_test';

/** Recreates a throwaway database so tests never touch development data. */
export default async function globalSetup() {
  const url = new URL(TEST_DB_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(dbName)) throw new Error(`Refusing to reset database "${dbName}": name must contain "test"`);
  url.pathname = '/postgres';
  const admin = new Pool({ connectionString: url.toString() });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
  process.env.TEST_DATABASE_URL = TEST_DB_URL;
}
