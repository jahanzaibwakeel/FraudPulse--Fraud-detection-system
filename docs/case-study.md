# FraudPulse Case Study

## Problem

FraudPulse demonstrates how a financial institution can detect suspicious card activity in real time without paid cloud services. The system generates synthetic card transactions, streams them through a local event pipeline, scores risk with explainable rules and statistical features, and gives analysts a live queue for manual review.

## System Design

The architecture separates transaction intake, scoring, simulation, and presentation. Express owns validation, persistence, WebSocket fanout, and API routes. BullMQ on Valkey decouples ingestion from scoring so bursts of transaction traffic do not block the API. PostgreSQL stores the canonical transaction ledger, event log, alert workflow, rule configuration, model versions, and audit trail.

## SQL Design

The database is intentionally normalized around fraud investigation workflows:

- `transactions` is the immutable card activity stream.
- `transaction_events` is the local event ledger for `transaction_created`, `transaction_scored`, `fraud_alert_created`, and dead-letter records.
- `fraud_scores` stores model output, confidence, severity, latency, and explainability JSON.
- `fraud_alerts` tracks analyst status independently from scores.
- `review_decisions` captures feedback for recalibration.
- `scoring_rules` and `model_versions` make scoring behavior inspectable and auditable.

Indexes focus on the hottest queries: user time history, merchant time history, event type time, and alert status time.

## Event Processing

The API inserts each transaction and enqueues a `score-transactions` job. The worker loads recent user history, rules, merchant risk, and the active model version. It writes the score, emits a `transaction_scored` event, and creates a fraud alert when the risk threshold is crossed. Jobs retry three times; final failures are written as `scoring_failed_dead_letter` events and broadcast to the dashboard.

## Scoring Logic

FraudPulse combines deterministic rules with statistical anomaly detection:

- Velocity: too many transactions in a five-minute window.
- Amount anomaly: z-score against recent user spending history.
- Geo-distance anomaly: impossible travel speed between consecutive purchases.
- Merchant risk: higher weight for risky merchant categories or locations.
- User behavior history: unseen device fingerprint in recent history.

Each triggered feature contributes score impact, confidence, description, and evidence. Analysts can see exactly why an alert exists instead of receiving an opaque number.

## Feature Store and Rule Tuning

The scoring worker persists a feature snapshot for each scored transaction. These snapshots capture velocity, spending deviation, geo-speed, merchant risk, device familiarity, and recent user history. Rule changes can be previewed against recent scored samples before being applied, showing projected alert volume, precision, recall, F1, and confusion matrix movement.

## Hybrid ML-Style Model and Drift

FraudPulse uses a local logistic-style model over feature snapshots to compute a model probability and ML score. That output is blended with the rules engine to produce the final score, preserving deterministic explanations while adding feature-interaction sensitivity. Drift monitoring compares the last hour of feature behavior against the previous baseline window, and recalibration writes a new active model version with updated blending parameters.

## Real Local Model Training

The sixth round upgrades the hand-tuned hybrid layer with a true local training workflow. FraudPulse trains logistic regression weights from persisted feature snapshots and labels, using synthetic ground truth unless an analyst review decision overrides the label. The trained artifact stores coefficients, normalization statistics, validation metrics, class balance, and blend settings in `model_versions`. The scoring worker then serves the active trained model in real time while preserving rule explanations and rule-vs-model disagreement analysis.

## Model Explainability

The seventh round adds per-feature contribution explanations for the trained model. Every ML-driven alert carries the top features that raised or lowered fraud probability, including raw values, normalized values, coefficients, and contribution strength. This keeps the local model auditable and gives analysts a reasoned bridge between deterministic rules and learned model behavior.

## Model Registry and Champion/Challenger

The eighth round adds model governance around the existing `model_versions` table. FraudPulse treats the active model as the production champion and inactive versions as challengers. Analysts can shadow-score a challenger against recent feature-store rows to compare precision, recall, F1, alert volume, and disagreement rate before an admin promotes it. Promotion flips the active model and writes an audit event, preserving rollback history.

## Entity Risk Memory

The ninth round adds persistent memory for risky entities. After every scored transaction, the worker updates rolling scores for the user, card, merchant, device fingerprint, and IP address. These scores combine alert severity, transaction velocity, anomaly strength, merchant risk, and recent evidence. This lets FraudPulse recognize entities that become risky over time rather than treating every transaction as an isolated event.

## Case Investigation Workspace

The tenth round turns each alert into an investigation package. A single case endpoint assembles transaction details, feature-store evidence, entity risk memory, related user/card/device/IP activity, merchant alert patterns, recommended actions, notes, reviews, and audit events. Analysts can save evidence snapshots to preserve the exact context they reviewed before confirming fraud or marking a false positive.

## Data Quality and Drift Alerts

The eleventh round adds operational trust checks around the fraud pipeline. FraudPulse continuously computes quality checks for unscored transactions, invalid values, missing entity links, feature-store gaps, orphan events, dead-letter events, delayed scoring, ingestion freshness, scoring lag, and feature drift. Quality runs are persisted, open alerts are deduplicated, and resolved checks close prior alerts. This shows how production fraud systems monitor the health of their inputs and model features, not only their predictions.

## Advanced Simulation Lab

The twelfth round expands demo replay into a configurable campaign lab. Analysts can tune transaction volume, velocity, amount multiplier, fraud rate, device reuse, IP reuse, and target account before launching a campaign. Each run is stored with parameters, expected signals, generated transaction IDs, and completion state. Because campaign transactions still pass through API ingestion, BullMQ scoring, PostgreSQL events, and WebSocket updates, the lab is useful for stress-testing detection behavior rather than only showing static examples.

## Real Model Benchmarking

The thirteenth round adds a local benchmark harness for model selection. FraudPulse compares the rule baseline, trained logistic regression, Gaussian naive Bayes, and nearest-centroid classifiers against the same feature-store validation split. Each benchmark run stores algorithm names, sample counts, confusion matrices, precision, recall, F1, false positive rate, and the best algorithm. This makes model quality conversations evidence-based without requiring paid AutoML or cloud notebooks.

## Production Hardening

The fifth round adds local role-based API tokens, protected Socket.IO connections, service tokens for simulator/worker traffic, per-token rate limiting, audit-log inspection, and downloadable analyst reports. These controls keep the demo runnable on one laptop while showing production instincts: least-privilege mutation routes, operational exports, observable access patterns, and tests for rejected unauthorized access.

## Security Hardening V2

The fourteenth round deepens the local security model. FraudPulse now hashes configured API tokens, compares credentials in constant time, issues expiring local session tokens, tracks failed authentication attempts, creates short lockouts, restricts browser origins, and attaches request IDs to API responses. The Security page exposes active sessions, lockouts, security events, and a token rotation plan that generates replacement `.env` lines without using a paid vault.

## Metrics and Feedback

The API calculates precision, recall, F1, confusion matrix, false positive rate, and true positive rate from synthetic ground truth and scored predictions. Review decisions are captured as feedback for the recalibration script. Prometheus collects throughput, alert count, queue depth, scoring latency, confirmed fraud, and false positives, while Grafana provides an operations view.

## Fraud Ring Detection

The graph layer builds connected components from suspicious transactions by linking users, cards, devices, IP addresses, and merchants. Risk-ranked rings reveal patterns that single-transaction scoring can miss, such as one device touching multiple cards, one IP routing to repeated high-risk merchants, or several users converging on the same merchant during a burst.

## Frontend

The Next.js dashboard is designed as a serious risk operations surface. The first screen is the live monitoring console, with no marketing page. Analysts can watch the transaction stream, inspect alerts, review explanations, make decisions, drill into user and merchant profiles, inspect fraud rings, and monitor model performance.

## Scenario Replay and Case Management

FraudPulse includes replayable fraud campaigns that create real transactions instead of mock dashboard events. Card testing, impossible travel, and account takeover scenarios all pass through API ingestion, queueing, scoring, alert creation, and WebSocket updates. This makes the demo useful for explaining event-driven architecture and for validating whether scoring changes affect detection behavior.

The alert workflow now includes assignment, priority, SLA due time, case notes, review decisions, and audit history. That gives analysts a richer operational loop and makes it easier to explain how human feedback becomes model governance data.

## Analyst Operations

The operations layer adds saved alert queues, SLA breach tracking, analyst workload metrics, bulk assignment, bulk review decisions, and dead-letter replay. This demonstrates how a fraud platform moves beyond detection into queue management, recovery, and repeatable analyst workflows.

## Local-Only Constraint

Every component is free, open-source, and runnable locally: PostgreSQL, Valkey, Node.js, Next.js, BullMQ, Socket.IO, Prometheus, and Grafana OSS. The system uses generated demo data and never calls paid APIs or proprietary cloud services.
