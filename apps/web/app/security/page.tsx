"use client";

import { useEffect, useState } from "react";
import { Download, FileJson, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { apiGet, apiText } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type Session = {
  authEnabled: boolean;
  actor: string;
  role: string;
  tokenLabel: string;
};

type RateLimits = {
  windowMs: number;
  maxRequests: number;
  buckets: Array<{ key: string; actor: string; count: number; resetAt: string }>;
};

type AuditLog = {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
};

type ModelReport = {
  generatedAt: string;
  exportedBy: string;
  model: { version: string };
  metrics: { precision: number; recall: number; f1Score: number; falsePositiveRate: number };
};

export default function SecurityPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [limits, setLimits] = useState<RateLimits | null>(null);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [report, setReport] = useState<ModelReport | null>(null);
  const [exporting, setExporting] = useState(false);

  const refresh = async () => {
    const [nextSession, nextLimits, nextAudit] = await Promise.all([
      apiGet<Session>("/security/session"),
      apiGet<RateLimits>("/security/rate-limits"),
      apiGet<AuditLog[]>("/security/audit?limit=60")
    ]);
    setSession(nextSession);
    setLimits(nextLimits);
    setAudit(nextAudit);
  };

  useEffect(() => {
    refresh();
    apiGet<ModelReport>("/reports/model.json").then(setReport);
  }, []);

  const downloadAlerts = async () => {
    setExporting(true);
    const csv = await apiText("/reports/alerts.csv?lookbackHours=24");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "fraudpulse-alerts-24h.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    await refresh();
    setExporting(false);
  };

  const downloadModel = async () => {
    setExporting(true);
    const nextReport = await apiGet<ModelReport>("/reports/model.json");
    setReport(nextReport);
    const url = URL.createObjectURL(new Blob([JSON.stringify(nextReport, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "fraudpulse-model-report.json";
    anchor.click();
    URL.revokeObjectURL(url);
    await refresh();
    setExporting(false);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local production controls</p>
          <h1>Security & Reports</h1>
        </div>
        <div className="topActions">
          <button className="iconButton" onClick={refresh} title="Refresh security console"><RefreshCw size={18} /></button>
        </div>
      </header>

      <section className="metricGrid">
        <MetricTile label="Authenticated as" value={session?.actor ?? "loading"} tone="cool" />
        <MetricTile label="Role" value={session?.role ?? "loading"} />
        <MetricTile label="Auth enabled" value={session?.authEnabled ? "yes" : "no"} tone="warn" />
        <MetricTile label="Rate limit" value={`${limits?.maxRequests ?? 0}/min`} />
        <MetricTile label="Audit rows" value={audit.length} />
      </section>

      <section className="opsGrid">
        <div className="panel">
          <div className="panelHeader"><h2>Protected Exports</h2><Download size={18} /></div>
          <div className="securityActions">
            <button className="exportButton" onClick={downloadAlerts} disabled={exporting}>
              <Download size={18} />
              <span>
                <strong>Alert CSV</strong>
                <small>Last 24 hours of cases, labels, assignments, and ground truth.</small>
              </span>
            </button>
            <button className="exportButton" onClick={downloadModel} disabled={exporting}>
              <FileJson size={18} />
              <span>
                <strong>Model JSON</strong>
                <small>Active model version, metrics, confusion matrix, and feature window.</small>
              </span>
            </button>
          </div>
          {report && (
            <div className="reportSummary">
              <div><span>Model</span><strong>{report.model?.version ?? "unknown"}</strong></div>
              <div><span>Precision</span><strong>{(report.metrics.precision * 100).toFixed(1)}%</strong></div>
              <div><span>Recall</span><strong>{(report.metrics.recall * 100).toFixed(1)}%</strong></div>
              <div><span>F1</span><strong>{(report.metrics.f1Score * 100).toFixed(1)}%</strong></div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Session Policy</h2><ShieldCheck size={18} /></div>
          <div className="policyStack">
            <div><LockKeyhole size={17} /><span>All operational API routes require a local token.</span></div>
            <div><ShieldCheck size={17} /><span>Analyst/admin/service mutations enforce role checks.</span></div>
            <div><RefreshCw size={17} /><span>Rate-limit counters are exposed for admin inspection.</span></div>
          </div>
        </div>
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Rate Limit Buckets</h2><StatusPill value="admin" /></div>
          <table>
            <thead><tr><th>Actor</th><th>Requests</th><th>Resets</th></tr></thead>
            <tbody>
              {(limits?.buckets ?? []).map(bucket => (
                <tr key={`${bucket.key}-${bucket.resetAt}`}>
                  <td>{bucket.actor}</td>
                  <td>{bucket.count}</td>
                  <td>{new Date(bucket.resetAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Audit Trail</h2><StatusPill value="analyst" /></div>
          <table>
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>
              {audit.map(row => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleTimeString()}</td>
                  <td>{row.actor}</td>
                  <td>{row.action}</td>
                  <td>{row.entity_type}<small>{row.entity_id}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
