ALTER TABLE fraud_scores
  ADD COLUMN IF NOT EXISTS rule_score NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS ml_score NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS model_probability NUMERIC(6, 5),
  ADD COLUMN IF NOT EXISTS blended_score NUMERIC(6, 2);

CREATE TABLE IF NOT EXISTS model_drift_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_version_id UUID REFERENCES model_versions(id),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  baseline_start TIMESTAMPTZ NOT NULL,
  baseline_end TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_drift_created ON model_drift_snapshots(created_at DESC);

UPDATE model_versions SET active = false;

INSERT INTO model_versions (version, parameters, metrics, active)
VALUES (
  'hybrid-logit-v1',
  '{
    "blendRuleWeight": 0.62,
    "alertThreshold": 55,
    "coefficients": {
      "bias": -2.35,
      "velocity5m": 0.028,
      "amountZscore": 0.42,
      "geoKmh": 0.00085,
      "merchantRisk": 0.018,
      "newDevice": 0.78,
      "userTx30d": 0.006
    }
  }',
  '{}',
  true
)
ON CONFLICT (version) DO UPDATE SET active = true, parameters = EXCLUDED.parameters;
