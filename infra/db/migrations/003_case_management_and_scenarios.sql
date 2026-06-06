ALTER TABLE fraud_alerts
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS case_summary TEXT;

CREATE TABLE IF NOT EXISTS alert_case_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES fraud_alerts(id),
  author TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_assignee_due ON fraud_alerts(assigned_to, due_at);
CREATE INDEX IF NOT EXISTS idx_case_notes_alert_time ON alert_case_notes(alert_id, created_at DESC);
