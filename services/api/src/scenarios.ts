import type { TransactionInput } from "@fraudpulse/shared";

export type ScenarioId = "card_testing_burst" | "impossible_travel" | "account_takeover";

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  description: string;
  expectedSignals: string[];
}

export interface DemoAccount extends Record<string, unknown> {
  user_id: string;
  card_id: string;
  home_latitude: string | number;
  home_longitude: string | number;
  baseline_daily_amount: string | number;
}

export interface DemoMerchant extends Record<string, unknown> {
  id: string;
  name: string;
  category: string;
  risk_score: string | number;
  latitude: string | number;
  longitude: string | number;
}

export const scenarios: ScenarioDefinition[] = [
  {
    id: "card_testing_burst",
    name: "Card Testing Burst",
    description: "A compromised card is tested with rapid ecommerce purchases across risky merchants.",
    expectedSignals: ["velocity_5m", "merchant_risk", "new_device"]
  },
  {
    id: "impossible_travel",
    name: "Impossible Travel",
    description: "A normal local purchase is followed minutes later by a high-risk overseas transaction.",
    expectedSignals: ["geo_impossible", "amount_zscore", "merchant_risk"]
  },
  {
    id: "account_takeover",
    name: "Account Takeover",
    description: "A new device makes high-value crypto and ATM transactions outside the customer baseline.",
    expectedSignals: ["amount_zscore", "new_device", "merchant_risk", "velocity_5m"]
  }
];

const riskyMerchant = (merchants: DemoMerchant[]) =>
  [...merchants].sort((a, b) => Number(b.risk_score) - Number(a.risk_score))[0];

const merchantByCategory = (merchants: DemoMerchant[], category: string) =>
  merchants.find(merchant => merchant.category === category) ?? riskyMerchant(merchants);

const ip = (index: number) => `45.91.${20 + index}.${100 + index}`;

export const buildScenarioTransactions = (
  scenarioId: ScenarioId,
  account: DemoAccount,
  merchants: DemoMerchant[],
  startedAt = new Date()
): TransactionInput[] => {
  const baseline = Number(account.baseline_daily_amount);
  const homeLatitude = Number(account.home_latitude);
  const homeLongitude = Number(account.home_longitude);
  const highRisk = riskyMerchant(merchants);
  const crypto = merchantByCategory(merchants, "crypto");
  const atm = merchantByCategory(merchants, "atm");
  const grocery = merchantByCategory(merchants, "grocery");

  const base = {
    userId: account.user_id,
    cardId: account.card_id,
    currency: "USD" as const
  };

  if (scenarioId === "impossible_travel") {
    return [
      {
        ...base,
        merchantId: grocery.id,
        amount: 42.18,
        occurredAt: new Date(startedAt.getTime()).toISOString(),
        latitude: homeLatitude,
        longitude: homeLongitude,
        channel: "pos",
        deviceFingerprint: `trusted-${account.user_id.slice(0, 8)}`,
        ipAddress: "73.44.21.10",
        isFraudGroundTruth: false
      },
      {
        ...base,
        merchantId: crypto.id,
        amount: Number((baseline * 5.8).toFixed(2)),
        occurredAt: new Date(startedAt.getTime() + 6 * 60_000).toISOString(),
        latitude: Number(crypto.latitude),
        longitude: Number(crypto.longitude),
        channel: "ecommerce",
        deviceFingerprint: `takeover-${Date.now()}`,
        ipAddress: "45.18.22.91",
        isFraudGroundTruth: true
      }
    ];
  }

  if (scenarioId === "account_takeover") {
    return Array.from({ length: 7 }, (_, index) => {
      const merchant = index % 3 === 0 ? atm : crypto;
      return {
        ...base,
        merchantId: merchant.id,
        amount: Number((baseline * (2.7 + index * 0.45)).toFixed(2)),
        occurredAt: new Date(startedAt.getTime() + index * 42_000).toISOString(),
        latitude: Number(merchant.latitude),
        longitude: Number(merchant.longitude),
        channel: merchant.category === "atm" ? "atm" : "ecommerce",
        deviceFingerprint: `ato-device-${startedAt.getTime()}`,
        ipAddress: ip(index),
        isFraudGroundTruth: true
      };
    });
  }

  return Array.from({ length: 14 }, (_, index) => ({
    ...base,
    merchantId: index % 2 === 0 ? highRisk.id : crypto.id,
    amount: Number((12 + index * 7.35).toFixed(2)),
    occurredAt: new Date(startedAt.getTime() + index * 18_000).toISOString(),
    latitude: Number(highRisk.latitude),
    longitude: Number(highRisk.longitude),
    channel: "ecommerce",
    deviceFingerprint: `card-test-${startedAt.getTime()}-${index}`,
    ipAddress: ip(index),
    isFraudGroundTruth: true
  }));
};
