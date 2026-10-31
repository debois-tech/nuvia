import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { runMigrations } from './migrate';

(async () => {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  try {
    const applied = await runMigrations(pool, console.log);
    console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
