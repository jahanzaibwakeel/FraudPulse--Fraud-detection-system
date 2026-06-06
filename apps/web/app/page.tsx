"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Activity, AlertTriangle, Pause, Play, Rocket, Zap } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { API_TOKEN, apiGet, apiPost, WS_URL } from "./lib/api";
import { MetricTile } from "./components/MetricTile";
import { StatusPill } from "./components/StatusPill";

type Transaction = {
  id: string;
  user_id: string;
  merchant_name: string;
  merchant_category: string;
  amount: string;
  currency: string;
  channel: string;
  occurred_at: string;
  score?: string;
  severity?: string;
};

type Alert = {
  id: string;
  severity: string;
  score: string;
  status: string;
  merchant_name: string;
  full_name: string;
  amount: string;
  reasons: Array<{ rule: string; description: string; scoreImpact: number }>;
};

type Overview = {
  tx_1h: string;
  alerts_1h: string;
  pending_reviews: string;
  avg_latency_ms: string;
  queue: { waiting: number; active: number; failed: number; delayed: number };
};

type Scenario = {
  id: string;
  name: string;
  description: string;
  expectedSignals: string[];
};

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [connected, setConnected] = useState(false);
  const [simRunning, setSimRunning] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);

  const refresh = async () => {
    const [txs, alertRows, summary] = await Promise.all([
      apiGet<Transaction[]>("/transactions?limit=60"),
      apiGet<Alert[]>("/alerts?status=pending"),
      apiGet<Overview>("/admin/overview")
    ]);
    setTransactions(txs);
    setAlerts(alertRows);
    setOverview(summary);
  };

  useEffect(() => {
    setMounted(true);
    refresh();
    apiGet<Scenario[]>("/simulator/scenarios").then(setScenarios);
    const socket = io(WS_URL, { auth: { token: API_TOKEN } });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("transaction_created", refresh);
    socket.on("transaction_scored", refresh);
    socket.on("fraud_alert_created", refresh);
    const timer = setInterval(refresh, 8000);
    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, []);

  const chartData = useMemo(() => transactions.slice(0, 30).reverse().map((tx, index) => ({
    index,
    amount: Number(tx.amount),
    score: Number(tx.score ?? 0)
  })), [transactions]);

  const controlSimulator = async () => {
    const next = !simRunning;
    setSimRunning(next);
    await apiPost("/simulator/control", { action: next ? "resume" : "pause" });
  };

  const runScenario = async (scenarioId: string) => {
    setRunningScenario(scenarioId);
    await apiPost(`/simulator/scenarios/${scenarioId}/run`, { actor: "demo-operator" });
    await refresh();
    setRunningScenario(null);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Real-time financial risk command</p>
          <h1>Live Fraud Monitoring</h1>
        </div>
        <div className="topActions">
          <span className={connected ? "socket on" : "socket"}><Zap size={15} /> WebSocket</span>
          <button className="iconButton" onClick={controlSimulator} title="Toggle simulator">
            {simRunning ? <Pause size={18} /> : <Play size={18} />}
          </button>
        </div>
      </header>

      <section className="metricGrid">
        <MetricTile label="Transactions / 1h" value={overview?.tx_1h ?? 0} tone="cool" />
        <MetricTile label="Alerts / 1h" value={overview?.alerts_1h ?? 0} tone="hot" />
        <MetricTile label="Pending reviews" value={overview?.pending_reviews ?? 0} tone="warn" />
        <MetricTile label="Avg scoring latency" value={`${Math.round(Number(overview?.avg_latency_ms ?? 0))} ms`} />
        <MetricTile label="Queue depth" value={(overview?.queue.waiting ?? 0) + (overview?.queue.delayed ?? 0)} />
      </section>

      <section className="opsGrid">
        <div className="panel span2">
          <div className="panelHeader"><h2>Transaction Stream</h2><Activity size={18} /></div>
          <div className="chartBox">
            {mounted && <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="amount" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#26c6da" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#26c6da" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#20313d" vertical={false} />
                <XAxis dataKey="index" stroke="#7f96a3" />
                <YAxis stroke="#7f96a3" />
                <Tooltip contentStyle={{ background: "#0c1418", border: "1px solid #27424e" }} />
                <Area type="monotone" dataKey="amount" stroke="#26c6da" fill="url(#amount)" />
                <Area type="monotone" dataKey="score" stroke="#ff6b6b" fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>}
          </div>
          <table>
            <thead><tr><th>Time</th><th>Merchant</th><th>Channel</th><th>Amount</th><th>Score</th></tr></thead>
            <tbody>
              {transactions.slice(0, 12).map(tx => (
                <tr key={tx.id}>
                  <td>{new Date(tx.occurred_at).toLocaleTimeString()}</td>
                  <td>{tx.merchant_name}<small>{tx.merchant_category}</small></td>
                  <td>{tx.channel}</td>
                  <td>{tx.currency} {Number(tx.amount).toFixed(2)}</td>
                  <td><StatusPill value={tx.severity ?? "scoring"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Scenario Replay</h2><Rocket size={18} /></div>
          <div className="scenarioStack">
            {scenarios.map(scenario => (
              <button className="scenarioButton" key={scenario.id} onClick={() => runScenario(scenario.id)} disabled={runningScenario !== null}>
                <strong>{scenario.name}</strong>
                <span>{scenario.description}</span>
                <small>{scenario.expectedSignals.join(" / ")}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Alert Center</h2><AlertTriangle size={18} /></div>
          <div className="alertStack">
            {alerts.slice(0, 8).map(alert => (
              <a className="alertRow" href={`/alerts/${alert.id}`} key={alert.id}>
                <div>
                  <StatusPill value={alert.severity} />
                  <strong>{alert.full_name}</strong>
                  <span>{alert.merchant_name}</span>
                </div>
                <b>{Number(alert.score).toFixed(0)}</b>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
