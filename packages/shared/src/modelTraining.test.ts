import { describe, expect, it } from "vitest";
import { trainFraudLogisticModel, type FraudTrainingSample } from "./modelTraining.js";

const sample = (actual: boolean, risk: number): FraudTrainingSample => ({
  actual,
  ruleScore: actual ? 70 + risk : 10 + risk,
  features: {
    velocity5m: actual ? 8 + risk : risk,
    velocity1h: actual ? 18 + risk : 2 + risk,
    userTx30d: actual ? 70 + risk : 10 + risk,
    amountZscore: actual ? 3 + risk / 10 : risk / 20,
    geoKmh: actual ? 1200 + risk * 20 : 20 + risk,
    merchantRisk: actual ? 70 + risk : 8 + risk,
    deviceSeen: !actual
  }
});

describe("trainFraudLogisticModel", () => {
  it("learns a local model from labeled fraud samples", () => {
    const samples = Array.from({ length: 80 }, (_item, index) => sample(index % 4 === 0, index % 10));
    const result = trainFraudLogisticModel(samples, { epochs: 80, learningRate: 0.04 });

    expect(result.parameters.modelKind).toBe("trained_logistic_regression");
    expect(result.parameters.trainingWindow.sampleSize).toBe(80);
    expect(result.metrics.validationSize).toBeGreaterThan(0);
    expect(result.metrics.recall).toBeGreaterThan(0.7);
  });
});
