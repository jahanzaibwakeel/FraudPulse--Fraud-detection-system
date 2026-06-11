import { expect, test } from "@playwright/test";

test("dashboard renders live monitoring surface", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Live Fraud Monitoring" })).toBeVisible();
  await expect(page.getByText("Transaction Stream")).toBeVisible();
});

test("security console renders hardening surface", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Security & Reports" })).toBeVisible();
  await expect(page.getByText("Session Controls")).toBeVisible();
  await expect(page.getByText("Protected Exports")).toBeVisible();
  await expect(page.getByText("Token Rotation Plan")).toBeVisible();
});

test("performance page exposes local model training", async ({ page }) => {
  await page.goto("/performance");
  await expect(page.getByRole("heading", { name: "Model and Rule Performance" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Train Local Model/i })).toBeVisible();
  await expect(page.getByText("Trained Model Feature Drivers")).toBeVisible();
});

test("model registry exposes champion challenger workflow", async ({ page }) => {
  await page.goto("/models");
  await expect(page.getByRole("heading", { name: "Model Registry" })).toBeVisible();
  await expect(page.getByText("Model Versions")).toBeVisible();
  await expect(page.getByRole("button", { name: /Shadow Score/i })).toBeVisible();
});

test("risk memory page renders entity risk surface", async ({ page }) => {
  await page.goto("/risk");
  await expect(page.getByRole("heading", { name: "Risk Memory" })).toBeVisible();
  await expect(page.getByText("Highest Risk Entities")).toBeVisible();
});

test("alert detail renders case investigation workspace", async ({ page }) => {
  const evidenceBundle = {
    alert: {
      id: "e2e-alert",
      severity: "critical",
      score: "91",
      confidence: "0.88",
      status: "pending",
      assigned_to: null,
      priority: 1,
      due_at: "2026-06-11T16:00:00.000Z",
      reasons: [{
        rule: "velocity_5m",
        description: "Multiple transactions appeared in a short time window.",
        scoreImpact: 24,
        confidence: 0.91,
        evidence: { count: 7 }
      }]
    },
    transaction: {
      id: "tx-e2e-0001",
      user_id: "user-e2e",
      card_id: "card-e2e",
      merchant_id: "merchant-e2e",
      amount: "1840.50",
      currency: "USD",
      channel: "card_present",
      occurred_at: "2026-06-11T12:00:00.000Z",
      latitude: "40.7128",
      longitude: "-74.0060",
      device_fingerprint: "device-e2e-fingerprint",
      ip_address: "203.0.113.42"
    },
    user: { id: "user-e2e", full_name: "Amina Khan", risk_tier: "high" },
    merchant: { id: "merchant-e2e", name: "Metro Electronics", category: "electronics", risk_score: 82 },
    featureSnapshot: {
      velocity_5m: 7,
      velocity_1h: 12,
      amount_zscore: "4.12",
      geo_distance_km: "890.4",
      geo_kmh: "1420.2",
      merchant_risk: 82,
      device_seen: false
    },
    summary: {
      reasonCount: 1,
      highRiskEntityCount: 1,
      relatedTransactionCount: 2,
      openMerchantAlerts: 1,
      latestSnapshotAt: null
    },
    entityRisk: [{
      id: "entity-risk-e2e",
      entity_type: "merchant",
      entity_id: "merchant-e2e",
      risk_score: "82",
      transaction_count: 18,
      alert_count: 4,
      evidence: {}
    }],
    relatedActivity: {
      userTransactions: [],
      cardTransactions: [],
      deviceTransactions: [{
        id: "related-device-e2e",
        amount: "220.00",
        currency: "USD",
        channel: "online",
        occurred_at: "2026-06-11T11:58:00.000Z",
        merchant_name: "Metro Electronics",
        full_name: "Amina Khan",
        score: "72",
        severity: "high",
        alert_id: "e2e-alert"
      }],
      ipTransactions: [],
      merchantAlerts: [{
        id: "e2e-alert",
        severity: "critical",
        score: "91",
        status: "pending",
        created_at: "2026-06-11T12:00:00.000Z",
        full_name: "Amina Khan",
        amount: "1840.50",
        currency: "USD"
      }]
    },
    recommendedActions: ["Review customer contact history"],
    timeline: [{ type: "created", actor: "system", title: "Alert created", created_at: "2026-06-11T12:00:00.000Z" }],
    latestSnapshot: null
  };

  await page.route("**/cases/e2e-alert/evidence**", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(evidenceBundle)
  }));

  await page.goto("/alerts/e2e-alert");
  await expect(page.getByText("Case Investigation Workspace")).toBeVisible();
  await expect(page.getByText("Evidence Bundle")).toBeVisible();
  await expect(page.getByText("Related Device Activity")).toBeVisible();
});

test("data quality page renders drift alert controls", async ({ page }) => {
  await page.goto("/quality");
  await expect(page.getByRole("heading", { name: "Data Quality" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run Checks/i })).toBeVisible();
  await expect(page.getByText("Feature Drift Alerts")).toBeVisible();
});

test("simulation lab renders configurable campaign controls", async ({ page }) => {
  await page.goto("/simulation");
  await expect(page.getByRole("heading", { name: "Simulation Lab" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Launch Campaign/i })).toBeVisible();
  await expect(page.getByText("Scenario Library")).toBeVisible();
});

test("model benchmarks page renders local algorithm suite", async ({ page }) => {
  await page.goto("/benchmarks");
  await expect(page.getByRole("heading", { name: "Model Benchmarks" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run Benchmark/i })).toBeVisible();
  await expect(page.getByText("Algorithm Comparison")).toBeVisible();
});
