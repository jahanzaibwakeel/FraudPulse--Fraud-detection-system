CREATE TABLE IF NOT EXISTS model_benchmark_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  sample_size INTEGER NOT NULL,
  validation_size INTEGER NOT NULL,
  algorithms JSONB NOT NULL DEFAULT '[]',
  results JSONB NOT NULL DEFAULT '[]',
  best_algorithm TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_benchmark_runs_created ON model_benchmark_runs(created_at DESC);
