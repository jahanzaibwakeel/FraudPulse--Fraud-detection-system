"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { BrainCircuit, RefreshCw } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { MetricTile } from "../components/MetricTile";

type ModelMetrics = {
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  truePositiveRate: number;
  confusionMatrix: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number };
};

type HybridSummary = {
  activeModel: {
    version: string;
    parameters: {
      modelKind?: string;
      trainingAlgorithm?: string;
      blendRuleWeight?: number;
      trainingWindow?: { sampleSize: number; fraudSamples: number; legitimateSamples: number };
    };
    metrics?: { validationSize?: number; f1Score?: number; precision?: number; recall?: number };
    created_at: string;
  } | null;
  scored_count: string;
  avg_rule_score: string;
  avg_ml_score: string;
  avg_blended_score: string;
  avg_model_probability: string;
  high_ml_count: string;
  disagreement_count: string;
  topDisagreements: Array<{
    transaction_id: string;
    rule_score: string;
    ml_score: string;
    blended_score: string;
    model_probability: string;
    severity: string;
    amount: string;
    currency: string;
    full_name: string;
    merchant_name: string;
  }>;
};

type DriftSummary = {
  currentCount: number;
  baselineCount: number;
  driftIndex: number;
  status: string;
  drift: Array<{
    feature: string;
    currentValue: number;
    baselineValue: number;
    absoluteDelta: number;
    relativeDelta: number;
    severity: string;
  }>;
};

export default function PerformancePage() {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [hybrid, setHybrid] = useState<HybridSummary | null>(null);
  const [drift, setDrift] = useState<DriftSummary | null>(null);
  const [mounted, setMounted] = useState(false);
  const [training, setTraining] = useState(false);
  const refresh = async () => {
    const [nextMetrics, nextHybrid, nextDrift] = await Promise.all([
      apiGet<ModelMetrics>("/metrics/model"),
      apiGet<HybridSummary>("/models/hybrid"),
      apiGet<DriftSummary>("/models/drift")
    ]);
    setMetrics(nextMetrics);
    setHybrid(nextHybrid);
    setDrift(nextDrift);
  };
  useEffect(() => {
    setMounted(true);
    refresh();
  }, []);

  const recalibrate = async () => {
    await apiPost("/models/recalibrate", { actor: "demo-mlops" });
    await refresh();
  };
  const trainModel = async () => {
    setTraining(true);
    await apiPost("/models/train", { actor: "demo-mlops", maxSamples: 50000, blendRuleWeight: 0.48 });
    await refresh();
    setTraining(false);
  };
  const matrix = metrics ? [
    { name: "TP", value: metrics.confusionMatrix.truePositive, fill: "#8fd14f" },
    { name: "FP", value: metrics.confusionMatrix.falsePositive, fill: "#f4b44d" },
    { name: "TN", value: metrics.confusionMatrix.trueNegative, fill: "#26c6da" },
    { name: "FN", value: metrics.confusionMatrix.falseNegative, fill: "#ff6b6b" }
  ] : [];
  return (
    <div className="screen">
      <header className="topbar">
        <div><p className="eyebrow">Feedback loop metrics</p><h1>Model and Rule Performance</h1></div>
        <div className="topActions">
          <button className="primary" onClick={trainModel} disabled={training}><BrainCircuit size={16} /> {training ? "Training" : "Train Local Model"}</button>
          <button className="primary" onClick={recalibrate}>Recalibrate</button>
          <button className="iconButton" onClick={refresh} title="Refresh model metrics"><RefreshCw size={18} /></button>
        </div>
      </header>
      <section className="metricGrid">
        <MetricTile label="Precision" value={`${(((metrics?.precision ?? 0) * 100)).toFixed(1)}%`} />
        <MetricTile label="Recall" value={`${(((metrics?.recall ?? 0) * 100)).toFixed(1)}%`} />
        <MetricTile label="F1 score" value={(metrics?.f1Score ?? 0).toFixed(3)} tone="cool" />
        <MetricTile label="FPR" value={`${(((metrics?.falsePositiveRate ?? 0) * 100)).toFixed(1)}%`} tone="warn" />
        <MetricTile label="TPR" value={`${(((metrics?.truePositiveRate ?? 0) * 100)).toFixed(1)}%`} tone="cool" />
      </section>

      <section className="metricGrid">
        <MetricTile label="Active model" value={hybrid?.activeModel?.version ?? "none"} tone="cool" />
        <MetricTile label="Model type" value={hybrid?.activeModel?.parameters?.modelKind ? "trained" : "hand tuned"} />
        <MetricTile label="Train samples" value={hybrid?.activeModel?.parameters?.trainingWindow?.sampleSize ?? 0} />
        <MetricTile label="Validation F1" value={hybrid?.activeModel?.metrics?.f1Score?.toFixed(3) ?? "n/a"} tone="cool" />
        <MetricTile label="Disagreements" value={hybrid?.disagreement_count ?? 0} tone="warn" />
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Confusion Matrix</h2></div>
          <div className="chartBox">
            {mounted && <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={matrix} dataKey="value" nameKey="name" outerRadius={90} label>
                  {matrix.map(item => <Cell key={item.name} fill={item.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#0c1418", border: "1px solid #27424e" }} />
              </PieChart>
            </ResponsiveContainer>}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Feature Drift</h2><strong>{drift?.status ?? "unknown"}</strong></div>
          <table>
            <thead><tr><th>Feature</th><th>Current</th><th>Baseline</th><th>Delta</th><th>Status</th></tr></thead>
            <tbody>
              {drift?.drift.map(item => (
                <tr key={item.feature}>
                  <td>{item.feature.replaceAll("_", " ")}</td>
                  <td>{item.currentValue.toFixed(2)}</td>
                  <td>{item.baselineValue.toFixed(2)}</td>
                  <td>{(item.relativeDelta * 100).toFixed(1)}%</td>
                  <td>{item.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Rule vs ML Disagreements</h2><strong>{Number(hybrid?.avg_model_probability ?? 0).toFixed(3)} avg probability</strong></div>
        <table>
          <thead><tr><th>Transaction</th><th>Customer</th><th>Merchant</th><th>Amount</th><th>Rule</th><th>ML</th><th>Blended</th></tr></thead>
          <tbody>
            {hybrid?.topDisagreements.map(row => (
              <tr key={row.transaction_id}>
                <td>{row.transaction_id.slice(0, 8)}</td>
                <td>{row.full_name}</td>
                <td>{row.merchant_name}</td>
                <td>{row.currency} {Number(row.amount).toFixed(2)}</td>
                <td>{Number(row.rule_score ?? 0).toFixed(1)}</td>
                <td>{Number(row.ml_score ?? 0).toFixed(1)}<small>p={Number(row.model_probability ?? 0).toFixed(3)}</small></td>
                <td>{Number(row.blended_score ?? 0).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
