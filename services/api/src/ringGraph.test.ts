import { describe, expect, it } from "vitest";
import { buildFraudRingGraph, type SuspiciousTransactionRow } from "./ringGraph.js";

const base = {
  user_name: "Ava Patel",
  merchant_name: "VaultByte Exchange",
  severity: "high",
  amount: 900,
  occurred_at: "2026-06-05T12:00:00Z"
};

describe("buildFraudRingGraph", () => {
  it("connects shared devices and IPs into a high-risk ring", () => {
    const rows: SuspiciousTransactionRow[] = [
      {
        ...base,
        transaction_id: "t1",
        user_id: "u1",
        card_id: "c1",
        merchant_id: "m1",
        device_fingerprint: "device-risk",
        ip_address: "45.91.20.100",
        score: 88
      },
      {
        ...base,
        transaction_id: "t2",
        user_id: "u2",
        card_id: "c2",
        merchant_id: "m1",
        device_fingerprint: "device-risk",
        ip_address: "45.91.20.100",
        score: 91
      }
    ];

    const graph = buildFraudRingGraph(rows, 24, new Date("2026-06-05T13:00:00Z"));

    expect(graph.rings).toHaveLength(1);
    expect(graph.rings[0].strongestSignals).toContain("shared device or IP");
    expect(graph.rings[0].riskScore).toBeGreaterThanOrEqual(90);
  });
});
