import type { FraudFeatureName, FraudModelParameters } from "@fraudpulse/shared";

export interface FeatureVector {
  velocity5m: number;
  velocity1h: number;
  userTx30d: number;
  amountMean: number;
  amountStddev: number;
  amountZscore: number;
  geoDistanceKm: number;
  geoKmh: number;
  merchantRisk: number;
  deviceSeen: boolean;
}

export interface HybridModelParameters {
  modelKind?: "trained_logistic_regression";
  trainingAlgorithm?: "logistic_regression_sgd";
  featureNames?: FraudFeatureName[];
  normalization?: FraudModelParameters["normalization"];
  blendRuleWeight?: number;
  coefficients?: Partial<Record<FraudFeatureName | "bias", number>> & {
    bias?: number;
    velocity5m?: number;
    velocity1h?: number;
    amountZscore?: number;
    geoKmh?: number;
    merchantRisk?: number;
    newDevice?: number;
    userTx30d?: number;
  };
}

export interface HybridScore {
  modelProbability: number;
  mlScore: number;
  blendedScore: number;
  blendRuleWeight: number;
}

const defaults: Record<"bias" | "velocity5m" | "velocity1h" | "amountZscore" | "geoKmh" | "merchantRisk" | "newDevice" | "userTx30d", number> = {
  bias: -2.35,
  velocity5m: 0.028,
  velocity1h: 0,
  amountZscore: 0.42,
  geoKmh: 0.00085,
  merchantRisk: 0.018,
  newDevice: 0.78,
  userTx30d: 0.006
};

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const rawFeatureValue = (features: FeatureVector, feature: FraudFeatureName) => {
  if (feature === "newDevice") return features.deviceSeen ? 0 : 1;
  if (feature === "velocity5m") return Math.min(Math.max(features.velocity5m, 0), 100);
  if (feature === "velocity1h") return Math.min(Math.max(features.velocity1h, 0), 400);
  if (feature === "amountZscore") return clamp(features.amountZscore, -5, 8);
  if (feature === "geoKmh") return Math.min(Math.max(features.geoKmh, 0), 2500);
  if (feature === "merchantRisk") return clamp(features.merchantRisk, 0, 100);
  return Math.min(Math.max(features.userTx30d, 0), 150);
};

export const scoreHybridModel = (
  features: FeatureVector,
  ruleScore: number,
  parameters: HybridModelParameters = {}
): HybridScore => {
  const coefficients = { ...defaults, ...(parameters.coefficients ?? {}) };
  const trainedFeatures = parameters.modelKind === "trained_logistic_regression" && parameters.featureNames?.length
    ? parameters.featureNames
    : null;
  const linear = trainedFeatures
    ? trainedFeatures.reduce((sum, feature) => {
      const stats = parameters.normalization?.[feature] ?? { mean: 0, scale: 1 };
      const normalized = (rawFeatureValue(features, feature) - stats.mean) / Math.max(stats.scale, 0.0001);
      return sum + (parameters.coefficients?.[feature] ?? 0) * normalized;
    }, parameters.coefficients?.bias ?? 0)
    : coefficients.bias +
      coefficients.velocity5m * Math.min(features.velocity5m, 100) +
      coefficients.amountZscore * Math.max(features.amountZscore, 0) +
      coefficients.geoKmh * Math.min(features.geoKmh, 2500) +
      coefficients.merchantRisk * features.merchantRisk +
      coefficients.newDevice * (features.deviceSeen ? 0 : 1) +
      coefficients.userTx30d * Math.min(features.userTx30d, 150);
  const modelProbability = sigmoid(linear);
  const mlScore = clamp(modelProbability * 100, 0, 99);
  const blendRuleWeight = clamp(parameters.blendRuleWeight ?? 0.62, 0.05, 0.95);
  const blendedScore = clamp(ruleScore * blendRuleWeight + mlScore * (1 - blendRuleWeight), 0, 99);

  return {
    modelProbability: Number(modelProbability.toFixed(5)),
    mlScore: Number(mlScore.toFixed(2)),
    blendedScore: Number(blendedScore.toFixed(2)),
    blendRuleWeight
  };
};
