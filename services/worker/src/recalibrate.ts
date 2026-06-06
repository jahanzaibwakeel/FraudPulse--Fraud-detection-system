import { query } from "./db.js";
import { logger } from "./logger.js";

const run = async () => {
  const result = await query(
    `WITH scored AS (
      SELECT t.is_fraud_ground_truth AS actual, fs.score
      FROM transactions t JOIN fraud_scores fs ON fs.transaction_id = t.id
    )
    SELECT
      percentile_cont(0.90) WITHIN GROUP (ORDER BY score) FILTER (WHERE NOT actual) AS p90_legit,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY score) FILTER (WHERE actual) AS p25_fraud,
      count(*) AS sample_size
    FROM scored`
  );
  const row = result.rows[0];
  const p90Legit = Number(row.p90_legit ?? 55);
  const p25Fraud = Number(row.p25_fraud ?? 70);
  const alertThreshold = Math.max(45, Math.min(75, Math.round((p90Legit + p25Fraud) / 2)));
  await query(
    `INSERT INTO model_versions (version, parameters, metrics, active)
     VALUES ($1,$2,$3,false)`,
    [
      `rules-stat-v${Date.now()}`,
      { alertThreshold, note: "Batch recalibration from reviewed/synthetic score distribution" },
      { sampleSize: Number(row.sample_size), p90Legit, p25Fraud }
    ]
  );
  logger.info({ alertThreshold, sampleSize: Number(row.sample_size) }, "recalibration_complete");
  await query("SELECT 1");
  process.exit(0);
};

run().catch(error => {
  logger.error({ error }, "recalibration_failed");
  process.exit(1);
});
