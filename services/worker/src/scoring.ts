import { haversineKm, severityFromScore, type FraudScoreResult, type ScoreReason } from "@fraudpulse/shared";

export interface RuleRow {
  code: string;
  weight: string | number;
  enabled: boolean;
  threshold: Record<string, number | undefined>;
}

export interface TransactionContext {
  transaction: {
    id: string;
    user_id: string;
    merchant_id: string;
    amount: string | number;
    occurred_at: string;
    latitude: string | number;
    longitude: string | number;
    device_fingerprint: string;
  };
  merchant: { risk_score: number; name: string; category: string };
  recentTransactions: Array<{
    id: string;
    amount: string | number;
    occurred_at: string;
    latitude: string | number;
    longitude: string | number;
    device_fingerprint: string;
  }>;
  rules: RuleRow[];
  modelVersion: string;
}

const getRule = (rules: RuleRow[], code: string) => rules.find(rule => rule.code === code && rule.enabled);

export const buildFeatureVector = (context: TransactionContext) => {
  const tx = context.transaction;
  const amount = Number(tx.amount);
  const txTime = new Date(tx.occurred_at).getTime();
  const history = context.recentTransactions.filter(item => item.id !== tx.id);
  const amounts = history.map(item => Number(item.amount));
  const amountMean = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : 0;
  const variance = amounts.length ? amounts.reduce((sum, value) => sum + (value - amountMean) ** 2, 0) / amounts.length : 0;
  const amountStddev = Math.max(Math.sqrt(variance), 1);
  const amountZscore = amounts.length ? (amount - amountMean) / amountStddev : 0;
  const velocity5m = history.filter(item => {
    const diffMinutes = (txTime - new Date(item.occurred_at).getTime()) / 60000;
    return diffMinutes >= 0 && diffMinutes <= 5;
  }).length;
  const velocity1h = history.filter(item => {
    const diffMinutes = (txTime - new Date(item.occurred_at).getTime()) / 60000;
    return diffMinutes >= 0 && diffMinutes <= 60;
  }).length;
  const previous = history[0];
  const geoDistanceKm = previous
    ? haversineKm(
      { latitude: Number(previous.latitude), longitude: Number(previous.longitude) },
      { latitude: Number(tx.latitude), longitude: Number(tx.longitude) }
    )
    : 0;
  const geoHours = previous ? Math.max((txTime - new Date(previous.occurred_at).getTime()) / 3600000, 0.05) : 0;
  const geoKmh = previous ? geoDistanceKm / geoHours : 0;
  const deviceSeen = history.some(item => item.device_fingerprint === tx.device_fingerprint);

  return {
    velocity5m,
    velocity1h,
    userTx30d: history.length,
    amountMean: Number(amountMean.toFixed(2)),
    amountStddev: Number(amountStddev.toFixed(2)),
    amountZscore: Number(amountZscore.toFixed(4)),
    geoDistanceKm: Number(geoDistanceKm.toFixed(2)),
    geoKmh: Number(geoKmh.toFixed(2)),
    merchantRisk: context.merchant.risk_score,
    deviceSeen
  };
};

export const scoreTransaction = (context: TransactionContext): FraudScoreResult => {
  const started = performance.now();
  const tx = context.transaction;
  const amount = Number(tx.amount);
  const reasons: ScoreReason[] = [];
  const addReason = (rule: RuleRow, ratio: number, description: string, evidence: ScoreReason["evidence"]) => {
    const impact = Math.min(Number(rule.weight), Number(rule.weight) * ratio);
    if (impact <= 0) return;
    reasons.push({
      rule: rule.code,
      scoreImpact: Number(impact.toFixed(2)),
      confidence: Number(Math.min(0.99, 0.55 + ratio * 0.4).toFixed(3)),
      description,
      evidence
    });
  };

  const txTime = new Date(tx.occurred_at).getTime();

  const velocityRule = getRule(context.rules, "velocity_5m");
  if (velocityRule) {
    const maxCount = velocityRule.threshold.maxCount ?? 5;
    const recentCount = context.recentTransactions.filter(item => {
      const diffMinutes = (txTime - new Date(item.occurred_at).getTime()) / 60000;
      return item.id !== tx.id && diffMinutes >= 0 && diffMinutes <= 5;
    }).length;
    if (recentCount >= maxCount) {
      addReason(velocityRule, recentCount / maxCount, `User made ${recentCount} transactions in five minutes.`, {
        recentCount,
        maxCount
      });
    }
  }

  const amountRule = getRule(context.rules, "amount_zscore");
  if (amountRule) {
    const history = context.recentTransactions.filter(item => item.id !== tx.id).map(item => Number(item.amount));
    const minHistory = amountRule.threshold.minHistory ?? 8;
    if (history.length >= minHistory) {
      const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
      const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
      const stddev = Math.max(Math.sqrt(variance), 1);
      const zScore = (amount - mean) / stddev;
      const threshold = amountRule.threshold.zScore ?? 2.5;
      if (zScore >= threshold) {
        addReason(amountRule, zScore / threshold, `Amount is ${zScore.toFixed(1)} standard deviations above user baseline.`, {
          amount,
          mean: Number(mean.toFixed(2)),
          zScore: Number(zScore.toFixed(2))
        });
      }
    }
  }

  const geoRule = getRule(context.rules, "geo_impossible");
  if (geoRule) {
    const previous = context.recentTransactions.find(item => item.id !== tx.id);
    if (previous) {
      const km = haversineKm(
        { latitude: Number(previous.latitude), longitude: Number(previous.longitude) },
        { latitude: Number(tx.latitude), longitude: Number(tx.longitude) }
      );
      const hours = Math.max((txTime - new Date(previous.occurred_at).getTime()) / 3600000, 0.05);
      const kmh = km / hours;
      const threshold = geoRule.threshold.kmh ?? 850;
      if (kmh >= threshold) {
        addReason(geoRule, kmh / threshold, `Location implies ${kmh.toFixed(0)} km/h travel since prior transaction.`, {
          distanceKm: Number(km.toFixed(1)),
          hours: Number(hours.toFixed(2)),
          kmh: Number(kmh.toFixed(0))
        });
      }
    }
  }

  const merchantRule = getRule(context.rules, "merchant_risk");
  if (merchantRule) {
    const threshold = merchantRule.threshold.riskScore ?? 70;
    if (context.merchant.risk_score >= threshold) {
      addReason(merchantRule, context.merchant.risk_score / 100, `Merchant category has elevated historical risk.`, {
        merchant: context.merchant.name,
        category: context.merchant.category,
        merchantRisk: context.merchant.risk_score
      });
    }
  }

  const deviceRule = getRule(context.rules, "new_device");
  if (deviceRule) {
    const seenDevice = context.recentTransactions.some(item => item.id !== tx.id && item.device_fingerprint === tx.device_fingerprint);
    if (!seenDevice && context.recentTransactions.length >= 3) {
      addReason(deviceRule, 0.9, "Device fingerprint has not appeared in recent user history.", {
        deviceFingerprint: tx.device_fingerprint
      });
    }
  }

  const rawScore = reasons.reduce((sum, reason) => sum + reason.scoreImpact, 0);
  const score = Number(Math.min(99, rawScore).toFixed(2));
  const confidence = reasons.length === 0
    ? 0.22
    : Number(Math.min(0.99, reasons.reduce((sum, reason) => sum + reason.confidence, 0) / reasons.length).toFixed(3));

  return {
    transactionId: tx.id,
    score,
    confidence,
    severity: severityFromScore(score),
    reasons,
    latencyMs: Math.round(performance.now() - started),
    modelVersion: context.modelVersion
  };
};
