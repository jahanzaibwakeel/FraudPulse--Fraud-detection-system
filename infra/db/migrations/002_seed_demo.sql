INSERT INTO users (id, full_name, email, home_latitude, home_longitude, baseline_daily_amount, risk_tier) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ava Patel', 'ava@example.local', 40.712800, -74.006000, 320, 'standard'),
  ('22222222-2222-2222-2222-222222222222', 'Noah Williams', 'noah@example.local', 34.052200, -118.243700, 410, 'standard'),
  ('33333333-3333-3333-3333-333333333333', 'Mina Chen', 'mina@example.local', 41.878100, -87.629800, 280, 'watch'),
  ('44444444-4444-4444-4444-444444444444', 'Sam Rivera', 'sam@example.local', 29.760400, -95.369800, 350, 'standard');

INSERT INTO merchants (id, name, category, risk_score, latitude, longitude, country) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Northline Grocer', 'grocery', 18, 40.730610, -73.935242, 'US'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'MetroFuel 24', 'fuel', 35, 34.052235, -118.243683, 'US'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'VaultByte Exchange', 'crypto', 88, 25.204849, 55.270783, 'AE'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'LuxCart Online', 'ecommerce', 62, 51.507351, -0.127758, 'GB'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Harbor Electronics', 'electronics', 54, 41.878113, -87.629799, 'US'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Atlas ATM Network', 'atm', 72, 1.352083, 103.819839, 'SG');

INSERT INTO cards (id, user_id, last4, network) VALUES
  ('90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1042', 'visa'),
  ('90000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '4421', 'mastercard'),
  ('90000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', '7788', 'visa'),
  ('90000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', '9081', 'amex');
