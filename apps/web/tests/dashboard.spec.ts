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

test("alert detail opens case investigation workspace", async ({ page }) => {
  await page.goto("/alerts");
  await page.locator("tbody a").first().click();
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
