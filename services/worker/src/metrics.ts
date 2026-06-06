import client from "prom-client";

client.collectDefaultMetrics({ prefix: "fraudpulse_worker_" });

export const scoringLatency = new client.Histogram({
  name: "fraudpulse_scoring_latency_ms",
  help: "Fraud scoring latency in milliseconds",
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500]
});

export const workerAlerts = new client.Counter({
  name: "fraudpulse_worker_alerts_total",
  help: "Fraud alerts created by worker",
  labelNames: ["severity"]
});

export const confirmedFraud = new client.Gauge({
  name: "fraudpulse_confirmed_fraud_count",
  help: "Confirmed fraud review decisions"
});

export const falsePositive = new client.Gauge({
  name: "fraudpulse_false_positive_count",
  help: "False positive review decisions"
});

export const queueDepth = new client.Gauge({
  name: "fraudpulse_queue_depth",
  help: "BullMQ waiting plus delayed scoring jobs"
});

export const registry = client.register;
