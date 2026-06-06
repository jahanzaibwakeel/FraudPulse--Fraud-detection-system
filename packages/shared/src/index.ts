import { z } from "zod";
export * from "./modelTraining.js";

export const TransactionInputSchema = z.object({
  userId: z.string().uuid(),
  cardId: z.string().uuid(),
  merchantId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  occurredAt: z.string().datetime().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  channel: z.enum(["pos", "ecommerce", "atm", "wallet"]),
  deviceFingerprint: z.string().min(6),
  ipAddress: z.string(),
  isFraudGroundTruth: z.boolean().optional()
});

export type TransactionInput = z.infer<typeof TransactionInputSchema>;

export type EventType =
  | "transaction_created"
  | "transaction_scored"
  | "fraud_alert_created"
  | "scoring_failed_dead_letter"
  | "review_decision_recorded";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type ReviewStatus = "pending" | "confirmed_fraud" | "false_positive";

export interface ScoreReason {
  rule: string;
  scoreImpact: number;
  confidence: number;
  description: string;
  evidence: Record<string, string | number | boolean | null>;
}

export interface FraudScoreResult {
  transactionId: string;
  score: number;
  confidence: number;
  severity: AlertSeverity;
  reasons: ScoreReason[];
  latencyMs: number;
  modelVersion: string;
}

export interface LiveTransaction {
  id: string;
  userId: string;
  cardId: string;
  merchantId: string;
  merchantName: string;
  merchantCategory: string;
  amount: number;
  currency: string;
  occurredAt: string;
  latitude: number;
  longitude: number;
  channel: string;
  status: string;
  score?: number;
  severity?: AlertSeverity;
}

export interface FraudAlert {
  id: string;
  transactionId: string;
  userId: string;
  merchantId: string;
  severity: AlertSeverity;
  score: number;
  confidence: number;
  status: ReviewStatus;
  reasons: ScoreReason[];
  createdAt: string;
}

export interface ModelMetrics {
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  truePositiveRate: number;
  confusionMatrix: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
  };
}

export const severityFromScore = (score: number): AlertSeverity => {
  if (score >= 90) return "critical";
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  return "low";
};

export const haversineKm = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) => {
  const earthKm = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(h));
};
