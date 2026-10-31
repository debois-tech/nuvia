import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Queryable, DbService } from '../db/db.service';
import { stableStringify } from './stable-json';

export const GENESIS_HASH = '0'.repeat(64);

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEvent {
  action: string;
  outcome?: AuditOutcome;
  actorId?: string | null;
  actorOrgId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Context only. Never put passwords, codes, tokens or secrets here. */
  details?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  ts: Date;
  actor_id: string | null;
  actor_org_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  user_agent: string | null;
  details: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export function computeHash(prevHash: string, r: Omit<AuditRow, 'id' | 'prev_hash' | 'hash'>): string {
  const payload = stableStringify([
    prevHash,
    r.ts.toISOString(),
    r.actor_id,
    r.actor_org_id,
    r.action,
    r.target_type,
    r.target_id,
    r.outcome,
    r.ip,
    r.user_agent,
    r.details,
  ]);
  return createHash('sha256').update(payload).digest('hex');
}

// Serialises writers so the chain has one well-defined order.
const CHAIN_LOCK = 727275;

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /**
   * Append one event. Pass `client` to write inside the caller's transaction, so a change and its
   * audit record commit or roll back together. Without it the event is written in its own transaction.
   */
  async record(event: AuditEvent, client?: Queryable): Promise<void> {
    if (client) return this.append(event, client);
    await this.db.tx((c) => this.append(event, c));
  }

  private async append(event: AuditEvent, client: Queryable): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock($1)', [CHAIN_LOCK]);
    const last = await client.query('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const prevHash: string = last.rows[0]?.hash ?? GENESIS_HASH;
    const row = {
      ts: new Date(),
      actor_id: event.actorId ?? null,
      actor_org_id: event.actorOrgId ?? null,
      action: event.action,
      target_type: event.targetType ?? null,
      target_id: event.targetId ?? null,
      outcome: event.outcome ?? 'success',
      ip: event.ip ?? null,
      user_agent: event.userAgent?.slice(0, 300) ?? null,
      details: event.details ?? {},
    };
    await client.query(
      `INSERT INTO audit_log (ts, actor_id, actor_org_id, action, target_type, target_id, outcome, ip, user_agent, details, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.ts, row.actor_id, row.actor_org_id, row.action, row.target_type, row.target_id,
        row.outcome, row.ip, row.user_agent, JSON.stringify(row.details), prevHash,
        computeHash(prevHash, row),
      ],
    );
  }

  async search(filter: {
    actorOrgId?: string;
    action?: string;
    targetId?: string;
    outcome?: AuditOutcome;
    from?: Date;
    to?: Date;
    beforeId?: string;
    limit: number;
  }): Promise<AuditRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (filter.actorOrgId) add('lower(actor_org_id) = lower(?)', filter.actorOrgId);
    if (filter.action) add('action LIKE ?', `${filter.action.replace(/[%_\\]/g, '\\$&')}%`);
    if (filter.targetId) add('target_id = ?', filter.targetId);
    if (filter.outcome) add('outcome = ?', filter.outcome);
    if (filter.from) add('ts >= ?', filter.from);
    if (filter.to) add('ts <= ?', filter.to);
    if (filter.beforeId) add('id < ?', filter.beforeId);
    params.push(filter.limit);
    const res = await this.db.query<AuditRow>(
      `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /** Walk the whole chain. Returns the first row whose link or hash does not match, if any. */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAtId?: string; reason?: string }> {
    let prev = GENESIS_HASH;
    let lastId = '0';
    let checked = 0;
    for (;;) {
      const res = await this.db.query<AuditRow>(
        'SELECT * FROM audit_log WHERE id > $1 ORDER BY id ASC LIMIT 1000',
        [lastId],
      );
      if (res.rows.length === 0) break;
      for (const row of res.rows) {
        if (row.prev_hash !== prev) return { ok: false, checked, brokenAtId: row.id, reason: 'link to previous row does not match' };
        if (computeHash(prev, row) !== row.hash) return { ok: false, checked, brokenAtId: row.id, reason: 'row contents do not match its hash' };
        prev = row.hash;
        lastId = row.id;
        checked++;
      }
    }
    return { ok: true, checked };
  }
}
