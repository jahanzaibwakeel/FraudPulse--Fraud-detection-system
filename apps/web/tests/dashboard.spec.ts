import { expect, test } from "@playwright/test";

test("dashboard renders live monitoring surface", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Live Fraud Monitoring" })).toBeVisible();
  await expect(page.getByText("Transaction Stream")).toBeVisible();
});

test("security console renders hardening surface", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Security & Reports" })).toBeVisible();
  await expect(page.getByText("Protected Exports")).toBeVisible();
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
