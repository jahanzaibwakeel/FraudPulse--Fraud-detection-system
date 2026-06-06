"use client";

import { useEffect, useState } from "react";
import { GitCompareArrows, RefreshCw, Rocket, Trophy } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type ModelVersion = {
  id: string;
  version: string;
  parameters: {
    modelKind?: string;
    trainingAlgorithm?: string;
    trainingWindow?: { sampleSize: number; fraudSamples: number; legitimateSamples: number };
  };
  metrics?: { precision?: number; recall?: number; f1Score?: number; validationSize?: number };
  active: boolean;
  created_at: string;
};

type Registry = {
  champion: ModelVersion | null;
  recommendedChallenger: ModelVersion | null;
  models: ModelVersion[];
  counts: { total: number; trained: number; challengers: number };
};

type ShadowResult = {
  sampleSize: number;
  alertThreshold: number;
  champion: { version: string; alerts: number; metrics: { precision: number; recall: number; f1Score: number; falsePositiveRate: number } };
  candidate: { version: string; alerts: number; metrics: { precision: number; recall: number; f1Score: number; falsePositiveRate: number } };
  alertDelta: number;
  disagreementCount: number;
  disagreementRate: number;
};

export default function ModelsPage() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [shadow, setShadow] = useState<ShadowResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const next = await apiGet<Registry>("/models/registry");
    setRegistry(next);
    setSelectedModelId(current => current || next.recommendedChallenger?.id || next.models.find(model => !model.active)?.id || "");
  };

  useEffect(() => {
    refresh();
  }, []);

  const runShadow = async (modelId = selectedModelId) => {
    if (!modelId) return;
    setBusy(true);
    const result = await apiPost<ShadowResult>(`/models/${modelId}/shadow-score`, { sampleSize: 2000, alertThreshold: 55 });
    setShadow(result);
    setBusy(false);
  };

  const promote = async (modelId: string) => {
    setBusy(true);
    await apiPost(`/models/${modelId}/promote`, { actor: "demo-mlops" });
    setShadow(null);
    setSelectedModelId("");
    await refresh();
    setBusy(false);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Champion challenger governance</p>
          <h1>Model Registry</h1>
        </div>
        <div className="topActions">
          <button className="primary" onClick={() => runShadow()} disabled={!selectedModelId || busy}><GitCompareArrows size={16} /> Shadow Score</button>
          <button className="iconButton" onClick={refresh} title="Refresh model registry"><RefreshCw size={18} /></button>
        </div>
      </header>

      <section className="metricGrid">
        <MetricTile label="Champion" value={registry?.champion?.version ?? "none"} tone="cool" />
        <MetricTile label="Versions" value={registry?.counts.total ?? 0} />
        <MetricTile label="Trained models" value={registry?.counts.trained ?? 0} />
        <MetricTile label="Challengers" value={registry?.counts.challengers ?? 0} tone="warn" />
        <MetricTile label="Recommended" value={registry?.recommendedChallenger?.version ?? "none"} />
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Champion</h2><Trophy size={18} /></div>
          <div className="modelHero">
            <StatusPill value="active" />
            <h2>{registry?.champion?.version ?? "No active model"}</h2>
            <p>{registry?.champion?.parameters?.modelKind ?? "hand tuned"} / {registry?.champion?.parameters?.trainingAlgorithm ?? "rules blend"}</p>
            <div className="reportSummary">
              <div><span>F1</span><strong>{registry?.champion?.metrics?.f1Score?.toFixed(3) ?? "n/a"}</strong></div>
              <div><span>Precision</span><strong>{registry?.champion?.metrics?.precision ? `${(registry.champion.metrics.precision * 100).toFixed(1)}%` : "n/a"}</strong></div>
              <div><span>Recall</span><strong>{registry?.champion?.metrics?.recall ? `${(registry.champion.metrics.recall * 100).toFixed(1)}%` : "n/a"}</strong></div>
              <div><span>Samples</span><strong>{registry?.champion?.parameters?.trainingWindow?.sampleSize ?? 0}</strong></div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Shadow Evaluation</h2><GitCompareArrows size={18} /></div>
          {shadow ? (
            <div className="modelHero">
              <h2>{shadow.candidate.version}</h2>
              <p>Compared with {shadow.champion.version} on {shadow.sampleSize} recent feature rows.</p>
              <div className="reportSummary">
                <div><span>Candidate F1</span><strong>{shadow.candidate.metrics.f1Score.toFixed(3)}</strong></div>
                <div><span>Champion F1</span><strong>{shadow.champion.metrics.f1Score.toFixed(3)}</strong></div>
                <div><span>Alert Delta</span><strong>{shadow.alertDelta > 0 ? "+" : ""}{shadow.alertDelta}</strong></div>
                <div><span>Disagree</span><strong>{(shadow.disagreementRate * 100).toFixed(1)}%</strong></div>
              </div>
            </div>
          ) : (
            <div className="modelHero"><p>Select a challenger and run a shadow score to compare it against the champion without changing production scoring.</p></div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Model Versions</h2><Rocket size={18} /></div>
        <table>
          <thead><tr><th>Version</th><th>Status</th><th>Kind</th><th>F1</th><th>Samples</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {registry?.models.map(model => (
              <tr key={model.id}>
                <td>{model.version}</td>
                <td><StatusPill value={model.active ? "champion" : "challenger"} /></td>
                <td>{model.parameters?.modelKind ?? "hand_tuned"}</td>
                <td>{model.metrics?.f1Score?.toFixed(3) ?? "n/a"}</td>
                <td>{model.parameters?.trainingWindow?.sampleSize ?? 0}</td>
                <td>{new Date(model.created_at).toLocaleString()}</td>
                <td>
                  <div className="split">
                    <button className="primary" onClick={() => { setSelectedModelId(model.id); runShadow(model.id); }} disabled={busy}>Shadow</button>
                    <button className="primary" onClick={() => promote(model.id)} disabled={busy || model.active}>Promote</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
