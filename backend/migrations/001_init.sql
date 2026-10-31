-- Nuvia phase 2: users, sessions, recovery codes, audit log.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                text NOT NULL,
  name                  text NOT NULL,
  email                 text NOT NULL,
  role                  text NOT NULL CHECK (role IN ('employee', 'lead', 'hr_admin', 'executive')),
  title                 text,                       -- e.g. CEO / CTO / COO for executives
  password_hash         text NOT NULL,
  must_change_password  boolean NOT NULL DEFAULT true,
  password_changed_at   timestamptz,
  active                boolean NOT NULL DEFAULT true,
  failed_attempts       integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  mfa_secret_enc        text,                       -- AES-256-GCM, never stored in clear
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_last_step         bigint NOT NULL DEFAULT 0,  -- last accepted TOTP step, blocks code replay
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX users_org_id_key ON users (lower(org_id));
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE recovery_codes (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz
);
CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id);

-- Server-side sessions. Only a SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  stage        text NOT NULL CHECK (stage IN ('pending_password', 'pending_mfa', 'pending_enroll', 'active')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,                -- absolute expiry
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Append-only audit log with a hash chain so edits or deletions are detectable.
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  ts            timestamptz NOT NULL,
  actor_id      uuid,                               -- no FK: the log must outlive any user row
  actor_org_id  text,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  outcome       text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  ip            text,
  user_agent    text,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     text NOT NULL,
  hash          text NOT NULL
);
CREATE INDEX audit_log_ts_idx ON audit_log (ts DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, ts DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, ts DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
