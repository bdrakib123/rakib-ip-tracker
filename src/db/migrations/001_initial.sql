CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visitors (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  ip_hash char(64),
  country text,
  device_category text,
  session_identifier char(64),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND NOT (payload ? 'ip'))
);
CREATE INDEX IF NOT EXISTS visitors_created_at_idx ON visitors (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS visitors_ip_hash_idx ON visitors (ip_hash) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_country_idx ON visitors (country) WHERE country IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_device_category_idx ON visitors (device_category) WHERE device_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_session_identifier_idx ON visitors (session_identifier) WHERE session_identifier IS NOT NULL;

CREATE TABLE IF NOT EXISTS request_analytics (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL,
  method varchar(16) NOT NULL,
  path varchar(180) NOT NULL,
  status smallint NOT NULL,
  duration_ms integer NOT NULL,
  session_identifier char(64)
);
CREATE INDEX IF NOT EXISTS request_analytics_created_at_idx ON request_analytics (created_at DESC);
CREATE INDEX IF NOT EXISTS request_analytics_session_idx ON request_analytics (session_identifier, created_at DESC);

CREATE TABLE IF NOT EXISTS page_analytics (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL,
  method varchar(16) NOT NULL,
  path varchar(180) NOT NULL,
  duration_ms integer,
  session_identifier char(64)
);
CREATE INDEX IF NOT EXISTS page_analytics_created_at_idx ON page_analytics (created_at DESC);
CREATE INDEX IF NOT EXISTS page_analytics_session_idx ON page_analytics (session_identifier, created_at DESC);

CREATE TABLE IF NOT EXISTS security_analytics (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL,
  event_type varchar(32) NOT NULL,
  method varchar(16) NOT NULL,
  path varchar(180) NOT NULL
);
CREATE INDEX IF NOT EXISTS security_analytics_created_at_idx ON security_analytics (created_at DESC);

CREATE TABLE IF NOT EXISTS visitor_sessions (
  session_identifier char(64) PRIMARY KEY,
  created_at timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  first_path varchar(180) NOT NULL,
  ip_hash char(64),
  user_agent text,
  referrer text
);
CREATE INDEX IF NOT EXISTS visitor_sessions_last_seen_idx ON visitor_sessions (last_seen DESC);

CREATE TABLE IF NOT EXISTS analytics_metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  collected_from timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash char(64) PRIMARY KEY,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0)
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_window_idx ON rate_limit_buckets (window_started_at);
