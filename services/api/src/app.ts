import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { Server } from "socket.io";
import { z } from "zod";
import { trainFraudLogisticModel, TransactionInputSchema, type FraudTrainingSample, type TransactionInput } from "@fraudpulse/shared";
import { config } from "./config.js";
import { query } from "./db.js";
import { logger } from "./logger.js";
import { alertCount, registry, reviewDecisions, transactionThroughput } from "./metrics.js";
import { scoringQueue } from "./queue.js";
import { buildFraudRingGraph, type SuspiciousTransactionRow } from "./ringGraph.js";
import { buildScenarioTransactions, scenarios, type DemoAccount, type DemoMerchant, type ScenarioBuildOptions } from "./scenarios.js";
import { createSecurity } from "./security.js";

const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
};

const toCsv = (rows: Record<string, unknown>[], columns: string[]) => [
  columns.map(csvCell).join(","),
  ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))
].join("\n");

type TrainingRow = {
  actual: boolean;
  rule_score: string | number | null;
  velocity_5m: string | number;
  velocity_1h: string | number;
  user_tx_30d: string | number;
  amount_zscore: string | number;
  geo_kmh: string | number;
  merchant_risk: string | number;
  device_seen: boolean;
};

type RegistryModelRow = {
  id: string;
  version: string;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown>;
  active: boolean;
  created_at: string;
};

type ShadowRunRow = {
  id: string;
  candidate_model_id: string;
  champion_model_id: string;
  candidate_version: string;
  champion_version: string;
  sample_size: number;
  alert_threshold: string | number;
  candidate: Record<string, unknown>;
  champion: Record<string, unknown>;
  alert_delta: number;
  disagreement_count: number;
  disagreement_rate: string | number;
  created_by: string;
  created_at: string;
};

type ShadowFeatureRow = {
  actual: boolean;
  rule_score: string | number | null;
  velocity_5m: string | number;
  velocity_1h: string | number;
  user_tx_30d: string | number;
  amount_zscore: string | number;
  geo_kmh: string | number;
  merchant_risk: string | number;
  device_seen: boolean;
};

const toTrainingSample = (row: TrainingRow): FraudTrainingSample => ({
  actual: row.actual,
  ruleScore: Number(row.rule_score ?? 0),
  features: {
    velocity5m: Number(row.velocity_5m),
    velocity1h: Number(row.velocity_1h),
    userTx30d: Number(row.user_tx_30d),
    amountZscore: Number(row.amount_zscore),
    geoKmh: Number(row.geo_kmh),
    merchantRisk: Number(row.merchant_risk),
    deviceSeen: row.device_seen
  }
});

const modelFeatureNames = ["velocity5m", "velocity1h", "amountZscore", "geoKmh", "merchantRisk", "newDevice", "userTx30d"];

const sigmoid = (value: number) => {
  if (value < -35) return 0;
  if (value > 35) return 1;
  return 1 / (1 + Math.exp(-value));
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const featureValue = (row: ShadowFeatureRow, feature: string) => {
  if (feature === "newDevice") return row.device_seen ? 0 : 1;
  if (feature === "velocity5m") return Math.min(Math.max(Number(row.velocity_5m), 0), 100);
  if (feature === "velocity1h") return Math.min(Math.max(Number(row.velocity_1h), 0), 400);
  if (feature === "amountZscore") return clamp(Number(row.amount_zscore), -5, 8);
  if (feature === "geoKmh") return Math.min(Math.max(Number(row.geo_kmh), 0), 2500);
  if (feature === "merchantRisk") return clamp(Number(row.merchant_risk), 0, 100);
  return Math.min(Math.max(Number(row.user_tx_30d), 0), 150);
};

const scoreModelVersion = (model: RegistryModelRow, row: ShadowFeatureRow) => {
  const parameters = model.parameters ?? {};
  const coefficients = parameters.coefficients as Record<string, number> | undefined;
  const normalization = parameters.normalization as Record<string, { mean: number; scale: number }> | undefined;
  const featureNames = Array.isArray(parameters.featureNames) ? parameters.featureNames.map(String) : modelFeatureNames;
  const bias = Number(coefficients?.bias ?? -2.35);
  const linear = featureNames.reduce((sum, feature) => {
    const raw = featureValue(row, feature);
    const stats = normalization?.[feature];
    const value = stats ? (raw - Number(stats.mean ?? 0)) / Math.max(Number(stats.scale ?? 1), 0.0001) : raw;
    return sum + Number(coefficients?.[feature] ?? 0) * value;
  }, bias);
  const probability = sigmoid(linear);
  const mlScore = clamp(probability * 100, 0, 99);
  const blendRuleWeight = clamp(Number(parameters.blendRuleWeight ?? 0.62), 0.05, 0.95);
  const ruleScore = Number(row.rule_score ?? 0);
  return {
    probability,
    mlScore,
    blendedScore: clamp(ruleScore * blendRuleWeight + mlScore * (1 - blendRuleWeight), 0, 99)
  };
};

const metricSummary = (predictions: Array<{ actual: boolean; predicted: boolean }>) => {
  const matrix = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (const prediction of predictions) {
    if (prediction.actual && prediction.predicted) matrix.truePositive += 1;
    else if (!prediction.actual && prediction.predicted) matrix.falsePositive += 1;
    else if (!prediction.actual && !prediction.predicted) matrix.trueNegative += 1;
    else matrix.falseNegative += 1;
  }
  const { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn } = matrix;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  return {
    precision,
    recall,
    f1Score: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    falsePositiveRate: fp + tn === 0 ? 0 : fp / (fp + tn),
    truePositiveRate: recall,
    confusionMatrix: matrix
  };
};

type BenchmarkAlgorithm = "rule_baseline" | "logistic_regression" | "gaussian_naive_bayes" | "nearest_centroid";

const benchmarkFeatureNames = ["velocity5m", "velocity1h", "amountZscore", "geoKmh", "merchantRisk", "newDevice", "userTx30d"] as const;

type BenchmarkFeatureName = typeof benchmarkFeatureNames[number];

const benchmarkFeatureValue = (sample: FraudTrainingSample, feature: BenchmarkFeatureName) => {
  if (feature === "velocity5m") return Math.min(Math.max(sample.features.velocity5m, 0), 100);
  if (feature === "velocity1h") return Math.min(Math.max(sample.features.velocity1h, 0), 400);
  if (feature === "amountZscore") return clamp(sample.features.amountZscore, -5, 8);
  if (feature === "geoKmh") return Math.min(Math.max(sample.features.geoKmh, 0), 2500);
  if (feature === "merchantRisk") return clamp(sample.features.merchantRisk, 0, 100);
  if (feature === "newDevice") return sample.features.deviceSeen ? 0 : 1;
  return Math.min(Math.max(sample.features.userTx30d, 0), 150);
};

const benchmarkStats = (samples: FraudTrainingSample[]) => {
  const normalization = benchmarkFeatureNames.reduce((acc, feature) => {
    const values = samples.map(sample => benchmarkFeatureValue(sample, feature));
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);
    acc[feature] = { mean, scale: Math.max(Math.sqrt(variance), 0.0001) };
    return acc;
  }, {} as Record<BenchmarkFeatureName, { mean: number; scale: number }>);
  return normalization;
};

const benchmarkVector = (
  sample: FraudTrainingSample,
  normalization: Record<BenchmarkFeatureName, { mean: number; scale: number }>
) => benchmarkFeatureNames.map(feature => {
  const stats = normalization[feature];
  return (benchmarkFeatureValue(sample, feature) - stats.mean) / stats.scale;
});

const benchmarkConfusion = (
  samples: FraudTrainingSample[],
  predicted: (sample: FraudTrainingSample) => boolean
) => metricSummary(samples.map(sample => ({ actual: sample.actual, predicted: predicted(sample) })));

const evaluateGaussianNaiveBayes = (train: FraudTrainingSample[], validation: FraudTrainingSample[]) => {
  const byClass = {
    fraud: train.filter(sample => sample.actual),
    legit: train.filter(sample => !sample.actual)
  };
  const classStats = (samples: FraudTrainingSample[]) => benchmarkFeatureNames.reduce((acc, feature) => {
    const values = samples.map(sample => benchmarkFeatureValue(sample, feature));
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);
    acc[feature] = { mean, variance: Math.max(variance, 0.0001) };
    return acc;
  }, {} as Record<BenchmarkFeatureName, { mean: number; variance: number }>);
  const stats = { fraud: classStats(byClass.fraud), legit: classStats(byClass.legit) };
  const priorFraud = Math.max(byClass.fraud.length / Math.max(train.length, 1), 0.0001);
  const priorLegit = Math.max(byClass.legit.length / Math.max(train.length, 1), 0.0001);
  const logLikelihood = (sample: FraudTrainingSample, kind: "fraud" | "legit") => {
    const prior = kind === "fraud" ? priorFraud : priorLegit;
    return benchmarkFeatureNames.reduce((sum, feature) => {
      const value = benchmarkFeatureValue(sample, feature);
      const { mean, variance } = stats[kind][feature];
      return sum - 0.5 * Math.log(2 * Math.PI * variance) - ((value - mean) ** 2) / (2 * variance);
    }, Math.log(prior));
  };
  return benchmarkConfusion(validation, sample => logLikelihood(sample, "fraud") >= logLikelihood(sample, "legit"));
};

const evaluateNearestCentroid = (train: FraudTrainingSample[], validation: FraudTrainingSample[]) => {
  const normalization = benchmarkStats(train);
  const centroid = (samples: FraudTrainingSample[]) => {
    const vectors = samples.map(sample => benchmarkVector(sample, normalization));
    return benchmarkFeatureNames.map((_feature, index) =>
      vectors.reduce((sum, vector) => sum + vector[index], 0) / Math.max(vectors.length, 1)
    );
  };
  const fraudCentroid = centroid(train.filter(sample => sample.actual));
  const legitCentroid = centroid(train.filter(sample => !sample.actual));
  const distance = (vector: number[], target: number[]) =>
    Math.sqrt(vector.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0));
  return benchmarkConfusion(validation, sample => {
    const vector = benchmarkVector(sample, normalization);
    return distance(vector, fraudCentroid) <= distance(vector, legitCentroid);
  });
};

const benchmarkModels = (
  samples: FraudTrainingSample[],
  algorithms: BenchmarkAlgorithm[],
  alertThreshold: number
) => {
  if (samples.length < 50) throw new Error("benchmark_requires_at_least_50_samples");
  if (!samples.some(sample => sample.actual) || !samples.some(sample => !sample.actual)) {
    throw new Error("benchmark_requires_both_fraud_and_legitimate_samples");
  }
  const train = samples.filter((_sample, index) => index % 5 !== 0);
  const validation = samples.filter((_sample, index) => index % 5 === 0);
  const evalSet = validation.length ? validation : train;
  const results = algorithms.map(algorithm => {
    if (algorithm === "rule_baseline") {
      return {
        algorithm,
        label: "Rule Baseline",
        metrics: benchmarkConfusion(evalSet, sample => sample.ruleScore >= alertThreshold),
        notes: "Current rules-only score at the production alert threshold."
      };
    }
    if (algorithm === "logistic_regression") {
      const trained = trainFraudLogisticModel(samples, { alertThreshold, blendRuleWeight: 0.48 });
      return {
        algorithm,
        label: "Logistic Regression",
        metrics: trained.metrics,
        notes: "Local SGD logistic regression trained from feature-store labels."
      };
    }
    if (algorithm === "gaussian_naive_bayes") {
      return {
        algorithm,
        label: "Gaussian Naive Bayes",
        metrics: evaluateGaussianNaiveBayes(train, evalSet),
        notes: "Local probabilistic baseline assuming independent numeric features."
      };
    }
    return {
      algorithm,
      label: "Nearest Centroid",
      metrics: evaluateNearestCentroid(train, evalSet),
      notes: "Local distance baseline comparing samples to fraud and legitimate centroids."
    };
  });
  const best = [...results].sort((a, b) => {
    const f1Delta = Number(b.metrics.f1Score) - Number(a.metrics.f1Score);
    if (Math.abs(f1Delta) > 0.0001) return f1Delta;
    return Number(b.metrics.recall) - Number(a.metrics.recall);
  })[0];
  return { trainSize: train.length, validationSize: evalSet.length, results, bestAlgorithm: best?.algorithm ?? null };
};

type DriftRow = {
  current: Record<string, unknown>;
  baseline: Record<string, unknown>;
  current_count: string | number;
  baseline_count: string | number;
};

type QualityCheck = {
  code: string;
  label: string;
  status: "pass" | "warn" | "fail";
  severity: "low" | "medium" | "high" | "critical";
  value: number;
  threshold: number;
  description: string;
  evidence: Record<string, unknown>;
};

const qualityStatus = (value: number, warn: number, fail: number) => {
  if (value >= fail) return "fail" as const;
  if (value >= warn) return "warn" as const;
  return "pass" as const;
};

const qualitySeverity = (status: QualityCheck["status"], critical = false) => {
  if (status === "fail") return critical ? "critical" : "high";
  if (status === "warn") return "medium";
  return "low";
};

const buildDriftSummary = (row: DriftRow) => {
  const current = row.current ?? {};
  const baseline = row.baseline ?? {};
  const features = ["velocity_5m", "amount_zscore", "geo_kmh", "merchant_risk", "new_device_rate"];
  const drift = features.map(feature => {
    const currentValue = Number(current[feature] ?? 0);
    const baselineValue = Number(baseline[feature] ?? 0);
    const absoluteDelta = currentValue - baselineValue;
    const relativeDelta = baselineValue === 0 ? (currentValue === 0 ? 0 : 1) : absoluteDelta / Math.abs(baselineValue);
    const severity = Math.abs(relativeDelta) >= 0.5 ? "high" : Math.abs(relativeDelta) >= 0.2 ? "medium" : "low";
    return { feature, currentValue, baselineValue, absoluteDelta, relativeDelta, severity };
  });
  const driftIndex = drift.reduce((sum, item) => sum + Math.min(Math.abs(item.relativeDelta), 2), 0) / Math.max(drift.length, 1);
  return {
    currentCount: Number(row.current_count),
    baselineCount: Number(row.baseline_count),
    driftIndex,
    status: driftIndex >= 0.5 ? "high" : driftIndex >= 0.2 ? "medium" : "low",
    drift
  };
};

export const createApp = () => {
  const app = express();
  const server = http.createServer(app);
  const socketOrigins = config.allowedOrigins.includes("*") ? "*" : config.allowedOrigins;
  const io = new Server(server, { cors: { origin: socketOrigins } });
  let simulatorRunning = true;
  const security = createSecurity(config);

  app.use(security.requestId);
  app.use(cors({
    origin: (origin, callback) => {
      const allowed = !origin || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
      callback(null, allowed);
    },
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Token", "X-Session-Token", "X-Request-Id"],
    exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "X-Request-Id"]
  }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));
  app.set("io", io);

  io.use(security.authenticateSocket);
  io.on("connection", socket => {
    socket.emit("system", { status: "connected", actor: socket.data.auth?.actor, at: new Date().toISOString() });
  });

  const createTransaction = async (input: TransactionInput, source = "api") => {
    const tx = await query<{ id: string }>(
      `INSERT INTO transactions
        (user_id, card_id, merchant_id, amount, currency, occurred_at, latitude, longitude, channel, device_fingerprint, ip_address, is_fraud_ground_truth)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, now()),$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        input.userId,
        input.cardId,
        input.merchantId,
        input.amount,
        input.currency,
        input.occurredAt,
        input.latitude,
        input.longitude,
        input.channel,
        input.deviceFingerprint,
        input.ipAddress,
        input.isFraudGroundTruth ?? false
      ]
    );
    const transactionId = tx.rows[0].id;
    await query(
      "INSERT INTO transaction_events (transaction_id, event_type, payload) VALUES ($1, 'transaction_created', $2)",
      [transactionId, { ...input, source }]
    );
    await scoringQueue.add("score", { transactionId, source });
    transactionThroughput.inc();
    io.emit("transaction_created", { transactionId, source });
    return transactionId;
  };

  app.get("/health", async (_req, res) => {
    await query("SELECT 1");
    res.json({ status: "ok", service: "fraudpulse-api", at: new Date().toISOString() });
  });

  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });

  app.use(security.rateLimit);
  app.post("/security/sessions", security.createSession);
  app.use(security.requireAuth());

  app.get("/security/session", (req, res) => {
    res.json(security.session(req));
  });

  app.delete("/security/sessions/current", security.revokeCurrentSession);

  app.get("/security/rate-limits", security.requireAuth("admin"), (_req, res) => {
    res.json(security.rateLimitSnapshot());
  });

  app.get("/security/status", security.requireAuth("admin"), (_req, res) => {
    res.json(security.securitySnapshot());
  });

  app.get("/security/events", security.requireAuth("admin"), (req, res) => {
    res.json(security.securityEvents(Math.min(Number(req.query.limit ?? 100), 200)));
  });

  app.post("/security/token-rotation-plan", security.requireAuth("admin"), (req, res) => {
    res.status(201).json(security.tokenRotationPlan(req.auth?.actor ?? "unknown"));
  });

  app.get("/security/audit", security.requireAuth("analyst"), async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 80), 250);
    const actor = req.query.actor ? String(req.query.actor) : null;
    const action = req.query.action ? String(req.query.action) : null;
    const result = await query(
      `SELECT * FROM audit_logs
       WHERE ($1::text IS NULL OR actor = $1)
         AND ($2::text IS NULL OR action = $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      [actor, action, limit]
    );
    res.json(result.rows);
  });

  app.post("/transactions", security.requireAuth("service"), async (req, res, next) => {
    try {
      const input = TransactionInputSchema.parse(req.body);
      const transactionId = await createTransaction(input);
      res.status(201).json({ id: transactionId, status: "queued_for_scoring" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/transactions", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 80), 250);
    const result = await query(
      `SELECT t.*, m.name AS merchant_name, m.category AS merchant_category, fs.score, fs.severity
       FROM transactions t
       JOIN merchants m ON m.id = t.merchant_id
       LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
       ORDER BY t.occurred_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  });

  app.get("/transactions/stream", async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const send = (event: string, payload: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const transactionHandler = (payload: unknown) => send("transaction_created", payload);
    const scoreHandler = (payload: unknown) => send("transaction_scored", payload);
    const alertHandler = (payload: unknown) => send("fraud_alert_created", payload);
    io.on("transaction_created", transactionHandler);
    io.on("transaction_scored", scoreHandler);
    io.on("fraud_alert_created", alertHandler);
    send("connected", { at: new Date().toISOString() });
    req.on("close", () => {
      io.off("transaction_created", transactionHandler);
      io.off("transaction_scored", scoreHandler);
      io.off("fraud_alert_created", alertHandler);
    });
  });

  app.get("/alerts", async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const severity = req.query.severity ? String(req.query.severity) : null;
    const assignedTo = req.query.assignedTo ? String(req.query.assignedTo) : null;
    const overdue = req.query.overdue === "true";
    const merchantCategory = req.query.merchantCategory ? String(req.query.merchantCategory) : null;
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;
    const result = await query(
      `SELECT fa.*, u.full_name, m.name AS merchant_name, t.amount, t.currency, t.channel, t.occurred_at
       FROM fraud_alerts fa
       JOIN users u ON u.id = fa.user_id
       JOIN merchants m ON m.id = fa.merchant_id
       JOIN transactions t ON t.id = fa.transaction_id
       WHERE ($1::text IS NULL OR fa.status = $1)
         AND ($2::text IS NULL OR fa.severity = $2)
         AND (
           $3::text IS NULL OR
           ($3 = 'unassigned' AND fa.assigned_to IS NULL) OR
           fa.assigned_to = $3
         )
         AND ($4::boolean = false OR (fa.due_at IS NOT NULL AND fa.due_at < now() AND fa.status = 'pending'))
         AND ($5::text IS NULL OR m.category = $5)
         AND (
           $6::text IS NULL OR
           lower(u.full_name) LIKE $6 OR
           lower(m.name) LIKE $6 OR
           lower(fa.severity) LIKE $6 OR
           lower(COALESCE(fa.assigned_to, 'unassigned')) LIKE $6
         )
       ORDER BY fa.created_at DESC
       LIMIT 200`,
      [status, severity, assignedTo, overdue, merchantCategory, q]
    );
    res.json(result.rows);
  });

  app.post("/alerts/bulk/assign", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const body = z.object({
        alertIds: z.array(z.string().uuid()).min(1).max(200),
        assignedTo: z.string().min(2),
        priority: z.number().int().min(1).max(5),
        slaHours: z.number().int().min(1).max(168).default(24),
        actor: z.string().min(2).default("demo-lead")
      }).parse(req.body);
      const result = await query(
        `UPDATE fraud_alerts
         SET assigned_to = $1, priority = $2, due_at = now() + ($3 || ' hours')::interval, updated_at = now()
         WHERE id = ANY($4::uuid[])
         RETURNING id`,
        [body.assignedTo, body.priority, body.slaHours, body.alertIds]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'bulk_case_assigned','fraud_alert','bulk',$2)",
        [body.actor, { ...body, updatedCount: result.rowCount }]
      );
      io.emit("bulk_case_assigned", { updatedCount: result.rowCount, assignedTo: body.assignedTo });
      res.json({ updatedCount: result.rowCount });
    } catch (error) {
      next(error);
    }
  });

  app.post("/alerts/bulk/review", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const body = z.object({
        alertIds: z.array(z.string().uuid()).min(1).max(100),
        decision: z.enum(["confirmed_fraud", "false_positive"]),
        analyst: z.string().min(2),
        notes: z.string().optional()
      }).parse(req.body);
      const result = await query(
        "UPDATE fraud_alerts SET status = $1, updated_at = now() WHERE id = ANY($2::uuid[]) RETURNING id",
        [body.decision, body.alertIds]
      );
      for (const row of result.rows) {
        await query(
          "INSERT INTO review_decisions (alert_id, decision, analyst, notes) VALUES ($1,$2,$3,$4)",
          [row.id, body.decision, body.analyst, body.notes ?? null]
        );
      }
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'bulk_review_decision','fraud_alert','bulk',$2)",
        [body.analyst, { ...body, updatedCount: result.rowCount }]
      );
      reviewDecisions.inc({ decision: body.decision }, result.rowCount ?? 0);
      io.emit("bulk_review_decision", { updatedCount: result.rowCount, decision: body.decision });
      res.json({ updatedCount: result.rowCount });
    } catch (error) {
      next(error);
    }
  });

  app.get("/alerts/:id", async (req, res) => {
    const result = await query(
      `SELECT fa.*, row_to_json(t.*) AS transaction, row_to_json(u.*) AS user, row_to_json(m.*) AS merchant,
        COALESCE((
          SELECT json_agg(n ORDER BY n.created_at DESC)
          FROM alert_case_notes n
          WHERE n.alert_id = fa.id
        ), '[]'::json) AS case_notes,
        COALESCE((
          SELECT json_agg(rd ORDER BY rd.created_at DESC)
          FROM review_decisions rd
          WHERE rd.alert_id = fa.id
        ), '[]'::json) AS review_decisions,
        COALESCE((
          SELECT json_agg(al ORDER BY al.created_at DESC)
          FROM audit_logs al
          WHERE al.entity_type = 'fraud_alert' AND al.entity_id = fa.id::text
        ), '[]'::json) AS audit_trail
       FROM fraud_alerts fa
       JOIN transactions t ON t.id = fa.transaction_id
       JOIN users u ON u.id = fa.user_id
       JOIN merchants m ON m.id = fa.merchant_id
       WHERE fa.id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "alert_not_found" });
    res.json(result.rows[0]);
  });

  app.get("/cases/:alertId/evidence", async (req, res) => {
    const alertId = z.string().uuid().safeParse(req.params.alertId);
    if (!alertId.success) return res.status(400).json({ error: "invalid_alert_id" });
    const base = await query<Record<string, any>>(
      `SELECT fa.*, row_to_json(t.*) AS transaction, row_to_json(u.*) AS user, row_to_json(m.*) AS merchant,
        row_to_json(fs.*) AS score_detail,
        row_to_json(tf.*) AS feature_snapshot
       FROM fraud_alerts fa
       JOIN transactions t ON t.id = fa.transaction_id
       JOIN users u ON u.id = fa.user_id
       JOIN merchants m ON m.id = fa.merchant_id
       JOIN fraud_scores fs ON fs.id = fa.fraud_score_id
       LEFT JOIN transaction_features tf ON tf.transaction_id = fa.transaction_id
       WHERE fa.id = $1`,
      [alertId.data]
    );
    if (!base.rowCount) return res.status(404).json({ error: "alert_not_found" });

    const alert = base.rows[0];
    const transaction = alert.transaction as Record<string, any>;
    const user = alert.user as Record<string, any>;
    const merchant = alert.merchant as Record<string, any>;
    const reasons = Array.isArray(alert.reasons) ? alert.reasons : [];

    const [
      entityRisk,
      userTransactions,
      cardTransactions,
      deviceTransactions,
      ipTransactions,
      merchantAlerts,
      caseNotes,
      reviews,
      auditTrail,
      latestSnapshot
    ] = await Promise.all([
      query(
        `SELECT *
         FROM entity_risk_memory
         WHERE (entity_type = 'user' AND entity_id = $1)
            OR (entity_type = 'card' AND entity_id = $2)
            OR (entity_type = 'merchant' AND entity_id = $3)
            OR (entity_type = 'device' AND entity_id = $4)
            OR (entity_type = 'ip' AND entity_id = $5)
         ORDER BY risk_score DESC`,
        [
          transaction.user_id,
          transaction.card_id,
          transaction.merchant_id,
          transaction.device_fingerprint,
          String(transaction.ip_address)
        ]
      ),
      query(
        `SELECT t.id, t.amount, t.currency, t.channel, t.occurred_at, m.name AS merchant_name,
          fs.score, fs.severity, fa.id AS alert_id, fa.status AS alert_status
         FROM transactions t
         JOIN merchants m ON m.id = t.merchant_id
         LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
         LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
         WHERE t.user_id = $1
         ORDER BY t.occurred_at DESC
         LIMIT 12`,
        [transaction.user_id]
      ),
      query(
        `SELECT t.id, t.amount, t.currency, t.channel, t.occurred_at, m.name AS merchant_name,
          fs.score, fs.severity, fa.id AS alert_id
         FROM transactions t
         JOIN merchants m ON m.id = t.merchant_id
         LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
         LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
         WHERE t.card_id = $1 AND t.id <> $2
         ORDER BY t.occurred_at DESC
         LIMIT 12`,
        [transaction.card_id, transaction.id]
      ),
      query(
        `SELECT t.id, t.amount, t.currency, t.channel, t.occurred_at, u.full_name, m.name AS merchant_name,
          fs.score, fs.severity, fa.id AS alert_id
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         JOIN merchants m ON m.id = t.merchant_id
         LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
         LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
         WHERE t.device_fingerprint = $1 AND t.id <> $2
         ORDER BY t.occurred_at DESC
         LIMIT 12`,
        [transaction.device_fingerprint, transaction.id]
      ),
      query(
        `SELECT t.id, t.amount, t.currency, t.channel, t.occurred_at, u.full_name, m.name AS merchant_name,
          fs.score, fs.severity, fa.id AS alert_id
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         JOIN merchants m ON m.id = t.merchant_id
         LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
         LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
         WHERE t.ip_address = $1::inet AND t.id <> $2
         ORDER BY t.occurred_at DESC
         LIMIT 12`,
        [String(transaction.ip_address), transaction.id]
      ),
      query(
        `SELECT fa.id, fa.severity, fa.score, fa.status, fa.created_at, u.full_name, t.amount, t.currency
         FROM fraud_alerts fa
         JOIN users u ON u.id = fa.user_id
         JOIN transactions t ON t.id = fa.transaction_id
         WHERE fa.merchant_id = $1
         ORDER BY fa.created_at DESC
         LIMIT 12`,
        [transaction.merchant_id]
      ),
      query("SELECT * FROM alert_case_notes WHERE alert_id = $1 ORDER BY created_at DESC", [alertId.data]),
      query("SELECT * FROM review_decisions WHERE alert_id = $1 ORDER BY created_at DESC", [alertId.data]),
      query(
        "SELECT * FROM audit_logs WHERE entity_type = 'fraud_alert' AND entity_id = $1 ORDER BY created_at DESC LIMIT 30",
        [alertId.data]
      ),
      query("SELECT * FROM case_evidence_snapshots WHERE alert_id = $1 ORDER BY created_at DESC LIMIT 1", [alertId.data])
    ]);

    const timeline = [
      {
        type: "alert_created",
        actor: "fraudpulse-worker",
        title: `${alert.severity} alert created`,
        created_at: alert.created_at
      },
      ...caseNotes.rows.map(note => ({
        type: "case_note",
        actor: note.author,
        title: "Case note added",
        detail: note.note,
        created_at: note.created_at
      })),
      ...reviews.rows.map(review => ({
        type: "review_decision",
        actor: review.analyst,
        title: String(review.decision).replaceAll("_", " "),
        detail: review.notes,
        created_at: review.created_at
      })),
      ...auditTrail.rows.map(entry => ({
        type: "audit",
        actor: entry.actor,
        title: String(entry.action).replaceAll("_", " "),
        detail: entry.payload,
        created_at: entry.created_at
      }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const highRiskEntities = entityRisk.rows.filter(row => Number(row.risk_score) >= 70);
    const openMerchantAlerts = merchantAlerts.rows.filter(row => row.status === "pending").length;
    const crossEntityMatches =
      (deviceTransactions.rowCount ?? 0) + (ipTransactions.rowCount ?? 0) + (cardTransactions.rowCount ?? 0);
    const recommendedActions = [
      highRiskEntities.length > 0 ? "Review high-memory entities linked to this case" : "Validate entity memory after analyst decision",
      crossEntityMatches > 0 ? "Compare related device, IP, and card transactions" : "No shared device, IP, or card transactions in recent evidence",
      openMerchantAlerts > 1 ? "Prioritize merchant-level pattern review" : "Check merchant risk against the individual transaction context",
      Number(alert.score) >= 90 ? "Escalate before customer contact because the score is critical" : "Complete analyst review and preserve supporting notes"
    ];

    const bundle = {
      alert: {
        id: alert.id,
        severity: alert.severity,
        score: alert.score,
        confidence: alert.confidence,
        status: alert.status,
        assigned_to: alert.assigned_to,
        priority: alert.priority,
        due_at: alert.due_at,
        reasons
      },
      transaction,
      user,
      merchant,
      scoreDetail: alert.score_detail,
      featureSnapshot: alert.feature_snapshot,
      summary: {
        reasonCount: reasons.length,
        highRiskEntityCount: highRiskEntities.length,
        relatedTransactionCount: crossEntityMatches,
        openMerchantAlerts,
        latestSnapshotAt: latestSnapshot.rows[0]?.created_at ?? null
      },
      entityRisk: entityRisk.rows,
      relatedActivity: {
        userTransactions: userTransactions.rows,
        cardTransactions: cardTransactions.rows,
        deviceTransactions: deviceTransactions.rows,
        ipTransactions: ipTransactions.rows,
        merchantAlerts: merchantAlerts.rows
      },
      recommendedActions,
      timeline,
      latestSnapshot: latestSnapshot.rows[0] ?? null
    };

    res.json(bundle);
  });

  app.post("/cases/:alertId/evidence-snapshots", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const alertId = z.string().uuid().safeParse(req.params.alertId);
      if (!alertId.success) return res.status(400).json({ error: "invalid_alert_id" });
      const body = z.object({
        actor: z.string().min(2).default("demo-investigator"),
        bundle: z.record(z.unknown())
      }).parse(req.body ?? {});
      const alert = await query("SELECT id FROM fraud_alerts WHERE id = $1", [alertId.data]);
      if (!alert.rowCount) return res.status(404).json({ error: "alert_not_found" });
      const snapshot = await query(
        "INSERT INTO case_evidence_snapshots (alert_id, created_by, bundle) VALUES ($1,$2,$3) RETURNING *",
        [alertId.data, body.actor, body.bundle]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'case_evidence_snapshot_created','fraud_alert',$2,$3)",
        [body.actor, alertId.data, { snapshotId: snapshot.rows[0].id }]
      );
      io.emit("case_evidence_snapshot_created", { alertId: alertId.data, snapshotId: snapshot.rows[0].id });
      res.status(201).json(snapshot.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/alerts/:id/assign", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const body = z.object({
        assignedTo: z.string().min(2),
        priority: z.number().int().min(1).max(5),
        slaHours: z.number().int().min(1).max(168).default(24),
        actor: z.string().min(2).default("demo-lead")
      }).parse(req.body);
      const result = await query(
        `UPDATE fraud_alerts
         SET assigned_to = $1, priority = $2, due_at = now() + ($3 || ' hours')::interval, updated_at = now()
         WHERE id = $4
         RETURNING id, assigned_to, priority, due_at`,
        [body.assignedTo, body.priority, body.slaHours, req.params.id]
      );
      if (!result.rowCount) return res.status(404).json({ error: "alert_not_found" });
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'case_assigned','fraud_alert',$2,$3)",
        [body.actor, req.params.id, body]
      );
      io.emit("case_assigned", { alertId: req.params.id, ...result.rows[0] });
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/alerts/:id/notes", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const body = z.object({
        author: z.string().min(2),
        note: z.string().min(3).max(2000)
      }).parse(req.body);
      const alert = await query("SELECT id FROM fraud_alerts WHERE id = $1", [req.params.id]);
      if (!alert.rowCount) return res.status(404).json({ error: "alert_not_found" });
      const note = await query(
        "INSERT INTO alert_case_notes (alert_id, author, note) VALUES ($1,$2,$3) RETURNING *",
        [req.params.id, body.author, body.note]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'case_note_added','fraud_alert',$2,$3)",
        [body.author, req.params.id, body]
      );
      io.emit("case_note_added", { alertId: req.params.id, note: note.rows[0] });
      res.status(201).json(note.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/alerts/:id/review", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const body = z.object({
        decision: z.enum(["confirmed_fraud", "false_positive"]),
        analyst: z.string().min(2),
        notes: z.string().optional()
      }).parse(req.body);
      const client = await query("SELECT id FROM fraud_alerts WHERE id = $1", [req.params.id]);
      if (!client.rowCount) return res.status(404).json({ error: "alert_not_found" });
      await query(
        "INSERT INTO review_decisions (alert_id, decision, analyst, notes) VALUES ($1,$2,$3,$4)",
        [req.params.id, body.decision, body.analyst, body.notes ?? null]
      );
      await query("UPDATE fraud_alerts SET status = $1, updated_at = now() WHERE id = $2", [
        body.decision,
        req.params.id
      ]);
      await query(
        "INSERT INTO transaction_events (event_type, payload) VALUES ('review_decision_recorded', $1)",
        [{ alertId: req.params.id, ...body }]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'review_decision','fraud_alert',$2,$3)",
        [body.analyst, req.params.id, body]
      );
      reviewDecisions.inc({ decision: body.decision });
      io.emit("review_decision_recorded", { alertId: req.params.id, ...body });
      res.json({ status: "recorded" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/alert-views", async (req, res) => {
    const owner = req.query.owner ? String(req.query.owner) : null;
    const result = await query(
      "SELECT * FROM saved_alert_views WHERE ($1::text IS NULL OR owner = $1) ORDER BY updated_at DESC",
      [owner]
    );
    res.json(result.rows);
  });

  app.post("/alert-views", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const body = z.object({
        name: z.string().min(2).max(80),
        owner: z.string().min(2).default("demo-lead"),
        filters: z.record(z.unknown()).default({})
      }).parse(req.body ?? {});
      const result = await query(
        "INSERT INTO saved_alert_views (name, owner, filters) VALUES ($1,$2,$3) RETURNING *",
        [body.name, body.owner, body.filters]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/alert-views/:id", security.requireAuth("analyst"), async (req, res) => {
    const result = await query("DELETE FROM saved_alert_views WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "view_not_found" });
    res.json({ deleted: req.params.id });
  });

  app.get("/operations/sla", async (_req, res) => {
    const summary = await query(
      `SELECT
        count(*) FILTER (WHERE status = 'pending') AS pending,
        count(*) FILTER (WHERE status = 'pending' AND due_at IS NOT NULL AND due_at < now()) AS breached,
        count(*) FILTER (WHERE status = 'pending' AND due_at BETWEEN now() AND now() + interval '4 hours') AS due_soon,
        count(*) FILTER (WHERE status = 'pending' AND assigned_to IS NULL) AS unassigned,
        count(*) FILTER (WHERE status = 'pending' AND severity IN ('high', 'critical')) AS high_risk_pending
       FROM fraud_alerts`
    );
    const workload = await query(
      `SELECT COALESCE(assigned_to, 'Unassigned') AS analyst,
        count(*) AS pending,
        count(*) FILTER (WHERE due_at IS NOT NULL AND due_at < now()) AS breached,
        count(*) FILTER (WHERE severity = 'critical') AS critical
       FROM fraud_alerts
       WHERE status = 'pending'
       GROUP BY COALESCE(assigned_to, 'Unassigned')
       ORDER BY breached DESC, pending DESC
       LIMIT 20`
    );
    const breached = await query(
      `SELECT fa.*, u.full_name, m.name AS merchant_name, t.amount, t.currency, t.occurred_at
       FROM fraud_alerts fa
       JOIN users u ON u.id = fa.user_id
       JOIN merchants m ON m.id = fa.merchant_id
       JOIN transactions t ON t.id = fa.transaction_id
       WHERE fa.status = 'pending' AND fa.due_at IS NOT NULL AND fa.due_at < now()
       ORDER BY fa.due_at ASC
       LIMIT 50`
    );
    const assignmentQueue = await query(
      `SELECT fa.*, u.full_name, m.name AS merchant_name, t.amount, t.currency, t.occurred_at
       FROM fraud_alerts fa
       JOIN users u ON u.id = fa.user_id
       JOIN merchants m ON m.id = fa.merchant_id
       JOIN transactions t ON t.id = fa.transaction_id
       WHERE fa.status = 'pending' AND fa.assigned_to IS NULL
       ORDER BY
        CASE fa.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        fa.score DESC,
        fa.created_at ASC
       LIMIT 50`
    );
    res.json({ ...summary.rows[0], workload: workload.rows, breachedAlerts: breached.rows, assignmentQueue: assignmentQueue.rows });
  });

  app.get("/dlq/events", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 250);
    const result = await query(
      `SELECT * FROM transaction_events
       WHERE event_type = 'scoring_failed_dead_letter'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  });

  app.post("/dlq/events/:id/replay", security.requireAuth("admin"), async (req, res, next) => {
    try {
      const actor = z.object({ actor: z.string().min(2).default("demo-operator") }).parse(req.body ?? {}).actor;
      const result = await query<{ id: string; transaction_id: string | null; payload: { transactionId?: string } }>(
        "SELECT id, transaction_id, payload FROM transaction_events WHERE id = $1 AND event_type = 'scoring_failed_dead_letter'",
        [req.params.id]
      );
      if (!result.rowCount) return res.status(404).json({ error: "dead_letter_event_not_found" });
      const event = result.rows[0];
      const transactionId = event.transaction_id ?? event.payload.transactionId;
      if (!transactionId) return res.status(400).json({ error: "dead_letter_missing_transaction_id" });
      await scoringQueue.add("score", { transactionId, replayedFromEventId: event.id });
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'dead_letter_replayed','transaction_event',$2,$3)",
        [actor, String(event.id), { transactionId }]
      );
      io.emit("dead_letter_replayed", { eventId: event.id, transactionId });
      res.json({ status: "requeued", eventId: event.id, transactionId });
    } catch (error) {
      next(error);
    }
  });

  app.get("/profiles/users/:id", async (req, res) => {
    const result = await query(
      `SELECT u.*,
        COALESCE(avg(t.amount), 0) AS avg_amount,
        COALESCE(stddev_pop(t.amount), 0) AS std_amount,
        count(t.id) AS transaction_count,
        count(fa.id) AS alert_count,
        row_to_json(erm.*) AS entity_risk
       FROM users u
       LEFT JOIN transactions t ON t.user_id = u.id
       LEFT JOIN fraud_alerts fa ON fa.user_id = u.id
       LEFT JOIN entity_risk_memory erm ON erm.entity_type = 'user' AND erm.entity_id = u.id::text
       WHERE u.id = $1
       GROUP BY u.id, erm.id`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "user_not_found" });
    res.json(result.rows[0]);
  });

  app.get("/profiles/merchants/:id", async (req, res) => {
    const result = await query(
      `SELECT m.*, count(t.id) AS transaction_count, count(fa.id) AS alert_count, COALESCE(avg(fs.score), 0) AS avg_score,
        row_to_json(erm.*) AS entity_risk
       FROM merchants m
       LEFT JOIN transactions t ON t.merchant_id = m.id
       LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
       LEFT JOIN fraud_alerts fa ON fa.merchant_id = m.id
       LEFT JOIN entity_risk_memory erm ON erm.entity_type = 'merchant' AND erm.entity_id = m.id::text
       WHERE m.id = $1
       GROUP BY m.id, erm.id`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "merchant_not_found" });
    res.json(result.rows[0]);
  });

  const ensureRiskOpsTables = async () => {
    await query(`
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
    `);
  };

  app.get("/risk/entities", async (req, res) => {
    await ensureRiskOpsTables();
    const entityType = req.query.type ? String(req.query.type) : null;
    const limit = Math.min(Number(req.query.limit ?? 100), 250);
    const result = await query(
      `SELECT erm.*,
        CASE
          WHEN erm.entity_type = 'user' THEN u.full_name
          WHEN erm.entity_type = 'merchant' THEN m.name
          WHEN erm.entity_type = 'card' THEN 'Card ' || c.last4
          ELSE erm.entity_id
        END AS label,
        CASE
          WHEN erm.entity_type = 'merchant' THEN m.category
          WHEN erm.entity_type = 'card' THEN c.network
          ELSE erm.entity_type
        END AS category,
        COALESCE(w.watchlist_actions, '[]'::json) AS watchlist_actions,
        COALESCE(o.override_count, 0) AS override_count,
        COALESCE(o.active_delta, 0) AS active_override_delta,
        COALESCE(n.note_count, 0) AS note_count
       FROM entity_risk_memory erm
       LEFT JOIN users u ON erm.entity_type = 'user' AND erm.entity_id = u.id::text
       LEFT JOIN merchants m ON erm.entity_type = 'merchant' AND erm.entity_id = m.id::text
       LEFT JOIN cards c ON erm.entity_type = 'card' AND erm.entity_id = c.id::text
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('action', action, 'reason', reason, 'createdBy', created_by, 'createdAt', created_at) ORDER BY created_at DESC) AS watchlist_actions
         FROM entity_watchlist ew
         WHERE ew.entity_type = erm.entity_type AND ew.entity_id = erm.entity_id AND ew.status = 'active'
       ) w ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS override_count, COALESCE(sum(risk_delta) FILTER (WHERE expires_at IS NULL OR expires_at > now()), 0) AS active_delta
         FROM entity_risk_overrides eo
         WHERE eo.entity_type = erm.entity_type AND eo.entity_id = erm.entity_id
       ) o ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS note_count
         FROM entity_notes en
         WHERE en.entity_type = erm.entity_type AND en.entity_id = erm.entity_id
       ) n ON true
       WHERE ($1::text IS NULL OR erm.entity_type = $1)
       ORDER BY erm.risk_score DESC, erm.updated_at DESC
       LIMIT $2`,
      [entityType, limit]
    );
    const summary = await query(
      `SELECT entity_type, count(*) AS entity_count, COALESCE(avg(risk_score), 0) AS avg_risk, COALESCE(max(risk_score), 0) AS max_risk
       FROM entity_risk_memory
       GROUP BY entity_type
       ORDER BY max_risk DESC`
    );
    res.json({ entities: result.rows, summary: summary.rows });
  });

  app.get("/risk/entities/:type/:id", async (req, res) => {
    await ensureRiskOpsTables();
    const result = await query(
      `SELECT erm.*,
        COALESCE((
          SELECT json_agg(row_to_json(x))
          FROM (
            SELECT t.id, t.amount, t.currency, t.channel, t.occurred_at, fs.score, fs.severity, m.name AS merchant_name
            FROM transactions t
            LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
            LEFT JOIN merchants m ON m.id = t.merchant_id
            WHERE
              ($1 = 'user' AND t.user_id::text = $2) OR
              ($1 = 'card' AND t.card_id::text = $2) OR
              ($1 = 'merchant' AND t.merchant_id::text = $2) OR
              ($1 = 'device' AND t.device_fingerprint = $2) OR
              ($1 = 'ip' AND t.ip_address::text = $2)
            ORDER BY t.occurred_at DESC
            LIMIT 25
          ) x
        ), '[]'::json) AS recent_transactions,
        COALESCE((
          SELECT json_agg(row_to_json(w) ORDER BY w.created_at DESC)
          FROM entity_watchlist w
          WHERE w.entity_type = erm.entity_type AND w.entity_id = erm.entity_id
        ), '[]'::json) AS watchlist_actions,
        COALESCE((
          SELECT json_agg(row_to_json(o) ORDER BY o.created_at DESC)
          FROM entity_risk_overrides o
          WHERE o.entity_type = erm.entity_type AND o.entity_id = erm.entity_id
        ), '[]'::json) AS overrides,
        COALESCE((
          SELECT json_agg(row_to_json(n) ORDER BY n.created_at DESC)
          FROM entity_notes n
          WHERE n.entity_type = erm.entity_type AND n.entity_id = erm.entity_id
        ), '[]'::json) AS notes
       FROM entity_risk_memory erm
       WHERE erm.entity_type = $1 AND erm.entity_id = $2`,
      [req.params.type, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "entity_risk_not_found" });
    res.json(result.rows[0]);
  });

  app.post("/risk/entities/:type/:id/watchlist", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      await ensureRiskOpsTables();
      const body = z.object({
        action: z.enum(["monitor", "block", "allow"]).default("monitor"),
        reason: z.string().min(3).default("Analyst action from Risk Memory"),
        actor: z.string().min(2).default("demo-risk")
      }).parse(req.body ?? {});
      const entityType = z.enum(["user", "card", "merchant", "device", "ip"]).parse(req.params.type);
      const inserted = await query(
        `INSERT INTO entity_watchlist (entity_type, entity_id, action, reason, created_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (entity_type, entity_id, action, status)
         DO UPDATE SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()
         RETURNING *`,
        [entityType, req.params.id, body.action, body.reason, body.actor]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'entity_watchlisted',$2,$3,$4)",
        [body.actor, entityType, req.params.id, JSON.stringify({ action: body.action, reason: body.reason })]
      );
      res.status(201).json(inserted.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/risk/entities/:type/:id/override", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      await ensureRiskOpsTables();
      const body = z.object({
        riskDelta: z.number().min(-50).max(50),
        reason: z.string().min(3),
        expiresHours: z.number().int().min(1).max(720).optional(),
        actor: z.string().min(2).default("demo-risk")
      }).parse(req.body ?? {});
      const entityType = z.enum(["user", "card", "merchant", "device", "ip"]).parse(req.params.type);
      const inserted = await query(
        `INSERT INTO entity_risk_overrides (entity_type, entity_id, risk_delta, reason, expires_at, created_by)
         VALUES ($1,$2,$3,$4,CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5 || ' hours')::interval END,$6)
         RETURNING *`,
        [entityType, req.params.id, body.riskDelta, body.reason, body.expiresHours ?? null, body.actor]
      );
      await query(
        `UPDATE entity_risk_memory
         SET risk_score = GREATEST(0, LEAST(99, risk_score + $1)), updated_at = now(),
             evidence = jsonb_set(COALESCE(evidence, '{}'::jsonb), '{latestRiskOverride}', $2::jsonb, true)
         WHERE entity_type = $3 AND entity_id = $4`,
        [
          body.riskDelta,
          JSON.stringify({ riskDelta: body.riskDelta, reason: body.reason, actor: body.actor, at: new Date().toISOString() }),
          entityType,
          req.params.id
        ]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'entity_risk_override',$2,$3,$4)",
        [body.actor, entityType, req.params.id, JSON.stringify({ riskDelta: body.riskDelta, reason: body.reason, expiresHours: body.expiresHours ?? null })]
      );
      res.status(201).json(inserted.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/risk/entities/:type/:id/notes", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      await ensureRiskOpsTables();
      const body = z.object({
        note: z.string().min(3),
        actor: z.string().min(2).default("demo-risk")
      }).parse(req.body ?? {});
      const entityType = z.enum(["user", "card", "merchant", "device", "ip"]).parse(req.params.type);
      const inserted = await query(
        "INSERT INTO entity_notes (entity_type, entity_id, note, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
        [entityType, req.params.id, body.note, body.actor]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'entity_note_added',$2,$3,$4)",
        [body.actor, entityType, req.params.id, JSON.stringify({ note: body.note })]
      );
      res.status(201).json(inserted.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get("/rules", async (_req, res) => {
    const result = await query("SELECT * FROM scoring_rules ORDER BY code");
    res.json(result.rows);
  });

  app.patch("/rules/:code", security.requireAuth("admin"), async (req, res) => {
    const body = z.object({ enabled: z.boolean().optional(), weight: z.number().optional() }).parse(req.body);
    const result = await query(
      "UPDATE scoring_rules SET enabled = COALESCE($1, enabled), weight = COALESCE($2, weight), updated_at = now() WHERE code = $3 RETURNING *",
      [body.enabled ?? null, body.weight ?? null, req.params.code]
    );
    if (!result.rowCount) return res.status(404).json({ error: "rule_not_found" });
    res.json(result.rows[0]);
  });

  app.post("/rules/preview", security.requireAuth("analyst"), async (req, res) => {
    const body = z.object({
      weights: z.record(z.number().min(0).max(100)).default({}),
      disabled: z.array(z.string()).default([]),
      alertThreshold: z.number().min(1).max(99).default(55)
    }).parse(req.body ?? {});
    const [rules, samples] = await Promise.all([
      query<{ code: string; weight: string }>("SELECT code, weight FROM scoring_rules"),
      query<{ actual: boolean; current_score: string; reasons: Array<{ rule: string; scoreImpact: number }> }>(
        `SELECT t.is_fraud_ground_truth AS actual, fs.score AS current_score, fs.reasons
         FROM fraud_scores fs
         JOIN transactions t ON t.id = fs.transaction_id
         ORDER BY fs.created_at DESC
         LIMIT 5000`
      )
    ]);
    const currentWeights = new Map(rules.rows.map(rule => [rule.code, Number(rule.weight)]));
    const disabled = new Set(body.disabled);
    const metric = { tp: 0, fp: 0, tn: 0, fn: 0 };
    let currentAlerts = 0;
    let previewAlerts = 0;
    let scoreDeltaTotal = 0;

    for (const sample of samples.rows) {
      const reasons = Array.isArray(sample.reasons) ? sample.reasons : [];
      const currentScore = Number(sample.current_score);
      const adjustedScore = reasons.reduce((sum, reason) => {
        if (disabled.has(reason.rule)) return sum;
        const currentWeight = currentWeights.get(reason.rule) ?? reason.scoreImpact;
        const nextWeight = body.weights[reason.rule] ?? currentWeight;
        const scaledImpact = currentWeight <= 0 ? reason.scoreImpact : reason.scoreImpact * (nextWeight / currentWeight);
        return sum + scaledImpact;
      }, 0);
      const previewScore = Math.min(99, Number(adjustedScore.toFixed(2)));
      const predicted = previewScore >= body.alertThreshold;
      if (currentScore >= 55) currentAlerts += 1;
      if (predicted) previewAlerts += 1;
      scoreDeltaTotal += previewScore - currentScore;
      if (sample.actual && predicted) metric.tp += 1;
      else if (!sample.actual && predicted) metric.fp += 1;
      else if (!sample.actual && !predicted) metric.tn += 1;
      else metric.fn += 1;
    }

    const precision = metric.tp + metric.fp === 0 ? 0 : metric.tp / (metric.tp + metric.fp);
    const recall = metric.tp + metric.fn === 0 ? 0 : metric.tp / (metric.tp + metric.fn);
    const f1Score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    res.json({
      sampleSize: samples.rowCount,
      currentAlerts,
      previewAlerts,
      alertDelta: previewAlerts - currentAlerts,
      averageScoreDelta: samples.rowCount ? scoreDeltaTotal / samples.rowCount : 0,
      precision,
      recall,
      f1Score,
      falsePositiveRate: metric.fp + metric.tn === 0 ? 0 : metric.fp / (metric.fp + metric.tn),
      truePositiveRate: recall,
      confusionMatrix: {
        truePositive: metric.tp,
        falsePositive: metric.fp,
        trueNegative: metric.tn,
        falseNegative: metric.fn
      }
    });
  });

  app.get("/features/overview", async (_req, res) => {
    const summary = await query(
      `SELECT
        count(*) AS feature_count,
        COALESCE(avg(velocity_5m), 0) AS avg_velocity_5m,
        COALESCE(avg(velocity_1h), 0) AS avg_velocity_1h,
        COALESCE(avg(amount_zscore), 0) AS avg_amount_zscore,
        COALESCE(max(amount_zscore), 0) AS max_amount_zscore,
        COALESCE(avg(geo_kmh), 0) AS avg_geo_kmh,
        COALESCE(max(geo_kmh), 0) AS max_geo_kmh,
        COALESCE(avg(merchant_risk), 0) AS avg_merchant_risk,
        count(*) FILTER (WHERE NOT device_seen) AS new_device_count
       FROM transaction_features
       WHERE created_at >= now() - interval '24 hours'`
    );
    const topAnomalies = await query(
      `SELECT tf.*, t.amount, t.currency, u.full_name, m.name AS merchant_name, fs.score, fs.severity
       FROM transaction_features tf
       JOIN transactions t ON t.id = tf.transaction_id
       JOIN users u ON u.id = tf.user_id
       JOIN merchants m ON m.id = tf.merchant_id
       JOIN fraud_scores fs ON fs.transaction_id = tf.transaction_id
       ORDER BY (abs(tf.amount_zscore) + (tf.geo_kmh / 500) + tf.velocity_5m + (CASE WHEN tf.device_seen THEN 0 ELSE 3 END)) DESC
       LIMIT 20`
    );
    res.json({ ...summary.rows[0], topAnomalies: topAnomalies.rows });
  });

  app.get("/features/transactions/:id", async (req, res) => {
    const result = await query(
      `SELECT tf.*, t.amount, t.currency, t.channel, t.occurred_at, u.full_name, m.name AS merchant_name, fs.score, fs.severity
       FROM transaction_features tf
       JOIN transactions t ON t.id = tf.transaction_id
       JOIN users u ON u.id = tf.user_id
       JOIN merchants m ON m.id = tf.merchant_id
       JOIN fraud_scores fs ON fs.transaction_id = tf.transaction_id
       WHERE tf.transaction_id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "features_not_found" });
    res.json(result.rows[0]);
  });

  app.get("/metrics/model", async (_req, res) => {
    const result = await query(
      `WITH classified AS (
        SELECT t.is_fraud_ground_truth AS actual, COALESCE(fs.score >= 55, false) AS predicted
        FROM transactions t LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
      )
      SELECT
        count(*) FILTER (WHERE actual AND predicted) AS tp,
        count(*) FILTER (WHERE NOT actual AND predicted) AS fp,
        count(*) FILTER (WHERE NOT actual AND NOT predicted) AS tn,
        count(*) FILTER (WHERE actual AND NOT predicted) AS fn
      FROM classified`
    );
    const row = result.rows[0];
    const tp = Number(row.tp), fp = Number(row.fp), tn = Number(row.tn), fn = Number(row.fn);
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1Score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    res.json({
      precision,
      recall,
      f1Score,
      falsePositiveRate: fp + tn === 0 ? 0 : fp / (fp + tn),
      truePositiveRate: recall,
      confusionMatrix: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn }
    });
  });

  const ensureModelRunTables = async () => {
    await query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS model_benchmark_runs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
        sample_size INTEGER NOT NULL,
        validation_size INTEGER NOT NULL,
        algorithms JSONB NOT NULL DEFAULT '[]',
        results JSONB NOT NULL DEFAULT '[]',
        best_algorithm TEXT,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS model_shadow_runs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        candidate_model_id UUID REFERENCES model_versions(id),
        champion_model_id UUID REFERENCES model_versions(id),
        candidate_version TEXT NOT NULL,
        champion_version TEXT NOT NULL,
        sample_size INTEGER NOT NULL,
        alert_threshold NUMERIC NOT NULL,
        candidate JSONB NOT NULL,
        champion JSONB NOT NULL,
        alert_delta INTEGER NOT NULL,
        disagreement_count INTEGER NOT NULL,
        disagreement_rate NUMERIC NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_model_benchmark_runs_created ON model_benchmark_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_model_shadow_runs_created ON model_shadow_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_model_shadow_runs_candidate ON model_shadow_runs(candidate_model_id, created_at DESC);
    `);
  };

  app.get("/models/hybrid", async (_req, res) => {
    const model = await query(
      "SELECT id, version, parameters, metrics, active, created_at FROM model_versions WHERE active = true ORDER BY created_at DESC LIMIT 1"
    );
    const recentModels = await query<RegistryModelRow>(
      `SELECT id, version, parameters, metrics, active, created_at
       FROM model_versions
       ORDER BY created_at DESC
       LIMIT 8`
    );
    const summary = await query(
      `SELECT
        count(*) AS scored_count,
        COALESCE(avg(rule_score), 0) AS avg_rule_score,
        COALESCE(avg(ml_score), 0) AS avg_ml_score,
        COALESCE(avg(blended_score), 0) AS avg_blended_score,
        COALESCE(avg(model_probability), 0) AS avg_model_probability,
        count(*) FILTER (WHERE ml_score >= 70) AS high_ml_count,
        count(*) FILTER (WHERE abs(COALESCE(ml_score, score) - COALESCE(rule_score, score)) >= 25) AS disagreement_count
       FROM fraud_scores
       WHERE created_at >= now() - interval '24 hours'`
    );
    const recent = await query(
      `SELECT fs.transaction_id, fs.rule_score, fs.ml_score, fs.blended_score, fs.model_probability,
        fs.score, fs.severity, t.amount, t.currency, u.full_name, m.name AS merchant_name
       FROM fraud_scores fs
       JOIN transactions t ON t.id = fs.transaction_id
       JOIN users u ON u.id = t.user_id
       JOIN merchants m ON m.id = t.merchant_id
       ORDER BY abs(COALESCE(fs.ml_score, fs.score) - COALESCE(fs.rule_score, fs.score)) DESC NULLS LAST, fs.created_at DESC
       LIMIT 25`
    );
    const contributions = await query(
      `SELECT
        item->>'feature' AS feature,
        item->>'direction' AS direction,
        count(*) AS count,
        COALESCE(avg((item->>'contribution')::numeric), 0) AS avg_contribution,
        COALESCE(avg(abs((item->>'contribution')::numeric)), 0) AS avg_abs_contribution
       FROM fraud_scores fs
       CROSS JOIN LATERAL jsonb_array_elements(fs.reasons) reason
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(reason->'evidence'->'topContributions', '[]'::jsonb)) item
       WHERE fs.created_at >= now() - interval '24 hours'
         AND reason->>'rule' = 'hybrid_ml_model'
       GROUP BY item->>'feature', item->>'direction'
       ORDER BY avg_abs_contribution DESC
       LIMIT 12`
    );
    res.json({
      activeModel: model.rows[0] ?? null,
      recentModels: recentModels.rows,
      ...summary.rows[0],
      topDisagreements: recent.rows,
      topModelContributions: contributions.rows
    });
  });

  app.get("/models/registry", async (_req, res) => {
    await ensureModelRunTables();
    const models = await query<RegistryModelRow>(
      `SELECT id, version, parameters, metrics, active, created_at
       FROM model_versions
       ORDER BY active DESC, created_at DESC
       LIMIT 60`
    );
    const shadowRuns = await query<ShadowRunRow>(
      "SELECT * FROM model_shadow_runs ORDER BY created_at DESC LIMIT 20"
    );
    const champion = models.rows.find(model => model.active) ?? null;
    const challengers = models.rows.filter(model => !model.active);
    const recommendedChallenger = challengers.find(model => model.version.startsWith("trained-logit"))
      ?? challengers[0]
      ?? null;
    res.json({
      champion,
      recommendedChallenger,
      models: models.rows,
      shadowRuns: shadowRuns.rows,
      counts: {
        total: models.rowCount,
        trained: models.rows.filter(model => model.version.startsWith("trained-logit")).length,
        challengers: challengers.length
      }
    });
  });

  app.post("/models/:id/promote", security.requireAuth("admin"), async (req, res, next) => {
    try {
      const body = z.object({ actor: z.string().min(2).default("demo-mlops") }).parse(req.body ?? {});
      const target = await query<RegistryModelRow>(
        "SELECT id, version, parameters, metrics, active, created_at FROM model_versions WHERE id = $1",
        [req.params.id]
      );
      if (!target.rowCount) return res.status(404).json({ error: "model_not_found" });
      const previous = await query<RegistryModelRow>(
        "SELECT id, version FROM model_versions WHERE active = true ORDER BY created_at DESC LIMIT 1"
      );
      await query("UPDATE model_versions SET active = false");
      const promoted = await query<RegistryModelRow>(
        "UPDATE model_versions SET active = true WHERE id = $1 RETURNING id, version, parameters, metrics, active, created_at",
        [req.params.id]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'model_promoted','model_version',$2,$3)",
        [body.actor, req.params.id, { previousChampion: previous.rows[0] ?? null, promoted: promoted.rows[0] }]
      );
      res.json({ previousChampion: previous.rows[0] ?? null, champion: promoted.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  app.post("/models/:id/shadow-score", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      await ensureModelRunTables();
      const body = z.object({
        actor: z.string().min(2).default("demo-mlops"),
        sampleSize: z.number().int().min(50).max(10000).default(2000),
        alertThreshold: z.number().min(1).max(99).default(55)
      }).parse(req.body ?? {});
      const [candidateResult, championResult, sampleResult] = await Promise.all([
        query<RegistryModelRow>(
          "SELECT id, version, parameters, metrics, active, created_at FROM model_versions WHERE id = $1",
          [req.params.id]
        ),
        query<RegistryModelRow>(
          "SELECT id, version, parameters, metrics, active, created_at FROM model_versions WHERE active = true ORDER BY created_at DESC LIMIT 1"
        ),
        query<ShadowFeatureRow>(
          `SELECT t.is_fraud_ground_truth AS actual,
            COALESCE(fs.rule_score, fs.score, 0) AS rule_score,
            tf.velocity_5m,
            tf.velocity_1h,
            tf.user_tx_30d,
            tf.amount_zscore,
            tf.geo_kmh,
            tf.merchant_risk,
            tf.device_seen
           FROM transaction_features tf
           JOIN transactions t ON t.id = tf.transaction_id
           LEFT JOIN fraud_scores fs ON fs.transaction_id = tf.transaction_id
           ORDER BY tf.created_at DESC
           LIMIT $1`,
          [body.sampleSize]
        )
      ]);
      if (!candidateResult.rowCount) return res.status(404).json({ error: "model_not_found" });
      if (!championResult.rowCount) return res.status(409).json({ error: "champion_model_missing" });
      const candidate = candidateResult.rows[0];
      const champion = championResult.rows[0];
      const pairs = sampleResult.rows.map(row => {
        const candidateScore = scoreModelVersion(candidate, row);
        const championScore = scoreModelVersion(champion, row);
        return {
          actual: row.actual,
          candidateScore,
          championScore,
          candidatePredicted: candidateScore.blendedScore >= body.alertThreshold,
          championPredicted: championScore.blendedScore >= body.alertThreshold
        };
      });
      const candidateMetrics = metricSummary(pairs.map(pair => ({ actual: pair.actual, predicted: pair.candidatePredicted })));
      const championMetrics = metricSummary(pairs.map(pair => ({ actual: pair.actual, predicted: pair.championPredicted })));
      const disagreementCount = pairs.filter(pair => pair.candidatePredicted !== pair.championPredicted).length;
      const candidateAlerts = pairs.filter(pair => pair.candidatePredicted).length;
      const championAlerts = pairs.filter(pair => pair.championPredicted).length;
      const result = {
        sampleSize: sampleResult.rowCount,
        alertThreshold: body.alertThreshold,
        champion: { id: champion.id, version: champion.version, metrics: championMetrics, alerts: championAlerts },
        candidate: { id: candidate.id, version: candidate.version, metrics: candidateMetrics, alerts: candidateAlerts },
        alertDelta: candidateAlerts - championAlerts,
        disagreementCount,
        disagreementRate: sampleResult.rowCount ? disagreementCount / sampleResult.rowCount : 0
      };
      const inserted = await query<ShadowRunRow>(
        `INSERT INTO model_shadow_runs
          (candidate_model_id, champion_model_id, candidate_version, champion_version, sample_size, alert_threshold,
           candidate, champion, alert_delta, disagreement_count, disagreement_rate, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          candidate.id,
          champion.id,
          candidate.version,
          champion.version,
          result.sampleSize,
          body.alertThreshold,
          JSON.stringify(result.candidate),
          JSON.stringify(result.champion),
          result.alertDelta,
          result.disagreementCount,
          result.disagreementRate,
          body.actor
        ]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'model_shadow_run','model_shadow_run',$2,$3)",
        [body.actor, inserted.rows[0].id, JSON.stringify({ candidate: candidate.version, champion: champion.version, sampleSize: result.sampleSize })]
      );
      res.status(201).json({
        run: inserted.rows[0],
        ...result
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/models/shadow-runs", async (req, res, next) => {
    try {
      await ensureModelRunTables();
      const limit = Math.min(Number(req.query.limit ?? 20), 100);
      const result = await query<ShadowRunRow>(
        "SELECT * FROM model_shadow_runs ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
      res.json({ runs: result.rows });
    } catch (error) {
      next(error);
    }
  });

  app.get("/models/drift", async (_req, res) => {
    const result = await query<DriftRow>(
      `WITH current_window AS (
        SELECT * FROM transaction_features WHERE created_at >= now() - interval '1 hour'
      ), baseline_window AS (
        SELECT * FROM transaction_features WHERE created_at >= now() - interval '25 hours' AND created_at < now() - interval '1 hour'
      ), current_stats AS (
        SELECT
          COALESCE(avg(velocity_5m), 0) AS velocity_5m,
          COALESCE(avg(amount_zscore), 0) AS amount_zscore,
          COALESCE(avg(geo_kmh), 0) AS geo_kmh,
          COALESCE(avg(merchant_risk), 0) AS merchant_risk,
          COALESCE(avg(CASE WHEN device_seen THEN 0 ELSE 1 END), 0) AS new_device_rate
        FROM current_window
      ), baseline_stats AS (
        SELECT
          COALESCE(avg(velocity_5m), 0) AS velocity_5m,
          COALESCE(avg(amount_zscore), 0) AS amount_zscore,
          COALESCE(avg(geo_kmh), 0) AS geo_kmh,
          COALESCE(avg(merchant_risk), 0) AS merchant_risk,
          COALESCE(avg(CASE WHEN device_seen THEN 0 ELSE 1 END), 0) AS new_device_rate
        FROM baseline_window
      ), counts AS (
        SELECT
          (SELECT count(*) FROM current_window) AS current_count,
          (SELECT count(*) FROM baseline_window) AS baseline_count
      )
      SELECT row_to_json(current_stats.*) AS current, row_to_json(baseline_stats.*) AS baseline, counts.*
      FROM current_stats, baseline_stats, counts`
    );
    res.json(buildDriftSummary(result.rows[0]));
  });

  const ensureDataQualityTables = async () => {
    await query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS data_quality_runs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        status TEXT NOT NULL DEFAULT 'completed',
        summary JSONB NOT NULL,
        checks JSONB NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS data_quality_alerts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence JSONB NOT NULL DEFAULT '{}',
        assigned_to TEXT,
        resolution_note TEXT,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ
      );

      ALTER TABLE data_quality_alerts
        ADD COLUMN IF NOT EXISTS assigned_to TEXT,
        ADD COLUMN IF NOT EXISTS resolution_note TEXT;

      CREATE INDEX IF NOT EXISTS idx_quality_runs_created ON data_quality_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_quality_alerts_status_severity ON data_quality_alerts(status, severity, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_quality_alerts_type_title_open ON data_quality_alerts(alert_type, title) WHERE status = 'open';
      CREATE INDEX IF NOT EXISTS idx_quality_alerts_assignee ON data_quality_alerts(assigned_to, status, last_seen_at DESC);
    `);
  };

  const buildQualityOverview = async () => {
    await ensureDataQualityTables();
    const [counts, freshness, eventLag, driftResult, activeAlerts, recentRuns] = await Promise.all([
      query(
        `SELECT
          (SELECT count(*) FROM transactions) AS transactions_total,
          (SELECT count(*) FROM transactions t LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
            WHERE fs.id IS NULL AND t.created_at < now() - interval '90 seconds') AS unscored_transactions,
          (SELECT count(*) FROM transactions WHERE amount <= 0 OR length(currency) <> 3) AS invalid_transactions,
          (SELECT count(*) FROM transactions t
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN cards c ON c.id = t.card_id
            LEFT JOIN merchants m ON m.id = t.merchant_id
            WHERE u.id IS NULL OR c.id IS NULL OR m.id IS NULL) AS missing_entity_links,
          (SELECT count(*) FROM fraud_scores fs LEFT JOIN transaction_features tf ON tf.transaction_id = fs.transaction_id
            WHERE tf.transaction_id IS NULL) AS missing_feature_snapshots,
          (SELECT count(*) FROM transaction_events te
            WHERE te.transaction_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = te.transaction_id)) AS orphan_events,
          (SELECT count(*) FROM transaction_events WHERE event_type LIKE '%dead_letter%' OR error IS NOT NULL) AS dead_letter_events,
          (SELECT count(*) FROM transaction_events te
            WHERE te.event_type = 'transaction_created'
              AND te.created_at < now() - interval '5 minutes'
              AND NOT EXISTS (
                SELECT 1 FROM transaction_events scored
                WHERE scored.transaction_id = te.transaction_id AND scored.event_type = 'transaction_scored'
              )) AS delayed_scoring_events`
      ),
      query(
        `SELECT
          COALESCE(EXTRACT(EPOCH FROM (now() - max(created_at))) / 60, 999999) AS latest_transaction_age_minutes,
          COALESCE(EXTRACT(EPOCH FROM (now() - (max(created_at) FILTER (WHERE event_type = 'transaction_scored')))) / 60, 999999) AS latest_score_event_age_minutes
         FROM transaction_events`
      ),
      query(
        `SELECT COALESCE(avg(EXTRACT(EPOCH FROM (scored.created_at - created.created_at))), 0) AS avg_score_lag_seconds
         FROM transaction_events created
         JOIN transaction_events scored ON scored.transaction_id = created.transaction_id AND scored.event_type = 'transaction_scored'
         WHERE created.event_type = 'transaction_created'
           AND created.created_at >= now() - interval '1 hour'`
      ),
      query<DriftRow>(
        `WITH current_window AS (
          SELECT * FROM transaction_features WHERE created_at >= now() - interval '1 hour'
        ), baseline_window AS (
          SELECT * FROM transaction_features WHERE created_at >= now() - interval '25 hours' AND created_at < now() - interval '1 hour'
        ), current_stats AS (
          SELECT
            COALESCE(avg(velocity_5m), 0) AS velocity_5m,
            COALESCE(avg(amount_zscore), 0) AS amount_zscore,
            COALESCE(avg(geo_kmh), 0) AS geo_kmh,
            COALESCE(avg(merchant_risk), 0) AS merchant_risk,
            COALESCE(avg(CASE WHEN device_seen THEN 0 ELSE 1 END), 0) AS new_device_rate
          FROM current_window
        ), baseline_stats AS (
          SELECT
            COALESCE(avg(velocity_5m), 0) AS velocity_5m,
            COALESCE(avg(amount_zscore), 0) AS amount_zscore,
            COALESCE(avg(geo_kmh), 0) AS geo_kmh,
            COALESCE(avg(merchant_risk), 0) AS merchant_risk,
            COALESCE(avg(CASE WHEN device_seen THEN 0 ELSE 1 END), 0) AS new_device_rate
          FROM baseline_window
        ), counts AS (
          SELECT
            (SELECT count(*) FROM current_window) AS current_count,
            (SELECT count(*) FROM baseline_window) AS baseline_count
        )
        SELECT row_to_json(current_stats.*) AS current, row_to_json(baseline_stats.*) AS baseline, counts.*
        FROM current_stats, baseline_stats, counts`
      ),
      query("SELECT * FROM data_quality_alerts WHERE status = 'open' ORDER BY last_seen_at DESC LIMIT 80"),
      query("SELECT * FROM data_quality_runs ORDER BY created_at DESC LIMIT 12")
    ]);
    const row = counts.rows[0];
    const fresh = freshness.rows[0];
    const drift = buildDriftSummary(driftResult.rows[0]);
    const avgScoreLagSeconds = Number(eventLag.rows[0]?.avg_score_lag_seconds ?? 0);
    const staleMinutes = Number(fresh.latest_transaction_age_minutes ?? 999999);
    const unscoredRate = Number(row.transactions_total) === 0 ? 0 : Number(row.unscored_transactions) / Number(row.transactions_total);
    const checks: QualityCheck[] = [];
    const addCheck = (
      code: string,
      label: string,
      value: number,
      warn: number,
      fail: number,
      description: string,
      evidence: Record<string, unknown>,
      critical = false
    ) => {
      const status = qualityStatus(value, warn, fail);
      checks.push({
        code,
        label,
        status,
        severity: qualitySeverity(status, critical),
        value,
        threshold: status === "fail" ? fail : warn,
        description,
        evidence
      });
    };
    addCheck("unscored_transactions", "Unscored transactions", Number(row.unscored_transactions), 5, 25, "Transactions older than 90 seconds have not received fraud scores.", { unscoredRate });
    addCheck("invalid_transactions", "Invalid transaction values", Number(row.invalid_transactions), 1, 5, "Transactions contain invalid amount or currency values.", {});
    addCheck("missing_entity_links", "Missing entity links", Number(row.missing_entity_links), 1, 3, "Transactions reference missing users, cards, or merchants.", {}, true);
    addCheck("missing_feature_snapshots", "Missing feature snapshots", Number(row.missing_feature_snapshots), 5, 25, "Scored transactions are missing feature-store rows.", {});
    addCheck("orphan_events", "Orphan event records", Number(row.orphan_events), 1, 5, "Event rows reference transactions that no longer exist.", {});
    addCheck("dead_letter_events", "Dead-letter events", Number(row.dead_letter_events), 1, 5, "Scoring events reached the dead-letter path.", {});
    addCheck("delayed_scoring_events", "Delayed scoring events", Number(row.delayed_scoring_events), 5, 20, "Created transaction events have not produced scoring events within five minutes.", {});
    addCheck("ingestion_freshness", "Ingestion freshness", staleMinutes, 10, 30, "No recent transaction events have arrived.", { latestTransactionAgeMinutes: staleMinutes });
    addCheck("score_lag", "Average scoring lag", avgScoreLagSeconds, 15, 45, "Average transaction_created to transaction_scored lag is elevated.", { avgScoreLagSeconds });
    addCheck("feature_drift", "Feature drift index", drift.driftIndex, 0.2, 0.5, "Recent feature distribution has moved away from the previous baseline.", { drift });
    const failing = checks.filter(check => check.status === "fail").length;
    const warning = checks.filter(check => check.status === "warn").length;
    const summary = {
      status: failing ? "fail" : warning ? "warn" : "pass",
      failing,
      warning,
      passing: checks.filter(check => check.status === "pass").length,
      transactionCount: Number(row.transactions_total),
      openAlertCount: activeAlerts.rowCount ?? 0,
      driftStatus: drift.status,
      driftIndex: drift.driftIndex
    };
    return { summary, checks, drift, alerts: activeAlerts.rows, recentRuns: recentRuns.rows };
  };

  const persistQualityRun = async (actor: string, overview: Awaited<ReturnType<typeof buildQualityOverview>>) => {
    const run = await query(
      "INSERT INTO data_quality_runs (summary, checks, created_by) VALUES ($1,$2,$3) RETURNING *",
      [JSON.stringify(overview.summary), JSON.stringify(overview.checks), actor]
    );
    for (const check of overview.checks.filter(item => item.status !== "pass")) {
      const existing = await query(
        "SELECT id FROM data_quality_alerts WHERE status = 'open' AND alert_type = $1 AND title = $2 LIMIT 1",
        [check.code, check.label]
      );
      const evidence = { value: check.value, threshold: check.threshold, ...check.evidence };
      if (existing.rowCount) {
        await query(
          `UPDATE data_quality_alerts
           SET severity = $1, description = $2, evidence = $3, last_seen_at = now()
          WHERE id = $4`,
          [check.severity, check.description, JSON.stringify(evidence), existing.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO data_quality_alerts (alert_type, severity, title, description, evidence)
           VALUES ($1,$2,$3,$4,$5)`,
          [check.code, check.severity, check.label, check.description, JSON.stringify(evidence)]
        );
      }
    }
    const passingCodes = overview.checks.filter(item => item.status === "pass").map(item => item.code);
    if (passingCodes.length) {
      await query(
        "UPDATE data_quality_alerts SET status = 'resolved', resolved_at = now(), last_seen_at = now() WHERE status = 'open' AND alert_type = ANY($1::text[])",
        [passingCodes]
      );
    }
    return run.rows[0];
  };

  app.get("/quality/overview", async (_req, res, next) => {
    try {
      res.json(await buildQualityOverview());
    } catch (error) {
      next(error);
    }
  });

  app.post("/quality/run", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      const body = z.object({ actor: z.string().min(2).default("demo-quality") }).parse(req.body ?? {});
      const overview = await buildQualityOverview();
      const run = await persistQualityRun(body.actor, overview);
      const updatedOverview = await buildQualityOverview();
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'data_quality_run','data_quality_run',$2,$3)",
        [body.actor, run.id, JSON.stringify({ summary: overview.summary })]
      );
      res.status(201).json({ run, ...updatedOverview });
    } catch (error) {
      next(error);
    }
  });

  app.post("/quality/alerts/:id/assign", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      await ensureDataQualityTables();
      const body = z.object({
        assignedTo: z.string().min(2).default("data.ops"),
        actor: z.string().min(2).default("demo-quality")
      }).parse(req.body ?? {});
      const result = await query(
        "UPDATE data_quality_alerts SET assigned_to = $1, last_seen_at = now() WHERE id = $2 RETURNING *",
        [body.assignedTo, req.params.id]
      );
      if (!result.rowCount) return res.status(404).json({ error: "quality_alert_not_found" });
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'quality_alert_assigned','data_quality_alert',$2,$3)",
        [body.actor, req.params.id, JSON.stringify({ assignedTo: body.assignedTo })]
      );
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/quality/alerts/:id/resolve", security.requireAuth("analyst"), async (req, res, next) => {
    try {
      await ensureDataQualityTables();
      const body = z.object({
        note: z.string().min(3).default("Resolved by data quality analyst."),
        actor: z.string().min(2).default("demo-quality")
      }).parse(req.body ?? {});
      const result = await query(
        `UPDATE data_quality_alerts
         SET status = 'resolved', resolution_note = $1, resolved_at = now(), last_seen_at = now()
         WHERE id = $2
         RETURNING *`,
        [body.note, req.params.id]
      );
      if (!result.rowCount) return res.status(404).json({ error: "quality_alert_not_found" });
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'quality_alert_resolved','data_quality_alert',$2,$3)",
        [body.actor, req.params.id, JSON.stringify({ note: body.note })]
      );
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/models/recalibrate", security.requireAuth("admin"), async (req, res, next) => {
    try {
      const body = z.object({
        actor: z.string().min(2).default("demo-mlops"),
        blendRuleWeight: z.number().min(0.05).max(0.95).optional()
      }).parse(req.body ?? {});
      const metrics = await query(
        `WITH classified AS (
          SELECT t.is_fraud_ground_truth AS actual, COALESCE(fs.score >= 55, false) AS predicted
          FROM transactions t JOIN fraud_scores fs ON fs.transaction_id = t.id
          WHERE fs.created_at >= now() - interval '24 hours'
        )
        SELECT
          count(*) FILTER (WHERE actual AND predicted) AS tp,
          count(*) FILTER (WHERE NOT actual AND predicted) AS fp,
          count(*) FILTER (WHERE NOT actual AND NOT predicted) AS tn,
          count(*) FILTER (WHERE actual AND NOT predicted) AS fn
        FROM classified`
      );
      const row = metrics.rows[0];
      const tp = Number(row.tp), fp = Number(row.fp), tn = Number(row.tn), fn = Number(row.fn);
      const falsePositiveRate = fp + tn === 0 ? 0 : fp / (fp + tn);
      const falseNegativeRate = fn + tp === 0 ? 0 : fn / (fn + tp);
      const blendRuleWeight = body.blendRuleWeight ?? Math.max(0.45, Math.min(0.8, 0.62 + falsePositiveRate * 0.12 - falseNegativeRate * 0.08));
      const active = await query("SELECT parameters FROM model_versions WHERE active = true ORDER BY created_at DESC LIMIT 1");
      const previous = active.rows[0]?.parameters ?? {};
      const parameters = {
        ...previous,
        blendRuleWeight,
        recalibratedAt: new Date().toISOString(),
        recalibrationBasis: { falsePositiveRate, falseNegativeRate, tp, fp, tn, fn }
      };
      await query("UPDATE model_versions SET active = false");
      const version = `hybrid-logit-v${Date.now()}`;
      const inserted = await query(
        "INSERT INTO model_versions (version, parameters, metrics, active) VALUES ($1,$2,$3,true) RETURNING *",
        [version, parameters, { falsePositiveRate, falseNegativeRate, tp, fp, tn, fn }]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'model_recalibrated','model_version',$2,$3)",
        [body.actor, version, { parameters }]
      );
      res.status(201).json(inserted.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/models/train", security.requireAuth("admin"), async (req, res, next) => {
    try {
      const body = z.object({
        actor: z.string().min(2).default("demo-mlops"),
        maxSamples: z.number().int().min(100).max(50000).default(50000),
        blendRuleWeight: z.number().min(0.05).max(0.95).default(0.48)
      }).parse(req.body ?? {});
      const rows = await query<TrainingRow>(
        `WITH latest_decision AS (
          SELECT DISTINCT ON (rd.alert_id) rd.alert_id, rd.decision
          FROM review_decisions rd
          ORDER BY rd.alert_id, rd.created_at DESC
        )
        SELECT
          CASE
            WHEN ld.decision = 'confirmed_fraud' THEN true
            WHEN ld.decision = 'false_positive' THEN false
            ELSE t.is_fraud_ground_truth
          END AS actual,
          COALESCE(fs.rule_score, fs.score, 0) AS rule_score,
          tf.velocity_5m,
          tf.velocity_1h,
          tf.user_tx_30d,
          tf.amount_zscore,
          tf.geo_kmh,
          tf.merchant_risk,
          tf.device_seen
        FROM transaction_features tf
        JOIN transactions t ON t.id = tf.transaction_id
        LEFT JOIN fraud_scores fs ON fs.transaction_id = tf.transaction_id
        LEFT JOIN fraud_alerts fa ON fa.transaction_id = tf.transaction_id
        LEFT JOIN latest_decision ld ON ld.alert_id = fa.id
        ORDER BY tf.created_at DESC
        LIMIT $1`,
        [body.maxSamples]
      );
      const trained = trainFraudLogisticModel(rows.rows.map(toTrainingSample), {
        blendRuleWeight: body.blendRuleWeight
      });
      await query("UPDATE model_versions SET active = false");
      const version = `trained-logit-v${Date.now()}`;
      const inserted = await query(
        "INSERT INTO model_versions (version, parameters, metrics, active) VALUES ($1,$2,$3,true) RETURNING *",
        [version, trained.parameters, trained.metrics]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'model_trained','model_version',$2,$3)",
        [body.actor, version, { metrics: trained.metrics }]
      );
      res.status(201).json(inserted.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  const loadBenchmarkSamples = async (maxSamples: number) => {
    const rows = await query<TrainingRow>(
      `WITH latest_decision AS (
        SELECT DISTINCT ON (rd.alert_id) rd.alert_id, rd.decision
        FROM review_decisions rd
        ORDER BY rd.alert_id, rd.created_at DESC
      )
      SELECT
        CASE
          WHEN ld.decision = 'confirmed_fraud' THEN true
          WHEN ld.decision = 'false_positive' THEN false
          ELSE t.is_fraud_ground_truth
        END AS actual,
        COALESCE(fs.rule_score, fs.score, 0) AS rule_score,
        tf.velocity_5m,
        tf.velocity_1h,
        tf.user_tx_30d,
        tf.amount_zscore,
        tf.geo_kmh,
        tf.merchant_risk,
        tf.device_seen
      FROM transaction_features tf
      JOIN transactions t ON t.id = tf.transaction_id
      LEFT JOIN fraud_scores fs ON fs.transaction_id = tf.transaction_id
      LEFT JOIN fraud_alerts fa ON fa.transaction_id = tf.transaction_id
      LEFT JOIN latest_decision ld ON ld.alert_id = fa.id
      ORDER BY tf.created_at DESC
      LIMIT $1`,
      [maxSamples]
    );
    return rows.rows.map(toTrainingSample);
  };

  app.get("/models/benchmarks", async (_req, res) => {
    await ensureModelRunTables();
    const result = await query("SELECT * FROM model_benchmark_runs ORDER BY created_at DESC LIMIT 20");
    res.json({ runs: result.rows });
  });

  app.post("/models/benchmarks/run", security.requireAuth("admin"), async (req, res, next) => {
    try {
      await ensureModelRunTables();
      const body = z.object({
        actor: z.string().min(2).default("demo-mlops"),
        maxSamples: z.number().int().min(50).max(50000).default(10000),
        alertThreshold: z.number().min(1).max(99).default(55),
        algorithms: z.array(z.enum(["rule_baseline", "logistic_regression", "gaussian_naive_bayes", "nearest_centroid"]))
          .min(1)
          .default(["rule_baseline", "logistic_regression", "gaussian_naive_bayes", "nearest_centroid"])
      }).parse(req.body ?? {});
      const samples = await loadBenchmarkSamples(body.maxSamples);
      const benchmark = benchmarkModels(samples, body.algorithms, body.alertThreshold);
      const inserted = await query(
        `INSERT INTO model_benchmark_runs
          (sample_size, validation_size, algorithms, results, best_algorithm, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          samples.length,
          benchmark.validationSize,
          JSON.stringify(body.algorithms),
          JSON.stringify(benchmark.results),
          benchmark.bestAlgorithm,
          body.actor
        ]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'model_benchmark_run','model_benchmark_run',$2,$3)",
        [body.actor, inserted.rows[0].id, JSON.stringify({ sampleSize: samples.length, bestAlgorithm: benchmark.bestAlgorithm })]
      );
      res.status(201).json({ run: inserted.rows[0], ...benchmark, sampleSize: samples.length });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("benchmark_requires")) {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof Error && error.message.startsWith("training_requires")) {
        return res.status(409).json({ error: error.message });
      }
      next(error);
    }
  });

  app.get("/graph/rings", async (req, res) => {
    const lookbackHours = Math.min(Math.max(Number(req.query.lookbackHours ?? 24), 1), 168);
    const minScore = Math.min(Math.max(Number(req.query.minScore ?? 55), 1), 99);
    const result = await query<SuspiciousTransactionRow>(
      `SELECT
        t.id AS transaction_id,
        t.user_id,
        t.card_id,
        t.merchant_id,
        u.full_name AS user_name,
        m.name AS merchant_name,
        t.device_fingerprint,
        t.ip_address::text AS ip_address,
        fs.score,
        fs.severity,
        t.amount,
        t.occurred_at
       FROM transactions t
       JOIN fraud_scores fs ON fs.transaction_id = t.id
       JOIN users u ON u.id = t.user_id
       JOIN merchants m ON m.id = t.merchant_id
       WHERE fs.score >= $1
         AND t.occurred_at >= now() - ($2 || ' hours')::interval
       ORDER BY fs.score DESC, t.occurred_at DESC
       LIMIT 700`,
      [minScore, lookbackHours]
    );
    res.json(buildFraudRingGraph(result.rows, lookbackHours));
  });

  app.get("/admin/overview", async (_req, res) => {
    const result = await query(
      `SELECT
        (SELECT count(*) FROM transactions WHERE created_at > now() - interval '1 hour') AS tx_1h,
        (SELECT count(*) FROM fraud_alerts WHERE created_at > now() - interval '1 hour') AS alerts_1h,
        (SELECT count(*) FROM fraud_alerts WHERE status = 'pending') AS pending_reviews,
        (SELECT COALESCE(avg(latency_ms), 0) FROM fraud_scores WHERE created_at > now() - interval '1 hour') AS avg_latency_ms`
    );
    const counts = await scoringQueue.getJobCounts("waiting", "active", "failed", "delayed");
    const [dbHealth, workerFreshness, eventFreshness] = await Promise.all([
      query("SELECT now() AS checked_at"),
      query("SELECT max(created_at) AS latest_score_at FROM fraud_scores"),
      query("SELECT max(created_at) AS latest_event_at FROM transaction_events")
    ]);
    const latestScoreAt = workerFreshness.rows[0]?.latest_score_at ? new Date(workerFreshness.rows[0].latest_score_at) : null;
    const latestEventAt = eventFreshness.rows[0]?.latest_event_at ? new Date(eventFreshness.rows[0].latest_event_at) : null;
    const scoreAgeSeconds = latestScoreAt ? Math.round((Date.now() - latestScoreAt.getTime()) / 1000) : null;
    const eventAgeSeconds = latestEventAt ? Math.round((Date.now() - latestEventAt.getTime()) / 1000) : null;
    const queueBacklog = Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0);
    res.json({
      ...result.rows[0],
      queue: counts,
      serviceHealth: [
        { service: "api", status: "healthy", detail: "Express API responding", uptimeSeconds: Math.round(process.uptime()) },
        { service: "postgres", status: "healthy", detail: `Database responded at ${dbHealth.rows[0].checked_at}` },
        {
          service: "worker",
          status: scoreAgeSeconds == null ? "unknown" : scoreAgeSeconds > 300 ? "warning" : "healthy",
          detail: scoreAgeSeconds == null ? "No scored transactions yet" : `Latest score ${scoreAgeSeconds}s ago`
        },
        {
          service: "queue",
          status: Number(counts.failed ?? 0) > 0 ? "warning" : queueBacklog > 100 ? "warning" : "healthy",
          detail: `${counts.waiting ?? 0} waiting, ${counts.active ?? 0} active, ${counts.failed ?? 0} failed`
        },
        {
          service: "events",
          status: eventAgeSeconds == null ? "unknown" : eventAgeSeconds > 300 ? "warning" : "healthy",
          detail: eventAgeSeconds == null ? "No event rows yet" : `Latest event ${eventAgeSeconds}s ago`
        }
      ]
    });
  });

  app.get("/reports/alerts.csv", security.requireAuth("analyst"), async (req, res) => {
    const lookbackHours = Math.min(Math.max(Number(req.query.lookbackHours ?? 24), 1), 720);
    const result = await query(
      `SELECT fa.id, fa.created_at, fa.status, fa.severity, fa.score, fa.confidence,
        COALESCE(fa.assigned_to, 'unassigned') AS assigned_to,
        u.full_name, m.name AS merchant_name, m.category AS merchant_category,
        t.amount, t.currency, t.channel, t.is_fraud_ground_truth
       FROM fraud_alerts fa
       JOIN users u ON u.id = fa.user_id
       JOIN merchants m ON m.id = fa.merchant_id
       JOIN transactions t ON t.id = fa.transaction_id
       WHERE fa.created_at >= now() - ($1 || ' hours')::interval
       ORDER BY fa.created_at DESC
       LIMIT 5000`,
      [lookbackHours]
    );
    const columns = [
      "id", "created_at", "status", "severity", "score", "confidence", "assigned_to",
      "full_name", "merchant_name", "merchant_category", "amount", "currency", "channel", "is_fraud_ground_truth"
    ];
    await query(
      "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'report_exported','report','alerts_csv',$2)",
      [req.auth?.actor ?? "unknown", { lookbackHours, rowCount: result.rowCount }]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fraudpulse-alerts-${lookbackHours}h.csv"`);
    res.send(toCsv(result.rows, columns));
  });

  app.get("/reports/model.json", security.requireAuth("analyst"), async (req, res) => {
    const [metrics, hybrid, drift] = await Promise.all([
      query(
        `WITH classified AS (
          SELECT t.is_fraud_ground_truth AS actual, COALESCE(fs.score >= 55, false) AS predicted
          FROM transactions t LEFT JOIN fraud_scores fs ON fs.transaction_id = t.id
        )
        SELECT
          count(*) FILTER (WHERE actual AND predicted) AS tp,
          count(*) FILTER (WHERE NOT actual AND predicted) AS fp,
          count(*) FILTER (WHERE NOT actual AND NOT predicted) AS tn,
          count(*) FILTER (WHERE actual AND NOT predicted) AS fn
        FROM classified`
      ),
      query("SELECT version, parameters, metrics, created_at FROM model_versions WHERE active = true ORDER BY created_at DESC LIMIT 1"),
      query(
        `SELECT
          count(*) AS feature_count,
          COALESCE(avg(velocity_5m), 0) AS avg_velocity_5m,
          COALESCE(avg(amount_zscore), 0) AS avg_amount_zscore,
          COALESCE(avg(geo_kmh), 0) AS avg_geo_kmh,
          COALESCE(avg(merchant_risk), 0) AS avg_merchant_risk
         FROM transaction_features
         WHERE created_at >= now() - interval '24 hours'`
      )
    ]);
    const row = metrics.rows[0];
    const tp = Number(row.tp), fp = Number(row.fp), tn = Number(row.tn), fn = Number(row.fn);
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const exported = {
      generatedAt: new Date().toISOString(),
      exportedBy: req.auth?.actor,
      model: hybrid.rows[0] ?? null,
      metrics: {
        precision,
        recall,
        f1Score: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
        falsePositiveRate: fp + tn === 0 ? 0 : fp / (fp + tn),
        truePositiveRate: recall,
        confusionMatrix: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn }
      },
      featureWindow24h: drift.rows[0] ?? null
    };
    await query(
      "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'report_exported','report','model_json',$2)",
      [req.auth?.actor ?? "unknown", { version: exported.model?.version }]
    );
    res.json(exported);
  });

  app.post("/internal/broadcast", security.requireAuth("service"), (req, res) => {
    const event = z.enum(["transaction_scored", "fraud_alert_created", "scoring_failed_dead_letter"]).parse(req.body.event);
    if (event === "fraud_alert_created") alertCount.inc({ severity: String(req.body.payload?.severity ?? "unknown") });
    io.emit(event, req.body.payload);
    res.json({ status: "broadcasted" });
  });

  app.get("/simulator/state", (_req, res) => {
    res.json({ running: simulatorRunning });
  });

  app.get("/simulator/scenarios", (_req, res) => {
    res.json(scenarios);
  });

  const scenarioIdSchema = z.enum(["card_testing_burst", "impossible_travel", "account_takeover", "merchant_collusion"]);
  const simulationRunSchema = z.object({
    scenarioId: scenarioIdSchema,
    userId: z.string().uuid().optional(),
    actor: z.string().min(2).default("demo-operator"),
    transactionCount: z.number().int().min(1).max(200).optional(),
    amountMultiplier: z.number().min(0.1).max(12).optional(),
    cadenceSeconds: z.number().int().min(5).max(3600).optional(),
    deviceStrategy: z.enum(["rotating", "shared", "trusted"]).optional(),
    ipStrategy: z.enum(["rotating", "shared", "residential"]).optional(),
    fraudRate: z.number().min(0).max(1).optional()
  });

  const loadSimulationInputs = async (userId?: string) => {
    const accountResult = await query<DemoAccount & { full_name?: string; last4?: string }>(
      `SELECT u.id AS user_id, c.id AS card_id, u.full_name, c.last4, u.home_latitude, u.home_longitude, u.baseline_daily_amount
       FROM users u
       JOIN cards c ON c.user_id = u.id
       WHERE ($1::uuid IS NULL OR u.id = $1)
       ORDER BY u.created_at
       LIMIT 1`,
      [userId ?? null]
    );
    const merchantResult = await query<DemoMerchant>(
      "SELECT id, name, category, risk_score, latitude, longitude FROM merchants ORDER BY risk_score DESC"
    );
    if (!accountResult.rowCount) throw new Error("demo_account_not_found");
    if (!merchantResult.rowCount) throw new Error("demo_merchants_not_found");
    return { account: accountResult.rows[0], merchants: merchantResult.rows };
  };

  const runSimulationCampaign = async (
    body: z.infer<typeof simulationRunSchema>,
    mode: "preset" | "lab"
  ) => {
    const { account, merchants } = await loadSimulationInputs(body.userId);
    const scenario = scenarios.find(item => item.id === body.scenarioId);
    const options: ScenarioBuildOptions = mode === "lab" ? {
      transactionCount: body.transactionCount,
      amountMultiplier: body.amountMultiplier,
      cadenceSeconds: body.cadenceSeconds,
      deviceStrategy: body.deviceStrategy,
      ipStrategy: body.ipStrategy,
      fraudRate: body.fraudRate
    } : {};
    const parameters = {
      mode,
      userId: account.user_id,
      cardId: account.card_id,
      transactionCount: options.transactionCount ?? scenario?.defaultCount,
      amountMultiplier: options.amountMultiplier ?? 1,
      cadenceSeconds: options.cadenceSeconds ?? 30,
      deviceStrategy: options.deviceStrategy ?? "scenario_default",
      ipStrategy: options.ipStrategy ?? "scenario_default",
      fraudRate: options.fraudRate ?? "scenario_default"
    };
    const run = await query<{ id: string }>(
      `INSERT INTO simulation_runs (scenario_id, actor, parameters, expected_signals)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [body.scenarioId, body.actor, JSON.stringify(parameters), JSON.stringify(scenario?.expectedSignals ?? [])]
    );
    const runId = run.rows[0].id;
    try {
      const transactions = buildScenarioTransactions(body.scenarioId, account, merchants, new Date(), options);
      const ids: string[] = [];
      for (const transaction of transactions) {
        ids.push(await createTransaction(transaction, `${mode}:${body.scenarioId}:${runId}`));
      }
      await query(
        "UPDATE simulation_runs SET status = 'completed', transaction_ids = $1::uuid[], completed_at = now() WHERE id = $2",
        [ids, runId]
      );
      await query(
        "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ($1,'scenario_replay_started','scenario',$2,$3)",
        [body.actor, body.scenarioId, JSON.stringify({ scenarioId: body.scenarioId, runId, mode, transactionCount: ids.length, transactionIds: ids })]
      );
      io.emit("scenario_replay_started", { scenarioId: body.scenarioId, runId, mode, transactionCount: ids.length });
      return { runId, scenarioId: body.scenarioId, transactionCount: ids.length, transactionIds: ids };
    } catch (error) {
      await query("UPDATE simulation_runs SET status = 'failed', error = $1, completed_at = now() WHERE id = $2", [
        error instanceof Error ? error.message : "simulation_failed",
        runId
      ]);
      throw error;
    }
  };

  app.get("/simulation/lab", async (_req, res) => {
    const [accounts, recentRuns] = await Promise.all([
      query(
        `SELECT u.id AS user_id, c.id AS card_id, u.full_name, c.last4, u.risk_tier, u.baseline_daily_amount
         FROM users u
         JOIN cards c ON c.user_id = u.id
         ORDER BY u.created_at
         LIMIT 20`
      ),
      query("SELECT * FROM simulation_runs ORDER BY started_at DESC LIMIT 20")
    ]);
    res.json({ scenarios, accounts: accounts.rows, recentRuns: recentRuns.rows });
  });

  app.get("/simulation/runs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const result = await query("SELECT * FROM simulation_runs ORDER BY started_at DESC LIMIT $1", [limit]);
    res.json(result.rows);
  });

  app.post("/simulation/runs", security.requireAuth("admin"), async (req, res, next) => {
    try {
      const body = simulationRunSchema.parse(req.body ?? {});
      const result = await runSimulationCampaign(body, "lab");
      res.status(202).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "demo_account_not_found") return res.status(404).json({ error: "demo_account_not_found" });
      if (error instanceof Error && error.message === "demo_merchants_not_found") return res.status(404).json({ error: "demo_merchants_not_found" });
      next(error);
    }
  });

  app.post("/simulator/scenarios/:id/run", security.requireAuth("admin"), async (req, res, next) => {
    try {
      const scenarioId = scenarioIdSchema.parse(req.params.id);
      const body = simulationRunSchema.parse({
        ...req.body,
        scenarioId
      });
      const result = await runSimulationCampaign(body, "preset");
      res.status(202).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "demo_account_not_found") return res.status(404).json({ error: "demo_account_not_found" });
      if (error instanceof Error && error.message === "demo_merchants_not_found") return res.status(404).json({ error: "demo_merchants_not_found" });
      next(error);
    }
  });

  app.post("/simulator/control", security.requireAuth("admin"), async (req, res) => {
    const body = z.object({ action: z.enum(["pause", "resume"]) }).parse(req.body);
    simulatorRunning = body.action === "resume";
    io.emit("simulator_control", req.body);
    res.json({ status: "control_broadcasted", running: simulatorRunning });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "request_failed");
    if (err instanceof z.ZodError) return res.status(400).json({ error: "validation_failed", details: err.flatten() });
    res.status(500).json({ error: "internal_error" });
  });

  return { app, server, io };
};
