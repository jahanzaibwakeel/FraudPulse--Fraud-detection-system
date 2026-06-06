CREATE TABLE IF NOT EXISTS simulation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  actor TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  expected_signals JSONB NOT NULL DEFAULT '[]',
  transaction_ids UUID[] NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_started ON simulation_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_scenario ON simulation_runs(scenario_id, started_at DESC);
