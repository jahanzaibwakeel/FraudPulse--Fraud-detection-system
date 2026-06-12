CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS fraud_ring_investigations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ring_id TEXT NOT NULL,
  risk_score NUMERIC(6, 2) NOT NULL,
  transaction_count INTEGER NOT NULL,
  alert_count INTEGER NOT NULL,
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  strongest_signals JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to TEXT NOT NULL DEFAULT 'casey.ops',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ring_investigations_status ON fraud_ring_investigations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ring_investigations_ring ON fraud_ring_investigations(ring_id, created_at DESC);
