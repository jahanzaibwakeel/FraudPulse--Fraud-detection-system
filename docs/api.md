# FraudPulse API

Base URL in Docker Compose: `http://localhost:14000`

## Authentication

All operational routes require a local token in `x-api-token` or `Authorization: Bearer <token>`. `GET /health` and `GET /metrics` remain public for container health checks and Prometheus scraping.

Default local tokens:

- Viewer: `local-viewer-token`
- Analyst: `local-analyst-token`
- Admin: `local-admin-token`
- Service: `local-service-token`

Mutation routes enforce role checks. Simulator ingestion and worker broadcasts use the service token.

## Health and Metrics

- `GET /health` returns API and database health.
- `GET /metrics` exposes Prometheus metrics.
- `GET /security/session` returns the authenticated local principal.
- `GET /security/rate-limits` returns active rate-limit buckets. Requires admin.
- `GET /security/audit?limit=80` returns recent audit logs. Requires analyst.

## Transactions

`POST /transactions`

Creates a transaction, writes `transaction_created`, and enqueues scoring.

```json
{
  "userId": "11111111-1111-1111-1111-111111111111",
  "cardId": "90000000-0000-0000-0000-000000000001",
  "merchantId": "cccccccc-cccc-cccc-cccc-cccccccccccc",
  "amount": 940.25,
  "currency": "USD",
  "latitude": 25.204849,
  "longitude": 55.270783,
  "channel": "ecommerce",
  "deviceFingerprint": "device-risk-3841",
  "ipAddress": "45.18.22.91",
  "isFraudGroundTruth": true
}
```

`GET /transactions?limit=80` returns recent transactions with merchant and score data.

`GET /transactions/stream` exposes Server-Sent Events for local clients that prefer SSE over Socket.IO.

## Fraud Alerts

- `GET /alerts` returns the review queue.
- `GET /alerts?status=pending` filters by review state.
- `GET /alerts?severity=critical&assignedTo=unassigned&overdue=true` supports operations filters.
- `GET /alerts/:id` returns alert detail with transaction, user, merchant, and explainability data.
- `POST /alerts/:id/assign` sets owner, priority, and SLA due time.
- `POST /alerts/:id/notes` appends an analyst note to the case timeline.
- `POST /alerts/:id/review` records analyst feedback.
- `POST /alerts/bulk/assign` assigns many alerts at once.
- `POST /alerts/bulk/review` records the same decision across many alerts.
- `GET /alert-views` lists saved alert queues.
- `POST /alert-views` creates a saved alert queue.
- `DELETE /alert-views/:id` deletes a saved alert queue.
- `GET /cases/:alertId/evidence` returns the investigation evidence bundle for an alert.
- `POST /cases/:alertId/evidence-snapshots` saves a point-in-time evidence bundle snapshot. Requires analyst.
- `GET /operations/sla` returns SLA, breach, and workload rollups.
- `GET /dlq/events` lists dead-letter scoring events.
- `POST /dlq/events/:id/replay` requeues a failed scoring event.

```json
{
  "decision": "confirmed_fraud",
  "analyst": "casey.ops",
  "notes": "Cardholder denied purchase and device was new."
}
```

Assignment:

```json
{
  "assignedTo": "casey.ops",
  "priority": 2,
  "slaHours": 8,
  "actor": "lead.analyst"
}
```

Case note:

```json
{
  "author": "casey.ops",
  "note": "Customer travel history does not support the overseas transaction."
}
```

## Profiles and Governance

- `GET /profiles/users/:id` returns user risk history.
- `GET /profiles/merchants/:id` returns merchant risk analysis.
- `GET /risk/entities?type=user` returns rolling entity risk memory for users, cards, merchants, devices, or IPs.
- `GET /risk/entities/:type/:id` returns one entity memory record and recent related transactions.
- `GET /rules` returns active scoring rules.
- `PATCH /rules/:code` updates rule status or weight.
- `POST /rules/preview` estimates alert and metric changes for proposed rule weights.
- `GET /features/overview` returns feature-store aggregates and top anomalies.
- `GET /features/transactions/:id` returns the feature snapshot for one transaction.
- `GET /metrics/model` returns precision, recall, F1, confusion matrix, FPR, and TPR.
- `GET /models/hybrid` returns active model settings, rule/ML/blended score summaries, disagreements, and aggregated trained-model feature drivers.
- `GET /models/registry` lists champion and challenger model versions.
- `POST /models/:id/shadow-score` compares a model against the active champion on recent feature-store rows. Requires analyst.
- `POST /models/:id/promote` promotes a model version to champion. Requires admin.
- `GET /models/drift` returns current-vs-baseline feature drift.
- `POST /models/recalibrate` creates a new active local model version.
- `POST /models/train` trains and activates a local logistic regression model from feature-store history. Requires admin.
- `GET /quality/overview` returns current data quality checks, open quality alerts, recent runs, and drift summary.
- `POST /quality/run` persists a data quality run and opens or resolves quality alerts. Requires analyst.
- `GET /graph/rings?lookbackHours=24&minScore=55` returns connected suspicious entity clusters.
- `GET /admin/overview` returns dashboard rollups and queue counts.
- `GET /reports/alerts.csv?lookbackHours=24` exports protected alert/case data. Requires analyst.
- `GET /reports/model.json` exports model version, metrics, confusion matrix, and feature summary. Requires analyst.
- `GET /simulator/state` returns whether demo generation is running.
- `POST /simulator/control` pauses or resumes simulator generation with `{ "action": "pause" }` or `{ "action": "resume" }`.
- `GET /simulator/scenarios` lists replayable fraud campaigns.
- `POST /simulator/scenarios/:id/run` injects a named campaign into the real transaction/scoring pipeline.

Available scenario ids:

- `card_testing_burst`
- `impossible_travel`
- `account_takeover`

## WebSocket Events

Connect to `ws://localhost:14000` with Socket.IO.

- `transaction_created`
- `transaction_scored`
- `fraud_alert_created`
- `review_decision_recorded`
- `scoring_failed_dead_letter`
- `scenario_replay_started`
- `case_assigned`
- `case_note_added`
