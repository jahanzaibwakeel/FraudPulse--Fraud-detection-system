import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:13000";
const outputDir = process.env.SCREENSHOT_DIR ?? "docs/screenshots";
const settleMs = Number(process.env.SCREENSHOT_SETTLE_MS ?? 2500);

const targets = [
  { path: "/", file: "01-live-dashboard.png", label: "Live Fraud Monitoring" },
  { path: "/alerts", file: "02-alert-center.png", label: "Fraud Alert Center" },
  { path: "/performance", file: "03-model-performance.png", label: "Model and Rule Performance" },
  { path: "/security", file: "04-security-console.png", label: "Security & Reports" }
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });

for (const target of targets) {
  const url = new URL(target.path, baseUrl).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: target.label }).waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `${outputDir}/${target.file}`, fullPage: true });
  console.log(`captured ${target.label}: ${outputDir}/${target.file}`);
}

await browser.close();
