import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { DbService } from '../../common/db.service';
import { workDateOf } from '../../common/tz';
import { AuthUser } from '../../auth/roles';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { ipInRanges, parseCidrs } from './network';

@Injectable()
export class OfficeService {
  private readonly ranges;

  constructor(private readonly db: DbService, private readonly clock: Clock, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.ranges = parseCidrs(cfg.officeNetworkCidrs);
  }

  get networkRestricted(): boolean {
    return this.ranges.length > 0;
  }

  private requireOfficeMode(user: AuthUser) {
    if (user.workMode !== 'office') throw new ForbiddenException('Your account is set to remote mode. Use the desktop agent instead.');
  }

  async checkIn(user: AuthUser, ip: string | undefined) {
    this.requireOfficeMode(user);
    if (this.networkRestricted && !ipInRanges(ip, this.ranges)) {
      throw new ForbiddenException('Office check-in is only possible from the office network.');
    }
    const now = this.clock.now();
    const { rows } = await this.db.query(
      `INSERT INTO office_attendance (user_id, work_date, check_in_at, check_in_ip) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, work_date) DO NOTHING
       RETURNING id, work_date, check_in_at, check_out_at`,
      [user.id, workDateOf(now, this.cfg.timezone), now, ip ?? null],
    );
    if (!rows[0]) throw new ConflictException('You have already checked in today.');
    return rows[0];
  }

  async checkOut(user: AuthUser, ip: string | undefined) {
    this.requireOfficeMode(user);
    const now = this.clock.now();
    const { rows } = await this.db.query(
      `UPDATE office_attendance SET check_out_at = $3, check_out_ip = $4
       WHERE user_id = $1 AND work_date = $2 AND check_out_at IS NULL
       RETURNING id, work_date, check_in_at, check_out_at`,
      [user.id, workDateOf(now, this.cfg.timezone), now, ip ?? null],
    );
    if (rows[0]) return rows[0];
    const existing = await this.db.query('SELECT check_out_at FROM office_attendance WHERE user_id = $1 AND work_date = $2', [
      user.id,
      workDateOf(now, this.cfg.timezone),
    ]);
    throw new ConflictException(existing.rowCount ? 'You have already checked out today.' : 'You have not checked in today.');
  }

  async today(user: AuthUser) {
    const date = workDateOf(this.clock.now(), this.cfg.timezone);
    const { rows } = await this.db.query('SELECT id, work_date, check_in_at, check_out_at FROM office_attendance WHERE user_id = $1 AND work_date = $2', [
      user.id,
      date,
    ]);
    return { date, networkRestricted: this.networkRestricted, record: rows[0] ?? null };
  }

  history(userId: string, from: string, to: string) {
    return this.db
      .query('SELECT id, work_date, check_in_at, check_out_at FROM office_attendance WHERE user_id = $1 AND work_date BETWEEN $2 AND $3 ORDER BY work_date DESC', [
        userId,
        from,
        to,
      ])
      .then((r) => r.rows);
  }

  /** Office-mode people visible to the viewer for one day, including those who haven't checked in. */
  async day(viewer: AuthUser, date: string) {
    const scope = viewer.role === 'team_lead' ? 'AND u.manager_id = $2' : '';
    const params: unknown[] = [date];
    if (viewer.role === 'team_lead') params.push(viewer.id);
    const { rows } = await this.db.query(
      `SELECT u.id AS user_id, u.org_id, u.name, o.check_in_at, o.check_out_at
       FROM users u LEFT JOIN office_attendance o ON o.user_id = u.id AND o.work_date = $1
       WHERE u.active AND u.work_mode = 'office' AND u.role <> 'executive' ${scope} ORDER BY u.name`,
      params,
    );
    return rows;
  }
}
