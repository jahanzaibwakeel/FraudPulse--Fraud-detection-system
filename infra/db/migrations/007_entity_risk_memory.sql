CREATE TABLE IF NOT EXISTS entity_risk_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'card', 'merchant', 'device', 'ip')),
  entity_id TEXT NOT NULL,
  risk_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  velocity_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  anomaly_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  alert_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  review_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  confirmed_fraud_count INTEGER NOT NULL DEFAULT 0,
  false_positive_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_risk_type_score ON entity_risk_memory(entity_type, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_entity_risk_updated ON entity_risk_memory(updated_at DESC);

INSERT INTO entity_risk_memory
  (entity_type, entity_id, risk_score, velocity_score, anomaly_score, alert_score, transaction_count, alert_count, last_seen_at, evidence)
SELECT
  entity_type,
  entity_id,
  LEAST(99, avg_score * 0.55 + LEAST(alert_count * 6, 30) + LEAST(tx_count / 25.0, 15)) AS risk_score,
  LEAST(99, tx_count / 10.0) AS velocity_score,
  avg_score AS anomaly_score,
  LEAST(99, alert_count * 12) AS alert_score,
  tx_count,
  alert_count,
  last_seen_at,
  jsonb_build_object('seededFromHistory', true, 'avgScore', avg_score)
FROM (
  SELECT 'user' AS entity_type, t.user_id::text AS entity_id, count(*)::int AS tx_count,
    count(fa.id)::int AS alert_count, COALESCE(avg(fs.score), 0) AS avg_score, max(t.occurred_at) AS last_seen_at
  FROM transactions t
  LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
  LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
  GROUP BY t.user_id
  UNION ALL
  SELECT 'card', t.card_id::text, count(*)::int, count(fa.id)::int, COALESCE(avg(fs.score), 0), max(t.occurred_at)
  FROM transactions t
  LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
  LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
  GROUP BY t.card_id
  UNION ALL
  SELECT 'merchant', t.merchant_id::text, count(*)::int, count(fa.id)::int, COALESCE(avg(fs.score), 0), max(t.occurred_at)
  FROM transactions t
  LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
  LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
  GROUP BY t.merchant_id
  UNION ALL
  SELECT 'device', t.device_fingerprint, count(*)::int, count(fa.id)::int, COALESCE(avg(fs.score), 0), max(t.occurred_at)
  FROM transactions t
  LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
  LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
  GROUP BY t.device_fingerprint
  UNION ALL
  SELECT 'ip', t.ip_address::text, count(*)::int, count(fa.id)::int, COALESCE(avg(fs.score), 0), max(t.occurred_at)
  FROM transactions t
  LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
  LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
  GROUP BY t.ip_address::text
) seeded
ON CONFLICT (entity_type, entity_id) DO NOTHING;
