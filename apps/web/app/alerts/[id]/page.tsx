"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Archive, ClipboardCheck, FileClock, Save } from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
import { MetricTile } from "../../components/MetricTile";
import { StatusPill } from "../../components/StatusPill";

type Reason = {
  rule: string;
  description: string;
  scoreImpact: number;
  confidence: number;
  evidence: Record<string, unknown>;
};

type ModelContribution = {
  feature: string;
  rawValue: number;
  normalizedValue: number;
  coefficient: number;
  contribution: number;
  direction: string;
};

type AlertBundle = {
  alert: {
    id: string;
    severity: string;
    score: string;
    confidence: string;
    status: string;
    assigned_to?: string | null;
    priority: number;
    due_at?: string | null;
    reasons: Reason[];
  };
  transaction: {
    id: string;
    user_id: string;
    card_id: string;
    merchant_id: string;
    amount: string;
    currency: string;
    channel: string;
    occurred_at: string;
    latitude: string;
    longitude: string;
    device_fingerprint: string;
    ip_address: string;
  };
  user: { id: string; full_name: string; risk_tier: string };
  merchant: { id: string; name: string; category: string; risk_score: number };
  featureSnapshot?: {
    velocity_5m: number;
    velocity_1h: number;
    amount_zscore: string;
    geo_distance_km: string;
    geo_kmh: string;
    merchant_risk: number;
    device_seen: boolean;
  } | null;
  summary: {
    reasonCount: number;
    highRiskEntityCount: number;
    relatedTransactionCount: number;
    openMerchantAlerts: number;
    latestSnapshotAt?: string | null;
  };
  entityRisk: Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    risk_score: string;
    transaction_count: number;
    alert_count: number;
    evidence: Record<string, unknown>;
  }>;
  relatedActivity: {
    userTransactions: RelatedTransaction[];
    cardTransactions: RelatedTransaction[];
    deviceTransactions: RelatedTransaction[];
    ipTransactions: RelatedTransaction[];
    merchantAlerts: Array<{ id: string; severity: string; score: string; status: string; created_at: string; full_name: string; amount: string; currency: string }>;
  };
  recommendedActions: string[];
  timeline: Array<{ type: string; actor: string; title: string; detail?: unknown; created_at: string }>;
  latestSnapshot?: { id: string; created_by: string; created_at: string } | null;
};

type RelatedTransaction = {
  id: string;
  amount: string;
  currency: string;
  channel: string;
  occurred_at: string;
  merchant_name: string;
  full_name?: string;
  score?: string | null;
  severity?: string | null;
  alert_id?: string | null;
};

const isContributionList = (value: unknown): value is ModelContribution[] =>
  Array.isArray(value) && value.every(item => typeof item === "object" && item !== null && "feature" in item && "contribution" in item);

const evidenceText = (value: unknown) => {
  if (value == null) return "No detail";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

export default function AlertDetailPage() {
  const routeParams = useParams<{ id: string }>();
  const alertId = routeParams.id;
  const [bundle, setBundle] = useState<AlertBundle | null>(null);
  const [notes, setNotes] = useState("");
  const [analyst, setAnalyst] = useState("demo-analyst");
  const [assignedTo, setAssignedTo] = useState("casey.ops");
  const [priority, setPriority] = useState(2);
  const [slaHours, setSlaHours] = useState(8);
  const [caseNote, setCaseNote] = useState("");
  const [snapshotStatus, setSnapshotStatus] = useState("");

  const refresh = () => apiGet<AlertBundle>(`/cases/${alertId}/evidence`).then(setBundle);
  useEffect(() => { refresh(); }, [alertId]);

  const decide = async (decision: "confirmed_fraud" | "false_positive") => {
    await apiPost(`/alerts/${alertId}/review`, { decision, analyst, notes });
    await refresh();
  };

  const assignCase = async () => {
    await apiPost(`/alerts/${alertId}/assign`, { assignedTo, priority, slaHours, actor: analyst });
    await refresh();
  };

  const addNote = async () => {
    if (!caseNote.trim()) return;
    await apiPost(`/alerts/${alertId}/notes`, { author: analyst, note: caseNote });
    setCaseNote("");
    await refresh();
  };

  const saveSnapshot = async () => {
    if (!bundle) return;
    await apiPost(`/cases/${alertId}/evidence-snapshots`, { actor: analyst, bundle });
    setSnapshotStatus("Evidence snapshot saved");
    await refresh();
  };

  if (!bundle) return <div className="screen">Loading investigation...</div>;

  const { alert, transaction, user, merchant, featureSnapshot } = bundle;
  const topEntity = bundle.entityRisk[0];

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Case Investigation Workspace</p>
          <h1>{user.full_name}</h1>
        </div>
        <div className="topActions">
          <StatusPill value={alert.status} />
          <StatusPill value={alert.severity} />
        </div>
      </header>

      <section className="metricGrid">
        <MetricTile label="Fraud score" value={Number(alert.score).toFixed(0)} tone="hot" />
        <MetricTile label="Reasons" value={bundle.summary.reasonCount} />
        <MetricTile label="High-risk entities" value={bundle.summary.highRiskEntityCount} tone={bundle.summary.highRiskEntityCount ? "warn" : "cool"} />
        <MetricTile label="Related activity" value={bundle.summary.relatedTransactionCount} />
        <MetricTile label="Merchant open alerts" value={bundle.summary.openMerchantAlerts} tone={bundle.summary.openMerchantAlerts > 1 ? "warn" : undefined} />
      </section>

      <section className="caseLayout">
        <div className="panel">
          <div className="panelHeader">
            <h2>Evidence Bundle</h2>
            <strong>{transaction.currency} {Number(transaction.amount).toFixed(2)}</strong>
          </div>
          <div className="evidenceGrid">
            <div><span>Transaction</span><strong>{transaction.id.slice(0, 8)}</strong><small>{new Date(transaction.occurred_at).toLocaleString()} via {transaction.channel}</small></div>
            <div><span>Merchant</span><strong><Link href={`/merchants/${merchant.id}`}>{merchant.name}</Link></strong><small>{merchant.category} risk {merchant.risk_score}</small></div>
            <div><span>User</span><strong><Link href={`/users/${user.id}`}>{user.risk_tier}</Link></strong><small>{transaction.latitude}, {transaction.longitude}</small></div>
            <div><span>Device/IP</span><strong>{transaction.device_fingerprint.slice(0, 12)}</strong><small>{transaction.ip_address}</small></div>
            <div><span>Velocity</span><strong>{featureSnapshot?.velocity_5m ?? 0} / 5m</strong><small>{featureSnapshot?.velocity_1h ?? 0} / 1h</small></div>
            <div><span>Anomaly</span><strong>{Number(featureSnapshot?.amount_zscore ?? 0).toFixed(2)} z</strong><small>{Number(featureSnapshot?.geo_kmh ?? 0).toFixed(0)} km/h</small></div>
          </div>

          <div className="reasonStack">
            {alert.reasons.map(reason => (
              <div className="reason" key={reason.rule}>
                <code>{reason.rule} +{reason.scoreImpact}</code>
                <p>{reason.description}</p>
                {isContributionList(reason.evidence.topContributions) ? (
                  <div className="contributionStack">
                    {reason.evidence.topContributions.map(item => (
                      <div className={`contributionBar ${item.direction}`} key={item.feature}>
                        <div>
                          <strong>{item.feature}</strong>
                          <small>raw {Number(item.rawValue).toFixed(2)} / coeff {Number(item.coefficient).toFixed(3)}</small>
                        </div>
                        <span>{item.contribution > 0 ? "+" : ""}{Number(item.contribution).toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <small>{evidenceText(reason.evidence)}</small>
                )}
              </div>
            ))}
          </div>
        </div>

        <aside className="panel">
          <div className="panelHeader"><h2>Investigation Control</h2><ClipboardCheck size={17} /></div>
          <div className="formRow">
            <input value={analyst} onChange={event => setAnalyst(event.target.value)} aria-label="Analyst" />
            <div className="split">
              <input value={assignedTo} onChange={event => setAssignedTo(event.target.value)} aria-label="Assignee" />
              <input type="number" min={1} max={5} value={priority} onChange={event => setPriority(Number(event.target.value))} aria-label="Priority" />
              <input type="number" min={1} max={168} value={slaHours} onChange={event => setSlaHours(Number(event.target.value))} aria-label="SLA hours" />
            </div>
            <button className="primary" onClick={assignCase}><FileClock size={15} /> Assign Case</button>
            <textarea value={caseNote} onChange={event => setCaseNote(event.target.value)} rows={4} placeholder="Case note" />
            <button className="primary" onClick={addNote}>Add Note</button>
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={5} placeholder="Decision notes" />
            <div className="split">
              <button className="primary" onClick={() => decide("confirmed_fraud")}>Confirm Fraud</button>
              <button className="primary" onClick={() => decide("false_positive")}>False Positive</button>
            </div>
            <button className="primary" onClick={saveSnapshot}><Save size={15} /> Save Evidence Snapshot</button>
            <small>{snapshotStatus || (bundle.latestSnapshot ? `Latest snapshot ${new Date(bundle.latestSnapshot.created_at).toLocaleString()}` : "No evidence snapshot saved yet")}</small>
          </div>
          <div className="timeline">
            <div className="timelineItem">
              <strong>Recommended actions</strong>
              {bundle.recommendedActions.map(action => <p key={action}>{action}</p>)}
            </div>
            {topEntity && (
              <div className="timelineItem">
                <strong>Top linked entity</strong>
                <span>{topEntity.entity_type} - {topEntity.entity_id}</span>
                <p>Memory risk {Number(topEntity.risk_score).toFixed(0)} from {topEntity.transaction_count} transactions and {topEntity.alert_count} alerts.</p>
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="opsGrid lower">
        <RelatedPanel title="Related Device Activity" rows={bundle.relatedActivity.deviceTransactions} />
        <RelatedPanel title="Related IP Activity" rows={bundle.relatedActivity.ipTransactions} />
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Merchant Alert Pattern</h2><Archive size={17} /></div>
          <table>
            <thead><tr><th>Alert</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {bundle.relatedActivity.merchantAlerts.map(row => (
                <tr key={row.id}>
                  <td><Link href={`/alerts/${row.id}`}><StatusPill value={row.severity} /></Link><small>{Number(row.score).toFixed(0)}</small></td>
                  <td>{row.full_name}</td>
                  <td>{row.currency} {Number(row.amount).toFixed(2)}</td>
                  <td><StatusPill value={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Case Timeline</h2></div>
          <div className="timeline">
            {bundle.timeline.map((item, index) => (
              <div className="timelineItem" key={`${item.type}-${index}`}>
                <strong>{item.title}</strong>
                <span>{item.actor} - {new Date(item.created_at).toLocaleString()}</span>
                {item.detail ? <p>{evidenceText(item.detail)}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function RelatedPanel({ title, rows }: { title: string; rows: RelatedTransaction[] }) {
  return (
    <div className="panel">
      <div className="panelHeader"><h2>{title}</h2><strong>{rows.length}</strong></div>
      <table>
        <thead><tr><th>Transaction</th><th>Customer</th><th>Merchant</th><th>Score</th></tr></thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.currency} {Number(row.amount).toFixed(2)}<small>{new Date(row.occurred_at).toLocaleString()}</small></td>
              <td>{row.full_name ?? "Same customer"}</td>
              <td>{row.merchant_name}<small>{row.channel}</small></td>
              <td>{row.alert_id ? <Link href={`/alerts/${row.alert_id}`}><StatusPill value={row.severity ?? "pending"} /></Link> : Number(row.score ?? 0).toFixed(0)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4}>No related activity found for this evidence type.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
