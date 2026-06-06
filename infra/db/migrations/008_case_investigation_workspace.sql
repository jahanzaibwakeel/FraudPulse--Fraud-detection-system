CREATE TABLE IF NOT EXISTS case_evidence_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES fraud_alerts(id),
  created_by TEXT NOT NULL,
  bundle JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_evidence_alert_time ON case_evidence_snapshots(alert_id, created_at DESC);
