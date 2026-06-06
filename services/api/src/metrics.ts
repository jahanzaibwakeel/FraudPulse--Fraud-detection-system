import client from "prom-client";

client.collectDefaultMetrics({ prefix: "fraudpulse_api_" });

export const transactionThroughput = new client.Counter({
  name: "fraudpulse_transactions_total",
  help: "Transactions accepted by the API"
});

export const alertCount = new client.Counter({
  name: "fraudpulse_alerts_total",
  help: "Fraud alerts observed by the API",
  labelNames: ["severity"]
});

export const reviewDecisions = new client.Counter({
  name: "fraudpulse_review_decisions_total",
  help: "Manual review decisions",
  labelNames: ["decision"]
});

export const registry = client.register;
