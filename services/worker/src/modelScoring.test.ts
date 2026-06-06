import { describe, expect, it } from "vitest";
import { scoreHybridModel } from "./modelScoring.js";

describe("scoreHybridModel", () => {
  it("raises model probability for risky feature combinations", () => {
    const low = scoreHybridModel({
      velocity5m: 0,
      velocity1h: 1,
      userTx30d: 5,
      amountMean: 40,
      amountStddev: 10,
      amountZscore: 0.2,
      geoDistanceKm: 2,
      geoKmh: 20,
      merchantRisk: 10,
      deviceSeen: true
    }, 10);
    const high = scoreHybridModel({
      velocity5m: 18,
      velocity1h: 25,
      userTx30d: 80,
      amountMean: 100,
      amountStddev: 20,
      amountZscore: 5,
      geoDistanceKm: 14000,
      geoKmh: 2400,
      merchantRisk: 92,
      deviceSeen: false
    }, 70);

    expect(high.modelProbability).toBeGreaterThan(low.modelProbability);
    expect(high.blendedScore).toBeGreaterThan(70);
  });
});
