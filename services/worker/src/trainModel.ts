import { trainFraudLogisticModel, type FraudTrainingSample } from "@fraudpulse/shared";
import { query } from "./db.js";
import { logger } from "./logger.js";

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

const toSample = (row: TrainingRow): FraudTrainingSample => ({
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

const run = async () => {
  const result = await query<TrainingRow>(
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
    LIMIT 50000`
  );
  const samples = result.rows.map(toSample);
  const trained = trainFraudLogisticModel(samples);
  await query("UPDATE model_versions SET active = false");
  const version = `trained-logit-v${Date.now()}`;
  await query(
    "INSERT INTO model_versions (version, parameters, metrics, active) VALUES ($1,$2,$3,true)",
    [version, trained.parameters, trained.metrics]
  );
  await query(
    "INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload) VALUES ('ml.training','model_trained','model_version',$1,$2)",
    [version, { metrics: trained.metrics }]
  );
  logger.info({ version, metrics: trained.metrics }, "trained_model_activated");
  process.exit(0);
};

run().catch(error => {
  logger.error({ error }, "model_training_failed");
  process.exit(1);
});
