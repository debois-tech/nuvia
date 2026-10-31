-- Phase 3: attendance. The users table is a minimal stand-in that Phase 2 (secure base)
-- replaces or extends with MFA, admin-managed accounts and the full roles model.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        text NOT NULL UNIQUE,
  name          text NOT NULL,
  email         text,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('employee', 'team_lead', 'hr_admin', 'executive')),
  work_mode     text NOT NULL DEFAULT 'office' CHECK (work_mode IN ('office', 'remote')),
  manager_id    uuid REFERENCES users(id),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_manager_idx ON users (manager_id);

-- Office mode: one row per person per day.
CREATE TABLE office_attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  work_date    date NOT NULL,
  check_in_at  timestamptz NOT NULL,
  check_in_ip  text,
  check_out_at timestamptz,
  check_out_ip text,
  UNIQUE (user_id, work_date)
);
CREATE INDEX office_attendance_date_idx ON office_attendance (work_date);

-- Remote mode: a desktop agent install is a device with its own signing secret.
CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  name         text NOT NULL,
  secret_enc   text NOT NULL,           -- AES-256-GCM, key from DEVICE_SECRET_KEY
  last_seq     bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX devices_user_idx ON devices (user_id);

CREATE TABLE remote_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  device_id          uuid NOT NULL REFERENCES devices(id),
  work_date          date NOT NULL,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz,
  end_reason         text,              -- stopped | superseded | agent_lost
  state              text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'prompted', 'absent', 'offline')),
  last_heartbeat_at  timestamptz NOT NULL,
  last_activity_at   timestamptz NOT NULL,
  last_challenge_at  timestamptz
);
CREATE UNIQUE INDEX remote_sessions_one_open ON remote_sessions (user_id) WHERE ended_at IS NULL;
CREATE INDEX remote_sessions_user_date_idx ON remote_sessions (user_id, work_date);

-- Contiguous timeline of a session. ended_at IS NULL means the period is still running.
CREATE TABLE activity_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES remote_sessions(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  kind       text NOT NULL CHECK (kind IN ('active', 'idle', 'absent', 'offline')),
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX activity_periods_session_idx ON activity_periods (session_id, started_at);
CREATE INDEX activity_periods_user_idx ON activity_periods (user_id, started_at);

-- Timing and counts only. Features are derived on the server from quantised steps; raw steps are not stored.
CREATE TABLE heartbeats (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES remote_sessions(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  seq         bigint NOT NULL,
  received_at timestamptz NOT NULL,
  window_seconds int NOT NULL,
  active_seconds int NOT NULL,
  other_input_events int NOT NULL,
  features    jsonb NOT NULL
);
CREATE INDEX heartbeats_session_idx ON heartbeats (session_id, id DESC);
CREATE INDEX heartbeats_received_idx ON heartbeats (received_at);

CREATE TABLE prompts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES remote_sessions(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('idle', 'challenge')),
  code        text,
  attempts    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'failed', 'expired')),
  answered_at timestamptz
);
CREATE INDEX prompts_pending_idx ON prompts (session_id) WHERE status = 'pending';

-- Anything a person should look at. Flags are for human review and never punish automatically.
CREATE TABLE review_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  session_id      uuid REFERENCES remote_sessions(id),
  period_id       uuid REFERENCES activity_periods(id),
  prompt_id       uuid REFERENCES prompts(id),
  kind            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  detail          jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed', 'excused')),
  created_at      timestamptz NOT NULL,
  resolved_by     uuid REFERENCES users(id),
  resolved_at     timestamptz,
  resolution_note text,
  employee_note   text,
  employee_note_at timestamptz
);
CREATE INDEX review_flags_user_idx ON review_flags (user_id, created_at DESC);
CREATE INDEX review_flags_status_idx ON review_flags (status, created_at DESC);
CREATE INDEX review_flags_dedupe_idx ON review_flags (session_id, kind, created_at DESC);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  kind       text NOT NULL,
  message    text NOT NULL,
  flag_id    uuid REFERENCES review_flags(id),
  created_at timestamptz NOT NULL,
  read_at    timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Minimal audit trail for raw activity data. Phase 2 owns the full audit log and can take this table over.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text,
  target_id   text,
  detail      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, at DESC);
