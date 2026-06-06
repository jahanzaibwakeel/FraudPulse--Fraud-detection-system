"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Target } from "lucide-react";
import { apiGet } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type EntityRisk = {
  id: string;
  entity_type: string;
  entity_id: string;
  label: string;
  category: string;
  risk_score: string;
  velocity_score: string;
  anomaly_score: string;
  alert_score: string;
  transaction_count: number;
  alert_count: number;
  last_seen_at: string;
  updated_at: string;
  evidence: Record<string, unknown>;
};

type RiskSummary = {
  entity_type: string;
  entity_count: string;
  avg_risk: string;
  max_risk: string;
};

type RiskResponse = {
  entities: EntityRisk[];
  summary: RiskSummary[];
};

const filters = ["all", "user", "card", "merchant", "device", "ip"];

const severityFor = (score: number) => {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
};

export default function RiskMemoryPage() {
  const [data, setData] = useState<RiskResponse | null>(null);
  const [filter, setFilter] = useState("all");

  const refresh = async (nextFilter = filter) => {
    const query = nextFilter === "all" ? "" : `?type=${nextFilter}`;
    setData(await apiGet<RiskResponse>(`/risk/entities${query}`));
  };

  useEffect(() => {
    refresh();
  }, []);

  const topEntity = data?.entities[0];
  const totalEntities = data?.summary.reduce((sum, item) => sum + Number(item.entity_count), 0) ?? 0;
  const highRiskCount = data?.entities.filter(entity => Number(entity.risk_score) >= 60).length ?? 0;

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Rolling entity risk memory</p>
          <h1>Risk Memory</h1>
        </div>
        <div className="topActions">
          <select value={filter} onChange={event => { setFilter(event.target.value); refresh(event.target.value); }} aria-label="Entity type filter">
            {filters.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <button className="iconButton" onClick={() => refresh()} title="Refresh risk memory"><RefreshCw size={18} /></button>
        </div>
      </header>

      <section className="metricGrid">
        <MetricTile label="Tracked entities" value={totalEntities} tone="cool" />
        <MetricTile label="High risk in view" value={highRiskCount} tone="hot" />
        <MetricTile label="Top entity risk" value={Number(topEntity?.risk_score ?? 0).toFixed(1)} tone="warn" />
        <MetricTile label="Top entity type" value={topEntity?.entity_type ?? "none"} />
        <MetricTile label="Top alerts" value={topEntity?.alert_count ?? 0} />
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Entity Type Summary</h2><Target size={18} /></div>
          <table>
            <thead><tr><th>Type</th><th>Entities</th><th>Avg Risk</th><th>Max Risk</th></tr></thead>
            <tbody>
              {data?.summary.map(item => (
                <tr key={item.entity_type}>
                  <td>{item.entity_type}</td>
                  <td>{item.entity_count}</td>
                  <td>{Number(item.avg_risk).toFixed(1)}</td>
                  <td>{Number(item.max_risk).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Latest Evidence</h2><StatusPill value={severityFor(Number(topEntity?.risk_score ?? 0))} /></div>
          <div className="modelHero">
            <h2>{topEntity?.label ?? "No entity selected"}</h2>
            <p>{topEntity ? JSON.stringify(topEntity.evidence) : "Risk memory will populate as transactions are scored."}</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Highest Risk Entities</h2><strong>{filter}</strong></div>
        <table>
          <thead><tr><th>Entity</th><th>Type</th><th>Risk</th><th>Velocity</th><th>Anomaly</th><th>Alerts</th><th>Transactions</th><th>Last Seen</th></tr></thead>
          <tbody>
            {data?.entities.map(entity => (
              <tr key={`${entity.entity_type}-${entity.entity_id}`}>
                <td>{entity.label || entity.entity_id}<small>{entity.category}</small></td>
                <td>{entity.entity_type}</td>
                <td><StatusPill value={severityFor(Number(entity.risk_score))} /> {Number(entity.risk_score).toFixed(1)}</td>
                <td>{Number(entity.velocity_score).toFixed(1)}</td>
                <td>{Number(entity.anomaly_score).toFixed(1)}</td>
                <td>{entity.alert_count}</td>
                <td>{entity.transaction_count}</td>
                <td>{new Date(entity.last_seen_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
