import { getMigrations } from "better-auth/db/migration";
import { auth } from "./auth.js";
import { pool } from "./database.js";

const businessSchema = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  model text NOT NULL DEFAULT '',
  board text NOT NULL DEFAULT '',
  clock text NOT NULL DEFAULT '',
  flash text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  firmware_version text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devices_workspace_idx ON devices(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS firmware_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  uploaded_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  file_name text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  file_type text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sha256)
);

CREATE INDEX IF NOT EXISTS firmware_workspace_idx ON firmware_versions(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS debug_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  device_name text NOT NULL,
  connection_label text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL CHECK (status IN ('recording', 'completed', 'interrupted')),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_workspace_idx ON debug_sessions(workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS debug_events (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES debug_sessions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  recorded_at timestamptz NOT NULL,
  level text NOT NULL CHECK (level IN ('info', 'success', 'warning', 'data')),
  message text NOT NULL,
  payload jsonb,
  UNIQUE (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS events_session_idx ON debug_events(session_id, sequence);
`;

export async function migrateDatabase(): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  await pool.query(businessSchema);
}
