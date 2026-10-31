import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { seedDemoUsers } from './seed';

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo users in production');
  const password = process.env.SEED_PASSWORD || 'nuvia-dev-password';
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  try {
    const n = await seedDemoUsers(pool, password);
    console.log(`${n} demo user(s) created. Org IDs: EXEC-1 HR-1 LEAD-1 EMP-1 (office) EMP-2 EMP-3 (remote). Password: ${password}`);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
