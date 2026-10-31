import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DbService, Q } from '../common/db.service';

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService, private readonly clock: Clock) {}

  record(actorId: string | null, action: string, target?: { type: string; id: string }, detail: object = {}, q: Q = this.db) {
    return q.query('INSERT INTO audit_log (at, actor_id, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6)', [
      this.clock.now(),
      actorId,
      action,
      target?.type ?? null,
      target?.id ?? null,
      JSON.stringify(detail),
    ]);
  }
}
