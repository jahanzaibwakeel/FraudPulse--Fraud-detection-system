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
  linearScore: number;
  featureContributions: Array<{
    feature: string;
    rawValue: number;
    normalizedValue: number;
    coefficient: number;
    contribution: number;
    direction: "raises_risk" | "lowers_risk" | "neutral";
  }>;
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
  const featureContributions = trainedFeatures
    ? trainedFeatures.map(feature => {
      const stats = parameters.normalization?.[feature] ?? { mean: 0, scale: 1 };
      const rawValue = rawFeatureValue(features, feature);
      const normalizedValue = (rawValue - stats.mean) / Math.max(stats.scale, 0.0001);
      const coefficient = parameters.coefficients?.[feature] ?? 0;
      const contribution = coefficient * normalizedValue;
      return {
        feature,
        rawValue: Number(rawValue.toFixed(4)),
        normalizedValue: Number(normalizedValue.toFixed(4)),
        coefficient: Number(coefficient.toFixed(6)),
        contribution: Number(contribution.toFixed(6)),
        direction: contribution > 0.0001 ? "raises_risk" as const : contribution < -0.0001 ? "lowers_risk" as const : "neutral" as const
      };
    })
    : [
      { feature: "velocity5m", rawValue: Math.min(features.velocity5m, 100), normalizedValue: Math.min(features.velocity5m, 100), coefficient: coefficients.velocity5m, contribution: coefficients.velocity5m * Math.min(features.velocity5m, 100) },
      { feature: "amountZscore", rawValue: Math.max(features.amountZscore, 0), normalizedValue: Math.max(features.amountZscore, 0), coefficient: coefficients.amountZscore, contribution: coefficients.amountZscore * Math.max(features.amountZscore, 0) },
      { feature: "geoKmh", rawValue: Math.min(features.geoKmh, 2500), normalizedValue: Math.min(features.geoKmh, 2500), coefficient: coefficients.geoKmh, contribution: coefficients.geoKmh * Math.min(features.geoKmh, 2500) },
      { feature: "merchantRisk", rawValue: features.merchantRisk, normalizedValue: features.merchantRisk, coefficient: coefficients.merchantRisk, contribution: coefficients.merchantRisk * features.merchantRisk },
      { feature: "newDevice", rawValue: features.deviceSeen ? 0 : 1, normalizedValue: features.deviceSeen ? 0 : 1, coefficient: coefficients.newDevice, contribution: coefficients.newDevice * (features.deviceSeen ? 0 : 1) },
      { feature: "userTx30d", rawValue: Math.min(features.userTx30d, 150), normalizedValue: Math.min(features.userTx30d, 150), coefficient: coefficients.userTx30d, contribution: coefficients.userTx30d * Math.min(features.userTx30d, 150) }
    ].map(item => ({
      ...item,
      rawValue: Number(item.rawValue.toFixed(4)),
      normalizedValue: Number(item.normalizedValue.toFixed(4)),
      coefficient: Number(item.coefficient.toFixed(6)),
      contribution: Number(item.contribution.toFixed(6)),
      direction: item.contribution > 0.0001 ? "raises_risk" as const : item.contribution < -0.0001 ? "lowers_risk" as const : "neutral" as const
    }));
  const linear = Number(((trainedFeatures ? parameters.coefficients?.bias ?? 0 : coefficients.bias) +
    featureContributions.reduce((sum, item) => sum + item.contribution, 0)).toFixed(6));
  const modelProbability = sigmoid(linear);
  const mlScore = clamp(modelProbability * 100, 0, 99);
  const blendRuleWeight = clamp(parameters.blendRuleWeight ?? 0.62, 0.05, 0.95);
  const blendedScore = clamp(ruleScore * blendRuleWeight + mlScore * (1 - blendRuleWeight), 0, 99);

  return {
    modelProbability: Number(modelProbability.toFixed(5)),
    mlScore: Number(mlScore.toFixed(2)),
    blendedScore: Number(blendedScore.toFixed(2)),
    blendRuleWeight,
    linearScore: linear,
    featureContributions: featureContributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  };
};
