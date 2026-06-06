CREATE TABLE IF NOT EXISTS transaction_features (
  transaction_id UUID PRIMARY KEY REFERENCES transactions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  features JSONB NOT NULL,
  velocity_5m INTEGER NOT NULL,
  velocity_1h INTEGER NOT NULL,
  user_tx_30d INTEGER NOT NULL,
  amount_mean NUMERIC(12, 2) NOT NULL,
  amount_stddev NUMERIC(12, 2) NOT NULL,
  amount_zscore NUMERIC(10, 4) NOT NULL,
  geo_distance_km NUMERIC(12, 2) NOT NULL,
  geo_kmh NUMERIC(12, 2) NOT NULL,
  merchant_risk INTEGER NOT NULL,
  device_seen BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_features_user_time ON transaction_features(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_features_merchant_time ON transaction_features(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_features_amount_zscore ON transaction_features(amount_zscore DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_features_geo_kmh ON transaction_features(geo_kmh DESC);
