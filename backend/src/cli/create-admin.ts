import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { DbService } from '../db/db.service';
import { ORG_ID_PATTERN } from '../users/users.dto';

/**
 * Creates the first HR/admin account (there is no public signup, so someone has to be first).
 *   node dist/cli/create-admin.js --org-id NV-0001 --name "Asha Rao" --email asha@example.com
 * Refuses to run once any account exists, unless --force is given.
 */
async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const orgId = get('--org-id');
  const name = get('--name');
  const email = get('--email');
  if (!orgId || !name || !email || !ORG_ID_PATTERN.test(orgId)) {
    console.error('Usage: create-admin --org-id <3-32 chars> --name "<full name>" --email <address> [--force]');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const db = app.get(DbService);
    const count = (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    if (count > 0 && !args.includes('--force')) {
      console.error('Accounts already exist. Create more from the admin screen, or pass --force.');
      process.exit(1);
    }
    const { user, temporaryPassword } = await app.get(UsersService).create(
      { orgId, name, email, role: 'hr_admin' },
      null,
      { ip: null, userAgent: 'cli:create-admin' },
    );
    console.log(`Created HR/admin ${user.orgId}.`);
    console.log(`Temporary password (shown once, must be changed at first sign-in): ${temporaryPassword}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
