export type FraudFeatureName =
  | "velocity5m"
  | "velocity1h"
  | "amountZscore"
  | "geoKmh"
  | "merchantRisk"
  | "newDevice"
  | "userTx30d";

export type FraudTrainingFeatures = {
  velocity5m: number;
  velocity1h: number;
  userTx30d: number;
  amountZscore: number;
  geoKmh: number;
  merchantRisk: number;
  deviceSeen: boolean;
};

export type FraudTrainingSample = {
  actual: boolean;
  ruleScore: number;
  features: FraudTrainingFeatures;
};

export type FraudModelParameters = {
  modelKind: "trained_logistic_regression";
  trainingAlgorithm: "logistic_regression_sgd";
  featureNames: FraudFeatureName[];
  coefficients: Record<FraudFeatureName | "bias", number>;
  normalization: Record<FraudFeatureName, { mean: number; scale: number }>;
  blendRuleWeight: number;
  alertThreshold: number;
  trainedAt: string;
  trainingWindow: {
    sampleSize: number;
    fraudSamples: number;
    legitimateSamples: number;
  };
};

export type FraudModelMetrics = {
  sampleSize: number;
  trainSize: number;
  validationSize: number;
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
  epochs: number;
  learningRate: number;
  l2: number;
};

export type TrainFraudModelOptions = {
  epochs?: number;
  learningRate?: number;
  l2?: number;
  blendRuleWeight?: number;
  alertThreshold?: number;
};

const featureNames: FraudFeatureName[] = [
  "velocity5m",
  "velocity1h",
  "amountZscore",
  "geoKmh",
  "merchantRisk",
  "newDevice",
  "userTx30d"
];

const sigmoid = (value: number) => {
  if (value < -35) return 0;
  if (value > 35) return 1;
  return 1 / (1 + Math.exp(-value));
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const rawFeatureValue = (features: FraudTrainingFeatures, feature: FraudFeatureName) => {
  if (feature === "newDevice") return features.deviceSeen ? 0 : 1;
  if (feature === "velocity5m") return Math.min(Math.max(features.velocity5m, 0), 100);
  if (feature === "velocity1h") return Math.min(Math.max(features.velocity1h, 0), 400);
  if (feature === "amountZscore") return clamp(features.amountZscore, -5, 8);
  if (feature === "geoKmh") return Math.min(Math.max(features.geoKmh, 0), 2500);
  if (feature === "merchantRisk") return clamp(features.merchantRisk, 0, 100);
  return Math.min(Math.max(features.userTx30d, 0), 150);
};

const normalizedVector = (
  sample: FraudTrainingSample,
  normalization: FraudModelParameters["normalization"]
) => featureNames.map(feature => {
  const stats = normalization[feature];
  return (rawFeatureValue(sample.features, feature) - stats.mean) / stats.scale;
});

const linearScore = (weights: number[], vector: number[]) =>
  weights[0] + vector.reduce((sum, value, index) => sum + weights[index + 1] * value, 0);

const metricsFor = (
  samples: FraudTrainingSample[],
  weights: number[],
  normalization: FraudModelParameters["normalization"],
  blendRuleWeight: number,
  alertThreshold: number
) => {
  const matrix = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (const sample of samples) {
    const probability = sigmoid(linearScore(weights, normalizedVector(sample, normalization)));
    const mlScore = probability * 100;
    const blendedScore = sample.ruleScore * blendRuleWeight + mlScore * (1 - blendRuleWeight);
    const predicted = blendedScore >= alertThreshold;
    if (sample.actual && predicted) matrix.truePositive += 1;
    else if (!sample.actual && predicted) matrix.falsePositive += 1;
    else if (!sample.actual && !predicted) matrix.trueNegative += 1;
    else matrix.falseNegative += 1;
  }
  const { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn } = matrix;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  return {
    precision,
    recall,
    f1Score: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    falsePositiveRate: fp + tn === 0 ? 0 : fp / (fp + tn),
    truePositiveRate: recall,
    confusionMatrix: matrix
  };
};

export const trainFraudLogisticModel = (
  samples: FraudTrainingSample[],
  options: TrainFraudModelOptions = {}
): { parameters: FraudModelParameters; metrics: FraudModelMetrics } => {
  if (samples.length < 50) {
    throw new Error("training_requires_at_least_50_samples");
  }
  const fraudSamples = samples.filter(sample => sample.actual).length;
  const legitimateSamples = samples.length - fraudSamples;
  if (!fraudSamples || !legitimateSamples) {
    throw new Error("training_requires_both_fraud_and_legitimate_samples");
  }

  const train = samples.filter((_sample, index) => index % 5 !== 0);
  const validation = samples.filter((_sample, index) => index % 5 === 0);
  const normalization = featureNames.reduce((acc, feature) => {
    const values = train.map(sample => rawFeatureValue(sample.features, feature));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    acc[feature] = { mean: Number(mean.toFixed(6)), scale: Number(Math.max(Math.sqrt(variance), 0.0001).toFixed(6)) };
    return acc;
  }, {} as FraudModelParameters["normalization"]);

  const epochs = options.epochs ?? 180;
  const learningRate = options.learningRate ?? 0.035;
  const l2 = options.l2 ?? 0.0015;
  const blendRuleWeight = options.blendRuleWeight ?? 0.48;
  const alertThreshold = options.alertThreshold ?? 55;
  const positiveWeight = legitimateSamples / fraudSamples;
  const weights = Array(featureNames.length + 1).fill(0);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = Array(weights.length).fill(0);
    for (const sample of train) {
      const vector = normalizedVector(sample, normalization);
      const prediction = sigmoid(linearScore(weights, vector));
      const expected = sample.actual ? 1 : 0;
      const classWeight = sample.actual ? positiveWeight : 1;
      const error = (prediction - expected) * classWeight;
      gradient[0] += error;
      vector.forEach((value, index) => {
        gradient[index + 1] += error * value;
      });
    }
    weights.forEach((weight, index) => {
      const penalty = index === 0 ? 0 : l2 * weight;
      weights[index] -= learningRate * ((gradient[index] / train.length) + penalty);
    });
  }

  const coefficients = featureNames.reduce((acc, feature, index) => {
    acc[feature] = Number(weights[index + 1].toFixed(6));
    return acc;
  }, { bias: Number(weights[0].toFixed(6)) } as Record<FraudFeatureName | "bias", number>);
  const parameters: FraudModelParameters = {
    modelKind: "trained_logistic_regression",
    trainingAlgorithm: "logistic_regression_sgd",
    featureNames,
    coefficients,
    normalization,
    blendRuleWeight,
    alertThreshold,
    trainedAt: new Date().toISOString(),
    trainingWindow: { sampleSize: samples.length, fraudSamples, legitimateSamples }
  };
  const validationMetrics = metricsFor(validation.length ? validation : train, weights, normalization, blendRuleWeight, alertThreshold);

  return {
    parameters,
    metrics: {
      sampleSize: samples.length,
      trainSize: train.length,
      validationSize: validation.length,
      ...validationMetrics,
      epochs,
      learningRate,
      l2
    }
  };
};
