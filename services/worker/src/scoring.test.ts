import { describe, expect, it } from "vitest";
import { scoreTransaction } from "./scoring.js";

const rules = [
  { code: "velocity_5m", enabled: true, weight: 22, threshold: { maxCount: 3 } },
  { code: "amount_zscore", enabled: true, weight: 24, threshold: { zScore: 2, minHistory: 3 } },
  { code: "geo_impossible", enabled: true, weight: 26, threshold: { kmh: 850 } },
  { code: "merchant_risk", enabled: true, weight: 16, threshold: { riskScore: 70 } },
  { code: "new_device", enabled: true, weight: 12, threshold: {} }
];

describe("scoreTransaction", () => {
  it("explains multi-factor suspicious behavior", () => {
    const now = new Date("2026-06-05T12:00:00Z");
    const result = scoreTransaction({
      transaction: {
        id: "tx-new",
        user_id: "user-1",
        merchant_id: "merchant-1",
        amount: 1400,
        occurred_at: now.toISOString(),
        latitude: 51.507351,
        longitude: -0.127758,
        device_fingerprint: "new-device"
      },
      merchant: { name: "VaultByte Exchange", category: "crypto", risk_score: 90 },
      recentTransactions: [
        { id: "tx-new", amount: 1400, occurred_at: now.toISOString(), latitude: 51.507351, longitude: -0.127758, device_fingerprint: "new-device" },
        { id: "1", amount: 50, occurred_at: "2026-06-05T11:58:00Z", latitude: 40.7128, longitude: -74.006, device_fingerprint: "known" },
        { id: "2", amount: 55, occurred_at: "2026-06-05T11:57:00Z", latitude: 40.7128, longitude: -74.006, device_fingerprint: "known" },
        { id: "3", amount: 60, occurred_at: "2026-06-05T11:56:00Z", latitude: 40.7128, longitude: -74.006, device_fingerprint: "known" },
        { id: "4", amount: 65, occurred_at: "2026-06-04T11:56:00Z", latitude: 40.7128, longitude: -74.006, device_fingerprint: "known" }
      ],
      rules,
      modelVersion: "test"
    });

    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(result.reasons.map(reason => reason.rule)).toContain("geo_impossible");
    expect(result.reasons.map(reason => reason.rule)).toContain("merchant_risk");
  });
});
