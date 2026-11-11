CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  accent_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS board_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title VARCHAR(120) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO board_settings (id, title) VALUES (1, 'Project board')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  archived BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS app_migrations (
  name TEXT PRIMARY KEY
);
INSERT INTO projects (id, title, version)
  SELECT 'default', title, version FROM board_settings
  WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM app_migrations WHERE name = 'default_project_initialized')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO app_migrations (name) VALUES ('default_project_initialized')
  ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  title VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  status TEXT NOT NULL CONSTRAINT tasks_status_check CHECK (status IN ('Backlog', 'To do', 'In progress', 'In Review', 'Done')),
  priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')),
  assignee VARCHAR(80) NOT NULL DEFAULT '',
  label VARCHAR(40) NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1
);
