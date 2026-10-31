import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';

/**
 * Re-computes the audit hash chain of the database in DATABASE_URL and exits non-zero if it is broken.
 * Used by the backup restore test, and handy before an audit review.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await new AuditService(pool as any).verifyChain();
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(2);
});
