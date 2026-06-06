"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet, apiPost } from "../lib/api";
import { StatusPill } from "../components/StatusPill";

type Alert = {
  id: string;
  severity: string;
  score: string;
  status: string;
  full_name: string;
  merchant_name: string;
  amount: string;
  currency: string;
  occurred_at: string;
  assigned_to?: string | null;
  priority: number;
  due_at?: string | null;
};

export function AlertsClient() {
  const searchParams = useSearchParams();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [severity, setSeverity] = useState(searchParams.get("severity") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [assignedTo, setAssignedTo] = useState(searchParams.get("assignedTo") ?? "");
  const [overdue, setOverdue] = useState(searchParams.get("overdue") === "true");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const refresh = async () => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (status) params.set("status", status);
    if (assignedTo) params.set("assignedTo", assignedTo);
    if (overdue) params.set("overdue", "true");
    if (query) params.set("q", query);
    const next = await apiGet<Alert[]>(`/alerts?${params.toString()}`);
    setAlerts(next);
    setSelected(current => current.filter(id => next.some(alert => alert.id === id)));
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (id: string) => {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const bulkAssign = async () => {
    if (!selected.length) return;
    await apiPost("/alerts/bulk/assign", { alertIds: selected, assignedTo: "casey.ops", priority: 2, slaHours: 8, actor: "demo-lead" });
    setSelected([]);
    await refresh();
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Manual review queue</p>
          <h1>Fraud Alert Center</h1>
        </div>
        <div className="topActions">
          <button className="primary" onClick={refresh}>Apply Filters</button>
          <button className="primary" onClick={bulkAssign}>Assign Selected</button>
        </div>
      </header>
      <section className="panel filterBar">
        <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Status filter">
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="confirmed_fraud">Confirmed fraud</option>
          <option value="false_positive">False positive</option>
        </select>
        <select value={severity} onChange={event => setSeverity(event.target.value)} aria-label="Severity filter">
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={assignedTo} onChange={event => setAssignedTo(event.target.value)} aria-label="Owner filter">
          <option value="">Any owner</option>
          <option value="unassigned">Unassigned</option>
          <option value="casey.ops">casey.ops</option>
        </select>
        <label className="checkLabel"><input type="checkbox" checked={overdue} onChange={event => setOverdue(event.target.checked)} /> Overdue</label>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search customer, merchant, owner" />
      </section>
      <section className="panel">
        <table>
          <thead><tr><th>Select</th><th>Severity</th><th>Customer</th><th>Merchant</th><th>Amount</th><th>Owner</th><th>SLA</th><th>Status</th></tr></thead>
          <tbody>
            {alerts.map(alert => (
              <tr key={alert.id}>
                <td><input type="checkbox" checked={selected.includes(alert.id)} onChange={() => toggle(alert.id)} aria-label={`Select ${alert.id}`} /></td>
                <td><StatusPill value={alert.severity} /></td>
                <td><Link href={`/alerts/${alert.id}`}>{alert.full_name}</Link></td>
                <td>{alert.merchant_name}</td>
                <td>{alert.currency} {Number(alert.amount).toFixed(2)}</td>
                <td>{alert.assigned_to ?? "Unassigned"}<small>P{alert.priority}</small></td>
                <td>{alert.due_at ? new Date(alert.due_at).toLocaleString() : "No SLA"}</td>
                <td><StatusPill value={alert.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
