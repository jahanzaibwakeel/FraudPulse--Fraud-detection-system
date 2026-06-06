CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  home_latitude NUMERIC(9, 6) NOT NULL,
  home_longitude NUMERIC(9, 6) NOT NULL,
  baseline_daily_amount NUMERIC(12, 2) NOT NULL DEFAULT 250,
  risk_tier TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  latitude NUMERIC(9, 6) NOT NULL,
  longitude NUMERIC(9, 6) NOT NULL,
  country TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  last4 TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  card_id UUID NOT NULL REFERENCES cards(id),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latitude NUMERIC(9, 6) NOT NULL,
  longitude NUMERIC(9, 6) NOT NULL,
  channel TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  ip_address INET NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  is_fraud_ground_truth BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transaction_events (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID REFERENCES transactions(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scoring_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  weight NUMERIC(6, 2) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  threshold JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version TEXT UNIQUE NOT NULL,
  parameters JSONB NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fraud_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID UNIQUE NOT NULL REFERENCES transactions(id),
  score NUMERIC(6, 2) NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL,
  severity TEXT NOT NULL,
  reasons JSONB NOT NULL,
  model_version_id UUID REFERENCES model_versions(id),
  latency_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fraud_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID UNIQUE NOT NULL REFERENCES transactions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  fraud_score_id UUID NOT NULL REFERENCES fraud_scores(id),
  severity TEXT NOT NULL,
  score NUMERIC(6, 2) NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL,
  reasons JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE review_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES fraud_alerts(id),
  decision TEXT NOT NULL,
  analyst TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user_time ON transactions(user_id, occurred_at DESC);
CREATE INDEX idx_transactions_merchant_time ON transactions(merchant_id, occurred_at DESC);
CREATE INDEX idx_events_type_time ON transaction_events(event_type, created_at DESC);
CREATE INDEX idx_alerts_status_created ON fraud_alerts(status, created_at DESC);

INSERT INTO scoring_rules (code, label, weight, threshold) VALUES
  ('velocity_5m', 'Velocity spike in five minutes', 22, '{"maxCount": 5}'),
  ('amount_zscore', 'Amount anomaly against user history', 24, '{"zScore": 2.5, "minHistory": 8}'),
  ('geo_impossible', 'Impossible travel geo-distance', 26, '{"kmh": 850}'),
  ('merchant_risk', 'High-risk merchant profile', 16, '{"riskScore": 70}'),
  ('new_device', 'Unseen device for user', 12, '{"lookbackDays": 30}');

INSERT INTO model_versions (version, parameters, metrics, active) VALUES
  ('rules-stat-v1', '{"alertThreshold": 55, "criticalThreshold": 90}', '{}', true);
