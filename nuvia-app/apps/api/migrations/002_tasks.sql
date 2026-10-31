-- Phase 4: tasks. Projects scope who can see what: a person sees the projects they are a member of.
-- HR/admin and executives see every project (executives read-only).

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,7}$'),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  next_number int NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL
);

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  added_at   timestamptz NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id),
  number       int NOT NULL,
  parent_id    uuid REFERENCES tasks(id),
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id  uuid REFERENCES users(id),
  reporter_id  uuid NOT NULL REFERENCES users(id),
  due_date     date,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  completed_at timestamptz,
  -- Set when the due-soon / overdue reminder went out; cleared when the due date or assignee changes.
  due_soon_notified_at timestamptz,
  overdue_notified_at  timestamptz,
  UNIQUE (project_id, number)
);
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id, status);
CREATE INDEX tasks_parent_idx ON tasks (parent_id);
CREATE INDEX tasks_due_idx ON tasks (due_date) WHERE status <> 'done' AND assignee_id IS NOT NULL;

CREATE TABLE task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id),
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at);

-- Files live on the server's own disk under UPLOAD_DIR, named by storage_key (never by the uploaded name).
CREATE TABLE task_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id),
  uploader_id  uuid NOT NULL REFERENCES users(id),
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL,
  storage_key  text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL,
  deleted_at   timestamptz
);
CREATE INDEX task_attachments_task_idx ON task_attachments (task_id);

-- Per-task history: who changed what and when.
CREATE TABLE task_activity (
  id         bigserial PRIMARY KEY,
  task_id    uuid NOT NULL REFERENCES tasks(id),
  actor_id   uuid REFERENCES users(id),
  kind       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);
CREATE INDEX task_activity_task_idx ON task_activity (task_id, id);

-- In-portal notifications can now point at a task as well as an attendance flag.
ALTER TABLE notifications ADD COLUMN task_id uuid REFERENCES tasks(id);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
