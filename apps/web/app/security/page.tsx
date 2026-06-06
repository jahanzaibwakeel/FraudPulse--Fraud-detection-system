"use client";

import { useEffect, useState } from "react";
import { Download, FileJson, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, UserCheck } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiText, clearSessionToken, setSessionToken } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type Session = {
  authEnabled: boolean;
  actor: string;
  role: string;
  tokenLabel: string;
  authMethod: string;
  expiresAt: string | null;
  requestId: string;
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

type SecurityStatus = {
  generatedAt: string;
  tokenCount: number;
  activeSessions: Array<{ sessionId: string; actor: string; role: string; fingerprint: string; expiresAt: string }>;
  lockedPrincipals: Array<{ fingerprint: string; attempts: number; lockedUntil: string }>;
  policies: { sessionTtlMs: number; authFailureMaxAttempts: number; authLockoutMs: number };
};

type SecurityEvent = {
  id: string;
  type: string;
  actor: string;
  role?: string;
  fingerprint?: string;
  createdAt: string;
  detail: Record<string, unknown>;
};

type RotationPlan = {
  generatedAt: string;
  replacements: Array<{ actor: string; role: string; oldFingerprint: string; newFingerprint: string; replacement: string }>;
  note: string;
};

type SessionResponse = {
  sessionToken: string;
  expiresAt: string;
  principal: Session;
};

export default function SecurityPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [limits, setLimits] = useState<RateLimits | null>(null);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [report, setReport] = useState<ModelReport | null>(null);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [rotationPlan, setRotationPlan] = useState<RotationPlan | null>(null);
  const [exporting, setExporting] = useState(false);

  const refresh = async () => {
    const [nextSession, nextLimits, nextAudit, nextStatus, nextEvents] = await Promise.all([
      apiGet<Session>("/security/session"),
      apiGet<RateLimits>("/security/rate-limits"),
      apiGet<AuditLog[]>("/security/audit?limit=60"),
      apiGet<SecurityStatus>("/security/status"),
      apiGet<SecurityEvent[]>("/security/events?limit=80")
    ]);
    setSession(nextSession);
    setLimits(nextLimits);
    setAudit(nextAudit);
    setStatus(nextStatus);
    setEvents(nextEvents);
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

  const createSession = async () => {
    const nextSession = await apiPost<SessionResponse>("/security/sessions", {});
    setSessionToken(nextSession.sessionToken);
    await refresh();
  };

  const revokeSession = async () => {
    await apiDelete<{ revoked: boolean }>("/security/sessions/current");
    clearSessionToken();
    await refresh();
  };

  const generateRotationPlan = async () => {
    const plan = await apiPost<RotationPlan>("/security/token-rotation-plan", {});
    setRotationPlan(plan);
    await refresh();
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
        <MetricTile label="Auth method" value={session?.authMethod ?? "loading"} tone="warn" />
        <MetricTile label="Rate limit" value={`${limits?.maxRequests ?? 0}/min`} />
        <MetricTile label="Active sessions" value={status?.activeSessions.length ?? 0} />
      </section>

      <section className="opsGrid">
        <div className="panel">
          <div className="panelHeader"><h2>Session Controls</h2><UserCheck size={18} /></div>
          <div className="securityActions">
            <button className="exportButton" onClick={createSession} disabled={session?.authMethod === "session"}>
              <UserCheck size={18} />
              <span>
                <strong>Create Local Session</strong>
                <small>Exchange the demo API token for an expiring in-browser session token.</small>
              </span>
            </button>
            <button className="exportButton" onClick={revokeSession} disabled={session?.authMethod !== "session"}>
              <LockKeyhole size={18} />
              <span>
                <strong>Revoke Current Session</strong>
                <small>Delete the active session token and fall back to the configured local token.</small>
              </span>
            </button>
          </div>
          <div className="reportSummary">
            <div><span>Request ID</span><strong>{session?.requestId?.slice(0, 12) ?? "none"}</strong></div>
            <div><span>Expires</span><strong>{session?.expiresAt ? new Date(session.expiresAt).toLocaleTimeString() : "token"}</strong></div>
            <div><span>Lockout</span><strong>{Math.round((status?.policies.authLockoutMs ?? 0) / 60000)}m</strong></div>
            <div><span>Failures</span><strong>{status?.policies.authFailureMaxAttempts ?? 0}</strong></div>
          </div>
        </div>

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
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Session Policy</h2><ShieldCheck size={18} /></div>
          <div className="policyStack">
            <div><LockKeyhole size={17} /><span>Operational routes require a local token or expiring session.</span></div>
            <div><ShieldCheck size={17} /><span>API tokens are matched by hash and denied with constant-time comparison.</span></div>
            <div><RefreshCw size={17} /><span>Repeated failed auth attempts create security events and short lockouts.</span></div>
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Token Rotation Plan</h2><KeyRound size={18} /></div>
          <div className="securityActions">
            <button className="exportButton" onClick={generateRotationPlan}>
              <KeyRound size={18} />
              <span>
                <strong>Generate Plan</strong>
                <small>Create replacement token lines for `.env` without calling an external vault.</small>
              </span>
            </button>
          </div>
          <table>
            <thead><tr><th>Actor</th><th>Role</th><th>New fingerprint</th></tr></thead>
            <tbody>
              {(rotationPlan?.replacements ?? []).map(row => (
                <tr key={`${row.actor}-${row.newFingerprint}`}>
                  <td>{row.actor}</td>
                  <td>{row.role}</td>
                  <td>{row.newFingerprint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Active Sessions</h2><StatusPill value="admin" /></div>
          <table>
            <thead><tr><th>Actor</th><th>Role</th><th>Fingerprint</th><th>Expires</th></tr></thead>
            <tbody>
              {(status?.activeSessions ?? []).map(row => (
                <tr key={row.sessionId}>
                  <td>{row.actor}</td>
                  <td>{row.role}</td>
                  <td>{row.fingerprint}</td>
                  <td>{new Date(row.expiresAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Security Events</h2><StatusPill value="admin" /></div>
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>Actor</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {events.map(row => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleTimeString()}</td>
                  <td>{row.type}</td>
                  <td>{row.actor}</td>
                  <td>{row.fingerprint ?? "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
