ALTER TABLE data_quality_alerts
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

CREATE INDEX IF NOT EXISTS idx_quality_alerts_assignee ON data_quality_alerts(assigned_to, status, last_seen_at DESC);
