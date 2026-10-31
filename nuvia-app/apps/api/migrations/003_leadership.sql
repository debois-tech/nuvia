-- Phase 5: leadership view. Everything here is readable by executives (CEO/CTO/COO) only, except that
-- a project or task page shows the title and dates of a goal it is linked to.

-- Uploaded sheets. One row per upload; the figures themselves live in finance_rows.
CREATE TABLE finance_imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name    text NOT NULL,
  sheet_name   text,
  sha256       text NOT NULL,
  row_count    int NOT NULL,
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  mapping      jsonb NOT NULL,
  warnings     jsonb NOT NULL DEFAULT '[]',
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  uploaded_at  timestamptz NOT NULL
);

-- One row per month per department. A blank department in the sheet is stored as 'Unassigned'.
-- A NULL figure means "not in the sheet", which is different from zero.
CREATE TABLE finance_rows (
  period       date NOT NULL CHECK (period = date_trunc('month', period)::date),
  department   text NOT NULL,
  revenue      numeric(16,2) CHECK (revenue >= 0),
  target       numeric(16,2) CHECK (target >= 0),
  cost         numeric(16,2) CHECK (cost >= 0),
  cash_in      numeric(16,2) CHECK (cash_in >= 0),
  cash_out     numeric(16,2) CHECK (cash_out >= 0),
  closing_cash numeric(16,2),
  import_id    uuid NOT NULL REFERENCES finance_imports(id),
  PRIMARY KEY (period, department)
);
CREATE UNIQUE INDEX finance_rows_dept_ci ON finance_rows (period, lower(department));

-- Thresholds for the company health indicator. No row means the proposed defaults are in use and nobody has confirmed them.
CREATE TABLE leadership_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL
);

CREATE TABLE goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  owner_id     uuid REFERENCES users(id),
  start_date   date NOT NULL,
  due_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'dropped')),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (due_date >= start_date)
);
CREATE INDEX goals_status_idx ON goals (status, due_date);

CREATE TABLE milestones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id    uuid NOT NULL REFERENCES goals(id),
  title      text NOT NULL,
  owner_id   uuid REFERENCES users(id),
  due_date   date NOT NULL,
  done_at    timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX milestones_goal_idx ON milestones (goal_id, due_date);

-- A goal (or one of its milestones) is delivered by a whole project or by single tasks.
CREATE TABLE goal_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      uuid NOT NULL REFERENCES goals(id),
  milestone_id uuid REFERENCES milestones(id),
  project_id   uuid REFERENCES projects(id),
  task_id      uuid REFERENCES tasks(id),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL,
  CHECK ((project_id IS NULL) <> (task_id IS NULL))
);
CREATE UNIQUE INDEX goal_links_project_uq ON goal_links (goal_id, COALESCE(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid), project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX goal_links_task_uq ON goal_links (goal_id, COALESCE(milestone_id, '00000000-0000-0000-0000-000000000000'::uuid), task_id) WHERE task_id IS NOT NULL;
CREATE INDEX goal_links_project_idx ON goal_links (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX goal_links_task_idx ON goal_links (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX goal_links_milestone_idx ON goal_links (milestone_id) WHERE milestone_id IS NOT NULL;

-- What is currently off track. Kept so that each problem notifies the leaders once when it appears (and again
-- only if it gets worse or comes back), instead of on every check.
CREATE TABLE leadership_alerts (
  key               text PRIMARY KEY,
  kind              text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('warning', 'critical')),
  title             text NOT NULL,
  detail            text NOT NULL,
  link              text NOT NULL,
  raised_at         timestamptz NOT NULL,
  last_seen_at      timestamptz NOT NULL,
  resolved_at       timestamptz,
  notified_severity text
);

-- A notification can link to any page in the portal (set by the server, never from user input).
ALTER TABLE notifications ADD COLUMN link text;
