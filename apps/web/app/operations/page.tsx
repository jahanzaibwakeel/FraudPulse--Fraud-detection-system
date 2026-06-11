"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, RotateCcw } from "lucide-react";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type AlertRow = {
  id: string;
  severity: string;
  score: string;
  assigned_to?: string | null;
  due_at?: string | null;
  full_name: string;
  merchant_name: string;
  amount: string;
  currency: string;
};

type Workload = { analyst: string; pending: string; breached: string; critical: string };
type Sla = {
  pending: string;
  breached: string;
  due_soon: string;
  unassigned: string;
  high_risk_pending: string;
  workload: Workload[];
  breachedAlerts: AlertRow[];
  assignmentQueue: AlertRow[];
};
type SavedView = { id: string; name: string; owner: string; filters: Record<string, string | boolean>; updated_at: string };
type DlqEvent = { id: string; transaction_id?: string | null; payload: Record<string, unknown>; error?: string; created_at: string };

const viewHref = (filters: Record<string, string | boolean>) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => params.set(key, String(value)));
  return `/alerts?${params.toString()}`;
};

export default function OperationsPage() {
  const [sla, setSla] = useState<Sla | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [dlq, setDlq] = useState<DlqEvent[]>([]);
  const [viewName, setViewName] = useState("My pending critical queue");
  const [assigning, setAssigning] = useState(false);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [slaData, savedViews, dlqEvents] = await Promise.all([
      apiGet<Sla>("/operations/sla"),
      apiGet<SavedView[]>("/alert-views"),
      apiGet<DlqEvent[]>("/dlq/events?limit=50")
    ]);
    setSla(slaData);
    setViews(savedViews);
    setDlq(dlqEvents);
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, []);

  const bulkAssignPending = async () => {
    const alertIds = sla?.assignmentQueue.slice(0, 50).map(alert => alert.id) ?? [];
    if (!alertIds.length) {
      setOperationMessage("No unassigned pending alerts are available for bulk assignment.");
      return;
    }
    setAssigning(true);
    setOperationMessage(null);
    try {
      const result = await apiPost<{ updatedCount: number }>("/alerts/bulk/assign", { alertIds, assignedTo: "casey.ops", priority: 1, slaHours: 4, actor: "demo-lead" });
      await refresh();
      setOperationMessage(`Assigned ${result.updatedCount} pending alerts to casey.ops.`);
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "Bulk assignment failed.");
    } finally {
      setAssigning(false);
    }
  };

  const saveCriticalView = async () => {
    await apiPost("/alert-views", {
      name: viewName,
      owner: "demo-lead",
      filters: { status: "pending", severity: "critical" }
    });
    await refresh();
  };

  const deleteView = async (id: string) => {
    await apiDelete(`/alert-views/${id}`);
    await refresh();
  };

  const replayDlq = async (id: string) => {
    await apiPost(`/dlq/events/${id}/replay`, { actor: "demo-operator" });
    await refresh();
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Analyst operations command</p>
          <h1>Operations</h1>
        </div>
        <button className="iconButton" onClick={refresh} title="Refresh operations"><RefreshCw size={18} /></button>
      </header>

      <section className="metricGrid">
        <MetricTile label="Pending alerts" value={sla?.pending ?? 0} />
        <MetricTile label="SLA breached" value={sla?.breached ?? 0} tone="hot" />
        <MetricTile label="Due soon" value={sla?.due_soon ?? 0} tone="warn" />
        <MetricTile label="Unassigned" value={sla?.unassigned ?? 0} />
        <MetricTile label="High risk pending" value={sla?.high_risk_pending ?? 0} tone="hot" />
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader">
            <h2>SLA Breaches</h2>
            <button className="primary" onClick={bulkAssignPending} disabled={assigning || !sla}>
              {assigning ? "Assigning..." : "Assign Top 50 Pending"}
            </button>
          </div>
          {operationMessage && <div className="notice">{operationMessage}</div>}
          <table>
            <thead><tr><th>Case</th><th>Customer</th><th>Merchant</th><th>Due</th><th>Owner</th></tr></thead>
            <tbody>
              {sla?.breachedAlerts.slice(0, 12).map(alert => (
                <tr key={alert.id}>
                  <td><Link href={`/alerts/${alert.id}`}><StatusPill value={alert.severity} /></Link><small>{Number(alert.score).toFixed(0)}</small></td>
                  <td>{alert.full_name}</td>
                  <td>{alert.merchant_name}<small>{alert.currency} {Number(alert.amount).toFixed(2)}</small></td>
                  <td>{alert.due_at ? new Date(alert.due_at).toLocaleString() : "No SLA"}</td>
                  <td>{alert.assigned_to ?? "Unassigned"}</td>
                </tr>
              ))}
              {sla && !sla.breachedAlerts.length && (
                <tr><td colSpan={5}>No breached pending alerts. New SLA breaches will appear here when pending cases pass their due time.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Analyst Workload</h2></div>
          <table>
            <thead><tr><th>Analyst</th><th>Pending</th><th>Breached</th><th>Critical</th></tr></thead>
            <tbody>
              {sla?.workload.map(row => (
                <tr key={row.analyst}>
                  <td>{row.analyst}</td>
                  <td>{row.pending}</td>
                  <td>{row.breached}</td>
                  <td>{row.critical}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader">
            <h2>Top Pending Assignment Queue</h2>
            <Link className="primary" href="/alerts?status=pending&assignedTo=unassigned">View Unassigned</Link>
          </div>
          <table>
            <thead><tr><th>Case</th><th>Customer</th><th>Merchant</th><th>Amount</th><th>Owner</th></tr></thead>
            <tbody>
              {sla?.assignmentQueue.slice(0, 12).map(alert => (
                <tr key={alert.id}>
                  <td><Link href={`/alerts/${alert.id}`}><StatusPill value={alert.severity} /></Link><small>{Number(alert.score).toFixed(0)}</small></td>
                  <td>{alert.full_name}</td>
                  <td>{alert.merchant_name}</td>
                  <td>{alert.currency} {Number(alert.amount).toFixed(2)}</td>
                  <td>{alert.assigned_to ?? "Unassigned"}</td>
                </tr>
              ))}
              {sla && !sla.assignmentQueue.length && (
                <tr><td colSpan={5}>No unassigned pending alerts are available. Assigned cases can be viewed in the Alert Center.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Assigned Case Views</h2></div>
          <div className="timeline">
            <div className="timelineItem">
              <strong><Link href="/alerts?status=pending&assignedTo=casey.ops">Pending cases assigned to casey.ops</Link></strong>
              <span>Use this after bulk assignment to see the cases moved from Unassigned into the analyst queue.</span>
            </div>
            <div className="timelineItem">
              <strong><Link href="/alerts?status=confirmed_fraud&assignedTo=casey.ops">Confirmed fraud assigned to casey.ops</Link></strong>
              <span>Resolved fraud decisions remain in Alert Center with status confirmed fraud.</span>
            </div>
            <div className="timelineItem">
              <strong><Link href="/alerts?status=false_positive&assignedTo=casey.ops">False positives assigned to casey.ops</Link></strong>
              <span>Resolved false-positive decisions remain available for audit and performance metrics.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Saved Queues</h2></div>
          <div className="formRow">
            <div className="split">
              <input value={viewName} onChange={event => setViewName(event.target.value)} aria-label="Saved queue name" />
              <button className="primary" onClick={saveCriticalView}>Save Critical View</button>
            </div>
          </div>
          <div className="timeline">
            {views.map(view => (
              <div className="timelineItem" key={view.id}>
                <strong><Link href={viewHref(view.filters)}>{view.name}</Link></strong>
                <span>{view.owner} · {JSON.stringify(view.filters)}</span>
                <button className="primary" onClick={() => deleteView(view.id)}>Delete</button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Dead-Letter Queue</h2></div>
          <div className="timeline">
            {dlq.map(event => (
              <div className="timelineItem" key={event.id}>
                <strong>Event {event.id}</strong>
                <span>{new Date(event.created_at).toLocaleString()} · {event.error ?? "scoring failure"}</span>
                <button className="primary" onClick={() => replayDlq(event.id)}><RotateCcw size={14} /> Replay</button>
              </div>
            ))}
            {!dlq.length && <div className="timelineItem"><strong>No dead-letter events</strong><span>Scoring failures will appear here after retries are exhausted.</span></div>}
          </div>
        </div>
      </section>
    </div>
  );
}
