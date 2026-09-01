import { pool } from "./database.js";
import { ensureBootstrapUser } from "./internal-auth.js";

const businessSchema = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS internal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text,
  passport_user_id text,
  email text,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE internal_users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE internal_users ADD COLUMN IF NOT EXISTS passport_user_id text;
ALTER TABLE internal_users ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS internal_users_passport_user_idx
  ON internal_users(passport_user_id) WHERE passport_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS internal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_sessions_expiry_idx ON internal_sessions(expires_at);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS device_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  credential_hash text NOT NULL UNIQUE CHECK (length(credential_hash) = 64),
  credential_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_providers_workspace_idx ON device_providers(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS device_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  provider_name text NOT NULL CHECK (length(provider_name) BETWEEN 1 AND 160),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES device_providers(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS provider_device_id text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS connection_mode text NOT NULL DEFAULT 'nearby';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS remote_status text NOT NULL DEFAULT 'offline';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS capability_version text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS current_operation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS devices_provider_identity_idx
  ON devices(provider_id, provider_device_id) WHERE provider_id IS NOT NULL AND provider_device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_capability_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  manifest_version text NOT NULL CHECK (length(manifest_version) BETWEEN 1 AND 120),
  manifest_digest text NOT NULL CHECK (length(manifest_digest) = 64),
  schema_version integer NOT NULL DEFAULT 1,
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, manifest_digest)
);

CREATE INDEX IF NOT EXISTS device_capabilities_current_idx
  ON device_capability_manifests(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hardware_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  hardware_profile_id text NOT NULL,
  adapter_version text NOT NULL,
  runtime_version text NOT NULL,
  target text NOT NULL,
  firmware_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name),
  CHECK (jsonb_typeof(firmware_configuration) = 'object')
);

CREATE INDEX IF NOT EXISTS hardware_projects_workspace_idx ON hardware_projects(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS firmware_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  uploaded_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  file_name text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  file_type text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  content bytea NOT NULL,
  hardware_profile_id text,
  artifact_role text NOT NULL DEFAULT 'unclassified',
  flash_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
  flash_size integer,
  application_base integer,
  application_limit integer,
  runtime_version text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sha256),
  CHECK (artifact_role IN ('complete-image','application','unclassified')),
  CHECK (flash_methods <@ ARRAY['swd','usb','bluetooth']::text[]),
  CHECK (status IN ('draft','verified','stable','retired'))
);

ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS hardware_profile_id text;
ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS artifact_role text NOT NULL DEFAULT 'unclassified';
ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS flash_methods text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS flash_size integer;
ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS application_base integer;
ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS application_limit integer;
ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS runtime_version text;
ALTER TABLE firmware_versions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE firmware_versions DROP CONSTRAINT IF EXISTS firmware_versions_artifact_role_check;
ALTER TABLE firmware_versions ADD CONSTRAINT firmware_versions_artifact_role_check CHECK (artifact_role IN ('complete-image','application','unclassified'));
ALTER TABLE firmware_versions DROP CONSTRAINT IF EXISTS firmware_versions_flash_methods_check;
ALTER TABLE firmware_versions ADD CONSTRAINT firmware_versions_flash_methods_check CHECK (flash_methods <@ ARRAY['swd','usb','bluetooth']::text[]);
ALTER TABLE firmware_versions DROP CONSTRAINT IF EXISTS firmware_versions_status_check;
ALTER TABLE firmware_versions ADD CONSTRAINT firmware_versions_status_check CHECK (status IN ('draft','verified','stable','retired'));

CREATE INDEX IF NOT EXISTS firmware_workspace_idx ON firmware_versions(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS debug_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
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

CREATE TABLE IF NOT EXISTS api_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  purpose text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 500),
  scopes text[] NOT NULL,
  credential_hash text NOT NULL UNIQUE CHECK (length(credential_hash) = 64),
  credential_hint text NOT NULL CHECK (length(credential_hint) = 6),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK (cardinality(scopes) > 0),
  CHECK (scopes <@ ARRAY['devices:read','devices:manage','devices:control','debug:read','debug:execute','runners:read','runners:manage','builds:read','builds:create','builds:cancel','artifacts:read']::text[])
);

ALTER TABLE api_connections DROP CONSTRAINT IF EXISTS api_connections_scopes_check;
ALTER TABLE api_connections ADD CONSTRAINT api_connections_scopes_check
  CHECK (scopes <@ ARRAY['devices:read','devices:manage','devices:control','debug:read','debug:execute','runners:read','runners:manage','builds:read','builds:create','builds:cancel','artifacts:read']::text[]);

CREATE INDEX IF NOT EXISTS api_connections_user_idx ON api_connections(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 200),
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_audit_events_connection_idx ON api_audit_events(connection_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS device_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  actions text[] NOT NULL,
  permissions text[] NOT NULL DEFAULT ARRAY['read','control']::text[],
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, device_id),
  CHECK (cardinality(actions) > 0),
  CHECK (permissions <@ ARRAY['read','control']::text[])
);

CREATE INDEX IF NOT EXISTS device_grants_workspace_idx ON device_grants(workspace_id, connection_id);

CREATE TABLE IF NOT EXISTS device_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES device_providers(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 160),
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(arguments) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','accepted','running','cancelling','succeeded','failed','cancelled','expired')),
  caller_key text NOT NULL CHECK (length(caller_key) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  connection_id uuid REFERENCES api_connections(id) ON DELETE SET NULL,
  execution_timeout_ms integer NOT NULL CHECK (execution_timeout_ms BETWEEN 1000 AND 300000),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  lease_id text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  accepted_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error_code text,
  error_message text,
  trace_id text,
  priority integer NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, caller_key, idempotency_key)
);

ALTER TABLE device_operations ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS device_operations_workspace_idx ON device_operations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS device_operations_provider_queue_idx ON device_operations(provider_id, status, created_at);

CREATE TABLE IF NOT EXISTS device_operation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES device_operations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES device_providers(id) ON DELETE SET NULL,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  sequence integer NOT NULL CHECK (sequence >= 0),
  status text NOT NULL CHECK (status IN ('queued','leased','accepted','running','cancelling','succeeded','failed','cancelled','expired')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, event_id),
  UNIQUE (operation_id, sequence)
);

CREATE INDEX IF NOT EXISTS device_operation_events_operation_idx ON device_operation_events(operation_id, sequence);

CREATE TABLE IF NOT EXISTS workbench_preferences (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_key text NOT NULL,
  selected_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, profile_key),
  CHECK (length(profile_key) BETWEEN 1 AND 160),
  CHECK (jsonb_typeof(selected_components) = 'array')
);

CREATE TABLE IF NOT EXISTS runner_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS build_runners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'busy', 'offline')),
  current_job_id uuid,
  last_seen_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(capabilities) = 'object')
);

CREATE INDEX IF NOT EXISTS build_runners_workspace_idx ON build_runners(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS build_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  runner_id uuid NOT NULL REFERENCES build_runners(id) ON DELETE RESTRICT,
  hardware_project_id uuid REFERENCES hardware_projects(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  profile text NOT NULL,
  target text NOT NULL,
  adapter_version text,
  runtime_version text,
  firmware_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_name text NOT NULL,
  source_sha256 text NOT NULL CHECK (length(source_sha256) = 64),
  source_content bytea NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','running','succeeded','failed','cancelled')),
  desired_state text NOT NULL DEFAULT 'running' CHECK (desired_state IN ('running','cancelled')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  lease_id text,
  leased_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(firmware_configuration) = 'object')
);

CREATE INDEX IF NOT EXISTS build_jobs_workspace_idx ON build_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS build_jobs_runner_queue_idx ON build_jobs(runner_id, status, created_at);

ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS hardware_project_id uuid REFERENCES hardware_projects(id) ON DELETE RESTRICT;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS adapter_version text;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS runtime_version text;
ALTER TABLE hardware_projects ADD COLUMN IF NOT EXISTS firmware_configuration jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS firmware_configuration jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE build_runners DROP CONSTRAINT IF EXISTS build_runners_current_job_id_fkey;
ALTER TABLE build_runners ADD CONSTRAINT build_runners_current_job_id_fkey
  FOREIGN KEY (current_job_id) REFERENCES build_jobs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS build_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  event_id text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('accepted','started','progress','log','completed','failed','cancelled')),
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS build_events_job_idx ON build_events(job_id, created_at);

CREATE TABLE IF NOT EXISTS build_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('elf','hex','bin','map','log','report')),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  size bigint NOT NULL CHECK (size >= 0),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, name)
);

CREATE INDEX IF NOT EXISTS build_artifacts_job_idx ON build_artifacts(job_id, created_at);

CREATE TABLE IF NOT EXISTS firmware_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hardware_project_id uuid NOT NULL REFERENCES hardware_projects(id) ON DELETE RESTRICT,
  build_job_id uuid NOT NULL UNIQUE REFERENCES build_jobs(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  hardware_profile_id text NOT NULL,
  adapter_version text NOT NULL,
  runtime_version text NOT NULL,
  target text NOT NULL,
  source_sha256 text NOT NULL CHECK (length(source_sha256) = 64),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','stable','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS firmware_packages_workspace_idx ON firmware_packages(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS firmware_package_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES firmware_packages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  file_type text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  content bytea NOT NULL,
  artifact_role text NOT NULL CHECK (artifact_role IN ('complete-image','application')),
  flash_methods text[] NOT NULL CHECK (flash_methods <@ ARRAY['swd','usb','bluetooth']::text[]),
  flash_size integer NOT NULL,
  application_base integer NOT NULL,
  application_limit integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, artifact_role)
);

ALTER TABLE firmware_package_artifacts DROP CONSTRAINT IF EXISTS firmware_package_artifacts_flash_methods_check;
ALTER TABLE firmware_package_artifacts ADD CONSTRAINT firmware_package_artifacts_flash_methods_check CHECK (flash_methods <@ ARRAY['swd','usb','bluetooth']::text[]);

CREATE INDEX IF NOT EXISTS firmware_package_artifacts_package_idx ON firmware_package_artifacts(package_id, created_at);
`;

export async function migrateDatabase(): Promise<void> {
  await pool.query(businessSchema);
  await ensureBootstrapUser();
}
