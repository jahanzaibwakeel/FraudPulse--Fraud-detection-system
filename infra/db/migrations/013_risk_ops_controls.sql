CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS entity_watchlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'card', 'merchant', 'device', 'ip')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('monitor', 'block', 'allow')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (entity_type, entity_id, action, status)
);

CREATE TABLE IF NOT EXISTS entity_risk_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'card', 'merchant', 'device', 'ip')),
  entity_id TEXT NOT NULL,
  risk_delta NUMERIC(6, 2) NOT NULL,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'card', 'merchant', 'device', 'ip')),
  entity_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_watchlist_lookup ON entity_watchlist(entity_type, entity_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_overrides_lookup ON entity_risk_overrides(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_notes_lookup ON entity_notes(entity_type, entity_id, created_at DESC);
