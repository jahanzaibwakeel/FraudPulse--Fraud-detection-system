CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS model_shadow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_model_id UUID REFERENCES model_versions(id),
  champion_model_id UUID REFERENCES model_versions(id),
  candidate_version TEXT NOT NULL,
  champion_version TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  alert_threshold NUMERIC NOT NULL,
  candidate JSONB NOT NULL,
  champion JSONB NOT NULL,
  alert_delta INTEGER NOT NULL,
  disagreement_count INTEGER NOT NULL,
  disagreement_rate NUMERIC NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_shadow_runs_created ON model_shadow_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_shadow_runs_candidate ON model_shadow_runs(candidate_model_id, created_at DESC);
