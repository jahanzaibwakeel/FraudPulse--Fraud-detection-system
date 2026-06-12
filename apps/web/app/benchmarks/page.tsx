"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Play, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, apiPost } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type BenchmarkMetrics = {
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  truePositiveRate: number;
  confusionMatrix: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
  };
};

type BenchmarkResult = {
  algorithm: string;
  label: string;
  metrics: BenchmarkMetrics;
  notes: string;
};

type BenchmarkRun = {
  id: string;
  status: string;
  sample_size: number;
  validation_size: number;
  algorithms: string[];
  results: BenchmarkResult[];
  best_algorithm: string;
  created_by: string;
  created_at: string;
};

type BenchmarkResponse = { runs: BenchmarkRun[] };
type RunResponse = {
  run: BenchmarkRun;
  sampleSize: number;
  validationSize: number;
  bestAlgorithm: string;
  results: BenchmarkResult[];
};

const pct = (value?: number) => `${(((value ?? 0) * 100)).toFixed(1)}%`;

export default function BenchmarksPage() {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [latestResult, setLatestResult] = useState<RunResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [message, setMessage] = useState("");
  const [maxSamples, setMaxSamples] = useState(10000);
  const [mounted, setMounted] = useState(false);

  const refresh = async () => {
    const data = await apiGet<BenchmarkResponse>("/models/benchmarks");
    setRuns(data.runs);
  };

  useEffect(() => {
    setMounted(true);
    refresh();
  }, []);

  const latestRun = latestResult?.run ?? runs[0] ?? null;
  const results = latestResult?.results ?? latestRun?.results ?? [];
  const best = results.find(result => result.algorithm === (latestResult?.bestAlgorithm ?? latestRun?.best_algorithm));

  const chartData = useMemo(() => results.map(result => ({
    name: result.label,
    f1: Number(result.metrics.f1Score.toFixed(4)),
    precision: Number(result.metrics.precision.toFixed(4)),
    recall: Number(result.metrics.recall.toFixed(4))
  })), [results]);

  const runBenchmark = async () => {
    setRunning(true);
    const result = await apiPost<RunResponse>("/models/benchmarks/run", {
      actor: "demo-mlops",
      maxSamples,
      alertThreshold: 55,
      algorithms: ["rule_baseline", "logistic_regression", "gaussian_naive_bayes", "nearest_centroid"]
    });
    setLatestResult(result);
    await refresh();
    setRunning(false);
  };

  const promoteWinner = async () => {
    if (!latestRun) return;
    setPromoting(true);
    try {
      const result = await apiPost<{ model: { version: string } }>(`/models/benchmarks/${latestRun.id}/promote-winner`, { actor: "demo-mlops" });
      setMessage(`${result.model.version} created as a challenger model. Shadow-test it in Model Registry before promotion.`);
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local model benchmark suite</p>
          <h1>Model Benchmarks</h1>
        </div>
        <div className="topActions">
          <input type="number" min={50} max={50000} value={maxSamples} onChange={event => setMaxSamples(Number(event.target.value))} aria-label="Max samples" />
          <button className="primary" onClick={runBenchmark} disabled={running}><Play size={16} /> {running ? "Running" : "Run Benchmark"}</button>
          <button className="primary" onClick={promoteWinner} disabled={!latestRun || promoting}>Promote Winner</button>
          <button className="iconButton" onClick={refresh} title="Refresh benchmarks"><RefreshCw size={18} /></button>
        </div>
      </header>
      {message && <div className="notice">{message}</div>}

      <section className="metricGrid">
        <MetricTile label="Best algorithm" value={best?.label ?? "none"} tone="cool" />
        <MetricTile label="Sample size" value={latestRun?.sample_size ?? 0} />
        <MetricTile label="Validation size" value={latestRun?.validation_size ?? 0} />
        <MetricTile label="Best F1" value={(best?.metrics.f1Score ?? 0).toFixed(3)} tone="cool" />
        <MetricTile label="Runs stored" value={runs.length} />
      </section>

      <section className="opsGrid lower">
        <div className="panel">
          <div className="panelHeader"><h2>Algorithm Comparison</h2><BarChart3 size={18} /></div>
          <div className="chartBox">
            {mounted && <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid stroke="#20313d" vertical={false} />
                <XAxis dataKey="name" stroke="#7f96a3" tick={{ fontSize: 11 }} />
                <YAxis stroke="#7f96a3" />
                <Tooltip contentStyle={{ background: "#0c1418", border: "1px solid #27424e" }} />
                <Bar dataKey="f1" fill="#26c6da" />
                <Bar dataKey="recall" fill="#8fd14f" />
                <Bar dataKey="precision" fill="#f4b44d" />
              </BarChart>
            </ResponsiveContainer>}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader"><h2>Latest Run</h2><StatusPill value={latestRun?.status ?? "pending"} /></div>
          <div className="timeline">
            {results.map(result => (
              <div className="timelineItem" key={result.algorithm}>
                <strong>{result.label}</strong>
                <span>F1 {result.metrics.f1Score.toFixed(3)} / Precision {pct(result.metrics.precision)} / Recall {pct(result.metrics.recall)}</span>
                <p>{result.notes}</p>
              </div>
            ))}
            {!results.length && <div className="timelineItem"><strong>No benchmark run yet</strong><span>Run a benchmark to compare local algorithms.</span></div>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Benchmark History</h2><strong>{runs.length}</strong></div>
        <table>
          <thead><tr><th>Run</th><th>Best</th><th>Samples</th><th>Algorithms</th><th>Created</th></tr></thead>
          <tbody>
            {runs.map(run => (
              <tr key={run.id}>
                <td>{run.id.slice(0, 8)}<small>{run.created_by}</small></td>
                <td>{run.best_algorithm}</td>
                <td>{run.sample_size}<small>{run.validation_size} validation</small></td>
                <td>{run.algorithms.join(", ")}</td>
                <td>{new Date(run.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
