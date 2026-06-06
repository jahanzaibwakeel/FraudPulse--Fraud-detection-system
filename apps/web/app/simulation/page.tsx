"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Play, RefreshCw } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type Scenario = {
  id: string;
  name: string;
  description: string;
  expectedSignals: string[];
  defaultCount: number;
};

type Account = {
  user_id: string;
  card_id: string;
  full_name: string;
  last4: string;
  risk_tier: string;
  baseline_daily_amount: string;
};

type SimulationRun = {
  id: string;
  scenario_id: string;
  status: string;
  actor: string;
  parameters: Record<string, unknown>;
  expected_signals: string[];
  transaction_ids: string[];
  error?: string | null;
  started_at: string;
  completed_at?: string | null;
};

type LabData = {
  scenarios: Scenario[];
  accounts: Account[];
  recentRuns: SimulationRun[];
};

type RunResult = {
  runId: string;
  scenarioId: string;
  transactionCount: number;
  transactionIds: string[];
};

export default function SimulationLabPage() {
  const [lab, setLab] = useState<LabData | null>(null);
  const [scenarioId, setScenarioId] = useState("card_testing_burst");
  const [userId, setUserId] = useState("");
  const [transactionCount, setTransactionCount] = useState(20);
  const [amountMultiplier, setAmountMultiplier] = useState(1.4);
  const [cadenceSeconds, setCadenceSeconds] = useState(12);
  const [deviceStrategy, setDeviceStrategy] = useState("shared");
  const [ipStrategy, setIpStrategy] = useState("rotating");
  const [fraudRate, setFraudRate] = useState(0.9);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  const refresh = async () => {
    const next = await apiGet<LabData>("/simulation/lab");
    setLab(next);
    if (!userId && next.accounts[0]) setUserId(next.accounts[0].user_id);
  };

  useEffect(() => {
    refresh();
  }, []);

  const selectedScenario = useMemo(
    () => lab?.scenarios.find(scenario => scenario.id === scenarioId),
    [lab, scenarioId]
  );

  const runCampaign = async () => {
    setRunning(true);
    const result = await apiPost<RunResult>("/simulation/runs", {
      scenarioId,
      userId,
      actor: "demo-sim-lab",
      transactionCount,
      amountMultiplier,
      cadenceSeconds,
      deviceStrategy,
      ipStrategy,
      fraudRate
    });
    setLastRun(result);
    await refresh();
    setRunning(false);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Configurable fraud campaign simulator</p>
          <h1>Simulation Lab</h1>
        </div>
        <div className="topActions">
          <button className="primary" onClick={runCampaign} disabled={running}><Play size={16} /> {running ? "Launching" : "Launch Campaign"}</button>
          <button className="iconButton" onClick={refresh} title="Refresh simulation lab"><RefreshCw size={18} /></button>
        </div>
      </header>

      <section className="metricGrid">
        <MetricTile label="Scenarios" value={lab?.scenarios.length ?? 0} tone="cool" />
        <MetricTile label="Target accounts" value={lab?.accounts.length ?? 0} />
        <MetricTile label="Recent runs" value={lab?.recentRuns.length ?? 0} />
        <MetricTile label="Planned tx" value={transactionCount} tone="warn" />
        <MetricTile label="Last launched" value={lastRun?.transactionCount ?? 0} tone={lastRun ? "cool" : undefined} />
      </section>

      <section className="opsGrid">
        <div className="panel">
          <div className="panelHeader"><h2>Campaign Design</h2><FlaskConical size={18} /></div>
          <div className="formRow">
            <select value={scenarioId} onChange={event => setScenarioId(event.target.value)} aria-label="Scenario">
              {lab?.scenarios.map(scenario => <option value={scenario.id} key={scenario.id}>{scenario.name}</option>)}
            </select>
            <select value={userId} onChange={event => setUserId(event.target.value)} aria-label="Target account">
              {lab?.accounts.map(account => (
                <option value={account.user_id} key={account.user_id}>{account.full_name} - card {account.last4} - {account.risk_tier}</option>
              ))}
            </select>
            <div className="split">
              <input type="number" min={1} max={200} value={transactionCount} onChange={event => setTransactionCount(Number(event.target.value))} aria-label="Transaction count" />
              <input type="number" min={0.1} max={12} step={0.1} value={amountMultiplier} onChange={event => setAmountMultiplier(Number(event.target.value))} aria-label="Amount multiplier" />
              <input type="number" min={5} max={3600} value={cadenceSeconds} onChange={event => setCadenceSeconds(Number(event.target.value))} aria-label="Cadence seconds" />
            </div>
            <div className="split">
              <select value={deviceStrategy} onChange={event => setDeviceStrategy(event.target.value)} aria-label="Device strategy">
                <option value="shared">Shared device</option>
                <option value="rotating">Rotating devices</option>
                <option value="trusted">Trusted device</option>
              </select>
              <select value={ipStrategy} onChange={event => setIpStrategy(event.target.value)} aria-label="IP strategy">
                <option value="rotating">Rotating IPs</option>
                <option value="shared">Shared IP</option>
                <option value="residential">Residential IP</option>
              </select>
              <input type="number" min={0} max={1} step={0.05} value={fraudRate} onChange={event => setFraudRate(Number(event.target.value))} aria-label="Fraud rate" />
            </div>
          </div>
          <div className="timeline">
            <div className="timelineItem">
              <strong>{selectedScenario?.name ?? "Select a scenario"}</strong>
              <span>{selectedScenario?.expectedSignals.join(" / ")}</span>
              <p>{selectedScenario?.description}</p>
            </div>
            {lastRun && (
              <div className="timelineItem">
                <strong>Run {lastRun.runId.slice(0, 8)} launched</strong>
                <span>{lastRun.scenarioId} - {lastRun.transactionCount} transactions</span>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Scenario Library</h2></div>
          <div className="scenarioStack">
            {lab?.scenarios.map(scenario => (
              <button className={scenario.id === scenarioId ? "scenarioButton active" : "scenarioButton"} key={scenario.id} onClick={() => {
                setScenarioId(scenario.id);
                setTransactionCount(scenario.defaultCount);
              }}>
                <strong>{scenario.name}</strong>
                <span>{scenario.description}</span>
                <small>{scenario.expectedSignals.join(" / ")}</small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Recent Simulation Runs</h2><strong>{lab?.recentRuns.length ?? 0}</strong></div>
        <table>
          <thead><tr><th>Run</th><th>Scenario</th><th>Status</th><th>Transactions</th><th>Parameters</th><th>Started</th></tr></thead>
          <tbody>
            {lab?.recentRuns.map(run => (
              <tr key={run.id}>
                <td>{run.id.slice(0, 8)}<small>{run.actor}</small></td>
                <td>{run.scenario_id}<small>{run.expected_signals.join(" / ")}</small></td>
                <td><StatusPill value={run.status === "completed" ? "low" : run.status === "failed" ? "critical" : "medium"} /></td>
                <td>{run.transaction_ids.length}</td>
                <td>{String(run.parameters.transactionCount ?? "n/a")} tx / x{String(run.parameters.amountMultiplier ?? "1")}</td>
                <td>{new Date(run.started_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
