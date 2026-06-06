"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost } from "../../lib/api";
import { StatusPill } from "../../components/StatusPill";

type AlertDetail = {
  id: string;
  severity: string;
  score: string;
  confidence: string;
  status: string;
  assigned_to?: string | null;
  priority: number;
  due_at?: string | null;
  reasons: Array<{ rule: string; description: string; scoreImpact: number; confidence: number; evidence: Record<string, unknown> }>;
  transaction: { id: string; amount: string; currency: string; channel: string; occurred_at: string; latitude: string; longitude: string };
  user: { id: string; full_name: string; risk_tier: string };
  merchant: { id: string; name: string; category: string; risk_score: number };
  case_notes: Array<{ id: string; author: string; note: string; created_at: string }>;
  review_decisions: Array<{ id: string; analyst: string; decision: string; notes?: string; created_at: string }>;
  audit_trail: Array<{ id: string; actor: string; action: string; created_at: string; payload: Record<string, unknown> }>;
};

export default function AlertDetailPage({ params }: { params: { id: string } }) {
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [notes, setNotes] = useState("");
  const [analyst, setAnalyst] = useState("demo-analyst");
  const [assignedTo, setAssignedTo] = useState("casey.ops");
  const [priority, setPriority] = useState(2);
  const [slaHours, setSlaHours] = useState(8);
  const [caseNote, setCaseNote] = useState("");

  const refresh = () => apiGet<AlertDetail>(`/alerts/${params.id}`).then(setAlert);
  useEffect(() => { refresh(); }, [params.id]);

  const decide = async (decision: "confirmed_fraud" | "false_positive") => {
    await apiPost(`/alerts/${params.id}/review`, { decision, analyst, notes });
    await refresh();
  };

  const assignCase = async () => {
    await apiPost(`/alerts/${params.id}/assign`, { assignedTo, priority, slaHours, actor: analyst });
    await refresh();
  };

  const addNote = async () => {
    if (!caseNote.trim()) return;
    await apiPost(`/alerts/${params.id}/notes`, { author: analyst, note: caseNote });
    setCaseNote("");
    await refresh();
  };

  if (!alert) return <div className="screen">Loading alert...</div>;

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Explainable alert detail</p>
          <h1>{alert.user.full_name}</h1>
        </div>
        <StatusPill value={alert.severity} />
      </header>
      <section className="detailGrid">
        <div className="panel">
          <div className="panelHeader"><h2>Flag Explanation</h2><strong>{Number(alert.score).toFixed(0)} / 100</strong></div>
          {alert.reasons.map(reason => (
            <div className="reason" key={reason.rule}>
              <code>{reason.rule} +{reason.scoreImpact}</code>
              <p>{reason.description}</p>
              <small>{JSON.stringify(reason.evidence)}</small>
            </div>
          ))}
        </div>
        <aside className="panel">
          <div className="panelHeader"><h2>Case Control</h2><StatusPill value={alert.status} /></div>
          <div className="formRow">
            <Link href={`/users/${alert.user.id}`}>User profile: {alert.user.risk_tier}</Link>
            <Link href={`/merchants/${alert.merchant.id}`}>Merchant profile: {alert.merchant.name}</Link>
            <p>Transaction: {alert.transaction.currency} {Number(alert.transaction.amount).toFixed(2)} via {alert.transaction.channel}</p>
            <p>Owner: {alert.assigned_to ?? "Unassigned"} {alert.due_at ? `due ${new Date(alert.due_at).toLocaleString()}` : ""}</p>
            <input value={analyst} onChange={event => setAnalyst(event.target.value)} aria-label="Analyst" />
            <div className="split">
              <input value={assignedTo} onChange={event => setAssignedTo(event.target.value)} aria-label="Assignee" />
              <input type="number" min={1} max={5} value={priority} onChange={event => setPriority(Number(event.target.value))} aria-label="Priority" />
              <input type="number" min={1} max={168} value={slaHours} onChange={event => setSlaHours(Number(event.target.value))} aria-label="SLA hours" />
            </div>
            <button className="primary" onClick={assignCase}>Assign Case</button>
            <textarea value={caseNote} onChange={event => setCaseNote(event.target.value)} rows={4} placeholder="Case note" />
            <button className="primary" onClick={addNote}>Add Note</button>
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={5} placeholder="Decision notes" />
            <div className="split">
              <button className="primary" onClick={() => decide("confirmed_fraud")}>Confirm Fraud</button>
              <button className="primary" onClick={() => decide("false_positive")}>False Positive</button>
            </div>
          </div>
        </aside>
      </section>
      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Case Notes</h2></div>
          <div className="timeline">
            {alert.case_notes.map(note => (
              <div className="timelineItem" key={note.id}>
                <strong>{note.author}</strong>
                <span>{new Date(note.created_at).toLocaleString()}</span>
                <p>{note.note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panelHeader"><h2>Audit Timeline</h2></div>
          <div className="timeline">
            {[...alert.audit_trail, ...alert.review_decisions.map(item => ({
              id: item.id,
              actor: item.analyst,
              action: item.decision,
              created_at: item.created_at,
              payload: { notes: item.notes ?? "" }
            }))].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(item => (
              <div className="timelineItem" key={`${item.action}-${item.id}`}>
                <strong>{item.action.replaceAll("_", " ")}</strong>
                <span>{item.actor} · {new Date(item.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
