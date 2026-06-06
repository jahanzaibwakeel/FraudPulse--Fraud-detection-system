"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { StatusPill } from "../components/StatusPill";
import { MetricTile } from "../components/MetricTile";

type Rule = { code: string; label: string; weight: string; enabled: boolean; threshold: Record<string, unknown>; updated_at: string };
type Preview = {
  sampleSize: number;
  currentAlerts: number;
  previewAlerts: number;
  alertDelta: number;
  averageScoreDelta: number;
  precision: number;
  recall: number;
  f1Score: number;
};

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const refresh = async () => {
    const nextRules = await apiGet<Rule[]>("/rules");
    setRules(nextRules);
    setWeights(Object.fromEntries(nextRules.map(rule => [rule.code, Number(rule.weight)])));
  };
  useEffect(() => { refresh(); }, []);

  const previewRules = async () => {
    const result = await apiPost<Preview>("/rules/preview", { weights });
    setPreview(result);
  };

  const applyRule = async (code: string) => {
    await apiPatch(`/rules/${code}`, { weight: weights[code] });
    await refresh();
    await previewRules();
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div><p className="eyebrow">Scoring governance</p><h1>Rules and Thresholds</h1></div>
        <div className="topActions">
          <button className="primary" onClick={previewRules}>Preview Impact</button>
          <button className="iconButton" onClick={refresh} title="Refresh rules"><RefreshCw size={18} /></button>
        </div>
      </header>
      {preview && (
        <section className="metricGrid">
          <MetricTile label="Sample size" value={preview.sampleSize} />
          <MetricTile label="Current alerts" value={preview.currentAlerts} />
          <MetricTile label="Preview alerts" value={preview.previewAlerts} tone={preview.alertDelta > 0 ? "warn" : "cool"} />
          <MetricTile label="Avg score delta" value={preview.averageScoreDelta.toFixed(2)} />
          <MetricTile label="Preview F1" value={preview.f1Score.toFixed(3)} tone="cool" />
        </section>
      )}
      <section className="panel">
        <table>
          <thead><tr><th>Rule</th><th>Weight</th><th>Status</th><th>Threshold</th><th>Updated</th><th>Action</th></tr></thead>
          <tbody>
            {rules.map(rule => (
              <tr key={rule.code}>
                <td>{rule.label}<small>{rule.code}</small></td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={weights[rule.code] ?? Number(rule.weight)}
                    onChange={event => setWeights(current => ({ ...current, [rule.code]: Number(event.target.value) }))}
                    aria-label={`${rule.code} weight`}
                  />
                </td>
                <td><StatusPill value={rule.enabled ? "enabled" : "disabled"} /></td>
                <td>{JSON.stringify(rule.threshold)}</td>
                <td>{new Date(rule.updated_at).toLocaleString()}</td>
                <td><button className="primary" onClick={() => applyRule(rule.code)}>Apply</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
