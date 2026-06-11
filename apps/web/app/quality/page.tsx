"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type QualityCheck = {
  code: string;
  label: string;
  status: string;
  severity: string;
  value: number;
  threshold: number;
  description: string;
  evidence: Record<string, unknown>;
};

type QualityAlert = {
  id: string;
  alert_type: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
};

type QualityRun = {
  id: string;
  status: string;
  summary: { status: string; failing: number; warning: number; passing: number; transactionCount: number; driftIndex: number };
  created_by: string;
  created_at: string;
};

type QualityOverview = {
  summary: {
    status: string;
    failing: number;
    warning: number;
    passing: number;
    transactionCount: number;
    openAlertCount: number;
    driftStatus: string;
    driftIndex: number;
  };
  checks: QualityCheck[];
  drift: {
    currentCount: number;
    baselineCount: number;
    driftIndex: number;
    status: string;
    drift: Array<{ feature: string; currentValue: number; baselineValue: number; relativeDelta: number; severity: string }>;
  };
  alerts: QualityAlert[];
  recentRuns: QualityRun[];
};

const formatValue = (value: number) => Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);

export default function QualityPage() {
  const [overview, setOverview] = useState<QualityOverview | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      setOverview(await apiGet<QualityOverview>("/quality/overview"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load data quality overview.");
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, []);

  const runChecks = async () => {
    setRunning(true);
    setError(null);
    try {
      const next = await apiPost<QualityOverview>("/quality/run", { actor: "demo-quality" });
      setOverview(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to run data quality checks.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Data quality and drift alerts</p>
          <h1>Data Quality</h1>
        </div>
        <div className="topActions">
          <button className="primary" onClick={runChecks} disabled={running}><ShieldAlert size={16} /> {running ? "Running" : "Run Checks"}</button>
          <button className="iconButton" onClick={refresh} title="Refresh quality dashboard"><RefreshCw size={18} /></button>
        </div>
      </header>

      <section className="metricGrid">
        <MetricTile label="Overall status" value={overview?.summary.status ?? "loading"} tone={overview?.summary.status === "fail" ? "hot" : overview?.summary.status === "warn" ? "warn" : "cool"} />
        <MetricTile label="Failing checks" value={overview?.summary.failing ?? 0} tone="hot" />
        <MetricTile label="Warnings" value={overview?.summary.warning ?? 0} tone="warn" />
        <MetricTile label="Open alerts" value={overview?.summary.openAlertCount ?? 0} />
        <MetricTile label="Drift index" value={(overview?.summary.driftIndex ?? 0).toFixed(3)} tone={overview?.summary.driftStatus === "high" ? "hot" : overview?.summary.driftStatus === "medium" ? "warn" : "cool"} />
      </section>

      {error && <div className="notice">Data Quality could not load: {error}</div>}

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Quality Checks</h2><strong>{overview?.summary.transactionCount ?? 0} tx</strong></div>
          <table>
            <thead><tr><th>Check</th><th>Status</th><th>Value</th><th>Threshold</th><th>Description</th></tr></thead>
            <tbody>
              {overview?.checks.map(check => (
                <tr key={check.code}>
                  <td>{check.label}<small>{check.code}</small></td>
                  <td><StatusPill value={check.status === "pass" ? "low" : check.severity} /></td>
                  <td>{formatValue(check.value)}</td>
                  <td>{formatValue(check.threshold)}</td>
                  <td>{check.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Feature Drift Alerts</h2><strong>{overview?.drift.status ?? "unknown"}</strong></div>
          <table>
            <thead><tr><th>Feature</th><th>Current</th><th>Baseline</th><th>Delta</th><th>Status</th></tr></thead>
            <tbody>
              {overview?.drift.drift.map(item => (
                <tr key={item.feature}>
                  <td>{item.feature.replaceAll("_", " ")}</td>
                  <td>{formatValue(item.currentValue)}</td>
                  <td>{formatValue(item.baselineValue)}</td>
                  <td>{(item.relativeDelta * 100).toFixed(1)}%</td>
                  <td><StatusPill value={item.severity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Open Quality Alerts</h2><strong>{overview?.alerts.length ?? 0}</strong></div>
          <div className="timeline">
            {overview?.alerts.map(alert => (
              <div className="timelineItem" key={alert.id}>
                <strong>{alert.title}</strong>
                <span>{alert.alert_type} - {alert.severity} - last seen {new Date(alert.last_seen_at).toLocaleString()}</span>
                <p>{alert.description}</p>
                <small>{JSON.stringify(alert.evidence)}</small>
              </div>
            ))}
            {!overview?.alerts.length && <div className="timelineItem"><strong>No open quality alerts</strong><span>Run checks to persist the current state.</span></div>}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Recent Quality Runs</h2></div>
          <table>
            <thead><tr><th>Run</th><th>Actor</th><th>Status</th><th>Checks</th></tr></thead>
            <tbody>
              {overview?.recentRuns.map(run => (
                <tr key={run.id}>
                  <td>{run.id.slice(0, 8)}<small>{new Date(run.created_at).toLocaleString()}</small></td>
                  <td>{run.created_by}</td>
                  <td><StatusPill value={run.summary.status === "pass" ? "low" : run.summary.status === "warn" ? "medium" : "critical"} /></td>
                  <td>{run.summary.passing} pass / {run.summary.warning} warn / {run.summary.failing} fail</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
