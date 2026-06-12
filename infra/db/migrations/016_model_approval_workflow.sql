CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS model_approval_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_version_id UUID NOT NULL REFERENCES model_versions(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewer TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_approval_model_created ON model_approval_reviews(model_version_id, created_at DESC);
