import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';

// Dates stay plain 'YYYY-MM-DD' strings (no timezone shift) and bigint/count columns become numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));

export interface Q {
  query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function wrap(c: Pick<PoolClient, 'query'>): Q {
  return {
    async query(sql, params) {
      const res = await c.query(sql, params as any[]);
      const rows = res.rows.map((r: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(r)) out[camel(k)] = r[k];
        return out;
      });
      return { rows: rows as any, rowCount: res.rowCount ?? 0 };
    },
  };
}

/** Thin wrapper over pg. Row keys come back camelCased. */
@Injectable()
export class DbService implements Q, OnModuleDestroy {
  readonly pool: Pool;
  private readonly q: Q;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });
    this.q = wrap(this.pool);
  }

  query<R = any>(sql: string, params?: unknown[]) {
    return this.q.query<R>(sql, params);
  }

  async tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
