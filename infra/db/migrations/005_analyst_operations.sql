CREATE TABLE IF NOT EXISTS saved_alert_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_alert_views_owner ON saved_alert_views(owner, updated_at DESC);

INSERT INTO saved_alert_views (name, owner, filters)
VALUES
  ('Critical unassigned', 'demo-lead', '{"severity":"critical","assignedTo":"unassigned","status":"pending"}'),
  ('SLA breaches', 'demo-lead', '{"overdue":true,"status":"pending"}'),
  ('High risk crypto merchants', 'demo-lead', '{"merchantCategory":"crypto","status":"pending"}')
ON CONFLICT DO NOTHING;
