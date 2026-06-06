# FraudPulse Demo Walkthrough

This walkthrough is tuned for a 6 to 8 minute recruiter or portfolio demo.

## 1. Open With The Live Dashboard

Start at http://localhost:13000.

Show the live transaction feed, alert stream, queue status, and scenario controls. Explain that the simulator is continuously generating synthetic card transactions and that every transaction flows through the same API, PostgreSQL event table, Valkey queue, scoring worker, and WebSocket path.

## 2. Trigger A Fraud Scenario

Use the scenario controls on the dashboard or the Simulation Lab page.

Recommended scenario: `Impossible travel` or `Card testing burst`.

Point out that this is not a static mock. The campaign writes real transaction records, scoring jobs, events, feature snapshots, fraud scores, and alerts.

## 3. Investigate An Alert

Open the Alert Center, then click a pending alert.

Show:

- Severity and score
- Rule explanations
- Model feature contributions
- Evidence bundle
- Related device, IP, user, card, and merchant activity
- Analyst notes and manual review decision

Explain that the system detects suspicious card-payment behavior, not email phishing or identity-document fraud.

## 4. Show Model Governance

Open Model Performance, Model Registry, and Model Benchmarks.

Highlight:

- Precision, recall, F1, false positive rate, and confusion matrix
- Rule-vs-model disagreement
- Local model training from feature-store labels
- Champion/challenger shadow scoring
- Benchmark comparison across rule baseline, logistic regression, Gaussian naive Bayes, and nearest centroid

## 5. Show Operations And Reliability

Open Operations and Data Quality.

Show SLA queues, dead-letter replay, data quality checks, drift alerts, delayed scoring checks, and feature-store freshness. Explain that fraud systems need operational trust, not only a model score.

## 6. Show Security Hardening

Open Security.

Show local roles, active sessions, request IDs, rate-limit buckets, security events, token rotation planning, and protected report exports. Explain that everything runs locally with open-source tools and no paid APIs.

## 7. Close With System Design

Use the README architecture diagram and the case study. Summarize the core design:

- Express API validates and persists transaction intake.
- PostgreSQL stores the ledger, event log, alerts, decisions, models, and audit data.
- BullMQ and Valkey decouple scoring from ingestion.
- Worker computes rules, anomaly features, model score, explanations, and alerts.
- Socket.IO updates the dashboard in real time.
- Prometheus and Grafana expose operational metrics.

## Quick Commands

```bash
docker compose up -d --build
npm run smoke
npm run screenshots
```
