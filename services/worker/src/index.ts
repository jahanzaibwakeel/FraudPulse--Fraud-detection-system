import express from "express";
import { Queue, Worker } from "bullmq";
import { config } from "./config.js";
import { query } from "./db.js";
import { logger } from "./logger.js";
import { confirmedFraud, falsePositive, queueDepth, registry, scoringLatency, workerAlerts } from "./metrics.js";
import { scoreHybridModel, type HybridModelParameters } from "./modelScoring.js";
import { buildFeatureVector, scoreTransaction } from "./scoring.js";

const valkey = new URL(config.valkeyUrl);
const connection = {
  host: valkey.hostname,
  port: Number(valkey.port || 6379),
  password: valkey.password || undefined,
  maxRetriesPerRequest: null
};
const scoringQueue = new Queue("score-transactions", { connection });

type TransactionRow = {
  id: string;
  user_id: string;
  card_id: string;
  merchant_id: string;
  amount: string | number;
  occurred_at: string;
  latitude: string | number;
  longitude: string | number;
  device_fingerprint: string;
  ip_address: string;
  merchant_name: string;
  merchant_category: string;
  risk_score: string | number;
};

type RecentTransactionRow = {
  id: string;
  amount: string | number;
  occurred_at: string;
  latitude: string | number;
  longitude: string | number;
  device_fingerprint: string;
};

type RuleRowRecord = {
  code: string;
  weight: string | number;
  enabled: boolean;
  threshold: Record<string, number | undefined>;
};

type ModelRowRecord = {
  id: string;
  version: string;
  parameters: HybridModelParameters;
};

const broadcast = async (event: string, payload: unknown) => {
  try {
    await fetch(`${config.apiUrl}/internal/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-token": config.apiServiceToken },
      body: JSON.stringify({ event, payload })
    });
  } catch (err) {
    logger.warn({ err, event }, "broadcast_failed");
  }
};

const clampRisk = (value: number) => Math.max(0, Math.min(99, Number(value.toFixed(2))));

const updateEntityRiskMemory = async (
  tx: TransactionRow,
  result: { score: number; severity: string; reasons: unknown[] },
  featureVector: { velocity5m: number; velocity1h: number; amountZscore: number; geoKmh: number; merchantRisk: number; deviceSeen: boolean }
) => {
  const alertCount = result.score >= 55 ? 1 : 0;
  const velocityScore = clampRisk(featureVector.velocity5m * 7 + featureVector.velocity1h * 1.2);
  const anomalyScore = clampRisk(Math.max(featureVector.amountZscore, 0) * 16 + Math.min(featureVector.geoKmh / 35, 35));
  const alertScore = clampRisk(result.score >= 55 ? result.score : result.score * 0.35);
  const reviewScore = 0;
  const riskScore = clampRisk(alertScore * 0.58 + velocityScore * 0.14 + anomalyScore * 0.18 + featureVector.merchantRisk * 0.1);
  const evidence = {
    transactionId: tx.id,
    score: result.score,
    severity: result.severity,
    velocity5m: featureVector.velocity5m,
    velocity1h: featureVector.velocity1h,
    amountZscore: featureVector.amountZscore,
    geoKmh: featureVector.geoKmh,
    merchantRisk: featureVector.merchantRisk,
    deviceSeen: featureVector.deviceSeen,
    reasonCount: result.reasons.length
  };
  const entities = [
    { type: "user", id: tx.user_id },
    { type: "card", id: tx.card_id },
    { type: "merchant", id: tx.merchant_id },
    { type: "device", id: tx.device_fingerprint },
    { type: "ip", id: tx.ip_address }
  ];
  for (const entity of entities) {
    await query(
      `INSERT INTO entity_risk_memory
        (entity_type, entity_id, risk_score, velocity_score, anomaly_score, alert_score, review_score,
         transaction_count, alert_count, last_seen_at, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         risk_score = LEAST(99, entity_risk_memory.risk_score * 0.82 + EXCLUDED.risk_score * 0.18 + CASE WHEN EXCLUDED.alert_count > 0 THEN 2 ELSE 0 END),
         velocity_score = LEAST(99, entity_risk_memory.velocity_score * 0.78 + EXCLUDED.velocity_score * 0.22),
         anomaly_score = LEAST(99, entity_risk_memory.anomaly_score * 0.78 + EXCLUDED.anomaly_score * 0.22),
         alert_score = LEAST(99, entity_risk_memory.alert_score * 0.82 + EXCLUDED.alert_score * 0.18),
         review_score = LEAST(99, entity_risk_memory.review_score * 0.95 + EXCLUDED.review_score * 0.05),
         transaction_count = entity_risk_memory.transaction_count + 1,
         alert_count = entity_risk_memory.alert_count + EXCLUDED.alert_count,
         last_seen_at = EXCLUDED.last_seen_at,
         evidence = EXCLUDED.evidence,
         updated_at = now()`,
      [
        entity.type,
        entity.id,
        riskScore,
        velocityScore,
        anomalyScore,
        alertScore,
        reviewScore,
        alertCount,
        tx.occurred_at,
        evidence
      ]
    );
  }
};

const worker = new Worker(
  "score-transactions",
  async job => {
    const { transactionId } = job.data as { transactionId: string };
    const started = Date.now();
    const txResult = await query<TransactionRow>(
      `SELECT t.*, m.name AS merchant_name, m.category AS merchant_category, m.risk_score
       FROM transactions t JOIN merchants m ON m.id = t.merchant_id
       WHERE t.id = $1`,
      [transactionId]
    );
    if (!txResult.rowCount) throw new Error(`transaction_not_found:${transactionId}`);
    const tx = txResult.rows[0];
    const [recent, rules, model] = await Promise.all([
      query<RecentTransactionRow>(
        `SELECT id, amount, occurred_at, latitude, longitude, device_fingerprint
         FROM transactions
         WHERE user_id = $1 AND occurred_at >= now() - interval '30 days'
         ORDER BY occurred_at DESC
         LIMIT 80`,
        [tx.user_id]
      ),
      query<RuleRowRecord>("SELECT code, weight, enabled, threshold FROM scoring_rules"),
      query<ModelRowRecord>("SELECT id, version, parameters FROM model_versions WHERE active = true ORDER BY created_at DESC LIMIT 1")
    ]);
    const activeModel = model.rows[0];
    const result = scoreTransaction({
      transaction: tx,
      merchant: { name: tx.merchant_name, category: tx.merchant_category, risk_score: Number(tx.risk_score) },
      recentTransactions: recent.rows,
      rules: rules.rows,
      modelVersion: activeModel?.version ?? "hybrid-logit-v1"
    });
    const featureVector = buildFeatureVector({
      transaction: tx,
      merchant: { name: tx.merchant_name, category: tx.merchant_category, risk_score: Number(tx.risk_score) },
      recentTransactions: recent.rows,
      rules: rules.rows,
      modelVersion: activeModel?.version ?? "hybrid-logit-v1"
    });
    const ruleScore = result.score;
    const hybrid = scoreHybridModel(featureVector, ruleScore, activeModel?.parameters);
    result.score = hybrid.blendedScore;
    result.confidence = Number(Math.min(0.99, (result.confidence + hybrid.modelProbability) / 2).toFixed(3));
    result.severity = result.score >= 90 ? "critical" : result.score >= 75 ? "high" : result.score >= 55 ? "medium" : "low";
    result.modelVersion = activeModel?.version ?? "hybrid-logit-v1";
    if (hybrid.mlScore >= 70) {
      result.reasons.push({
        rule: "hybrid_ml_model",
        scoreImpact: Number((hybrid.mlScore * (1 - hybrid.blendRuleWeight)).toFixed(2)),
        confidence: hybrid.modelProbability,
        description: activeModel?.parameters?.modelKind === "trained_logistic_regression"
          ? "Trained local model detected fraud risk from feature contributions."
          : "Hybrid local model detected a high fraud probability from feature interactions.",
        evidence: {
          modelKind: activeModel?.parameters?.modelKind ?? "hand_tuned_logistic",
          linearScore: hybrid.linearScore,
          modelProbability: hybrid.modelProbability,
          mlScore: hybrid.mlScore,
          ruleScore,
          blendedScore: hybrid.blendedScore,
          topContributions: hybrid.featureContributions.slice(0, 5)
        }
      });
    }
    result.latencyMs = Date.now() - started;

    const scoreRow = await query<{ id: string }>(
      `INSERT INTO fraud_scores (transaction_id, score, confidence, severity, reasons, model_version_id, latency_ms, rule_score, ml_score, model_probability, blended_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (transaction_id) DO UPDATE SET
         score = EXCLUDED.score,
         confidence = EXCLUDED.confidence,
         severity = EXCLUDED.severity,
         reasons = EXCLUDED.reasons,
         latency_ms = EXCLUDED.latency_ms,
         rule_score = EXCLUDED.rule_score,
         ml_score = EXCLUDED.ml_score,
         model_probability = EXCLUDED.model_probability,
         blended_score = EXCLUDED.blended_score
       RETURNING id`,
      [
        result.transactionId,
        result.score,
        result.confidence,
        result.severity,
        JSON.stringify(result.reasons),
        activeModel?.id ?? null,
        result.latencyMs,
        ruleScore,
        hybrid.mlScore,
        hybrid.modelProbability,
        hybrid.blendedScore
      ]
    );
    await query("UPDATE transactions SET status = 'scored' WHERE id = $1", [transactionId]);
    await query(
      `INSERT INTO transaction_features
        (transaction_id, user_id, merchant_id, features, velocity_5m, velocity_1h, user_tx_30d, amount_mean,
         amount_stddev, amount_zscore, geo_distance_km, geo_kmh, merchant_risk, device_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (transaction_id) DO UPDATE SET
         features = EXCLUDED.features,
         velocity_5m = EXCLUDED.velocity_5m,
         velocity_1h = EXCLUDED.velocity_1h,
         user_tx_30d = EXCLUDED.user_tx_30d,
         amount_mean = EXCLUDED.amount_mean,
         amount_stddev = EXCLUDED.amount_stddev,
         amount_zscore = EXCLUDED.amount_zscore,
         geo_distance_km = EXCLUDED.geo_distance_km,
         geo_kmh = EXCLUDED.geo_kmh,
         merchant_risk = EXCLUDED.merchant_risk,
         device_seen = EXCLUDED.device_seen`,
      [
        transactionId,
        tx.user_id,
        tx.merchant_id,
        featureVector,
        featureVector.velocity5m,
        featureVector.velocity1h,
        featureVector.userTx30d,
        featureVector.amountMean,
        featureVector.amountStddev,
        featureVector.amountZscore,
        featureVector.geoDistanceKm,
        featureVector.geoKmh,
        featureVector.merchantRisk,
        featureVector.deviceSeen
      ]
    );
    await updateEntityRiskMemory(tx, result, featureVector);
    await query(
      "INSERT INTO transaction_events (transaction_id, event_type, payload) VALUES ($1,'transaction_scored',$2)",
      [transactionId, result]
    );
    scoringLatency.observe(result.latencyMs);
    await broadcast("transaction_scored", result);

    if (result.score >= 55) {
      const alert = await query(
        `INSERT INTO fraud_alerts (transaction_id, user_id, merchant_id, fraud_score_id, severity, score, confidence, reasons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (transaction_id) DO UPDATE SET
           severity = EXCLUDED.severity,
           score = EXCLUDED.score,
           confidence = EXCLUDED.confidence,
           reasons = EXCLUDED.reasons,
           updated_at = now()
         RETURNING *`,
        [transactionId, tx.user_id, tx.merchant_id, scoreRow.rows[0].id, result.severity, result.score, result.confidence, JSON.stringify(result.reasons)]
      );
      await query(
        "INSERT INTO transaction_events (transaction_id, event_type, payload) VALUES ($1,'fraud_alert_created',$2)",
        [transactionId, alert.rows[0]]
      );
      workerAlerts.inc({ severity: result.severity });
      await broadcast("fraud_alert_created", alert.rows[0]);
    }
    return result;
  },
  { connection, concurrency: 8 }
);

worker.on("failed", async (job, err) => {
  const transactionId = job?.data?.transactionId ?? null;
  logger.error({ err, transactionId, jobId: job?.id }, "scoring_job_failed");
  if (job && job.attemptsMade >= 3) {
    await query(
      "INSERT INTO transaction_events (transaction_id, event_type, payload, error) VALUES ($1,'scoring_failed_dead_letter',$2,$3)",
      [transactionId, job.data, err.message]
    );
    await broadcast("scoring_failed_dead_letter", { transactionId, error: err.message });
  }
});

const metricsApp = express();
metricsApp.get("/metrics", async (_req, res) => {
  const counts = await scoringQueue.getJobCounts("waiting", "delayed");
  queueDepth.set((counts.waiting ?? 0) + (counts.delayed ?? 0));
  const decisions = await query(
    `SELECT
      count(*) FILTER (WHERE decision = 'confirmed_fraud') AS confirmed,
      count(*) FILTER (WHERE decision = 'false_positive') AS false_positive
     FROM review_decisions`
  );
  confirmedFraud.set(Number(decisions.rows[0].confirmed));
  falsePositive.set(Number(decisions.rows[0].false_positive));
  res.set("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

metricsApp.listen(config.metricsPort, () => {
  logger.info({ port: config.metricsPort }, "worker_metrics_listening");
});

logger.info("scoring_worker_started");
