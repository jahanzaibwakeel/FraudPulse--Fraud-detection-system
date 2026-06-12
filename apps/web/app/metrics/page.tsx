"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { MetricTile } from "../components/MetricTile";

type Overview = {
  tx_1h: string;
  alerts_1h: string;
  pending_reviews: string;
  avg_latency_ms: string;
  queue: { waiting: number; active: number; failed: number; delayed: number };
  serviceHealth: Array<{ service: string; status: string; detail: string; uptimeSeconds?: number }>;
};

export default function MetricsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  useEffect(() => {
    apiGet<Overview>("/admin/overview").then(setOverview);
    const timer = setInterval(() => apiGet<Overview>("/admin/overview").then(setOverview), 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="screen">
      <header className="topbar"><div><p className="eyebrow">Operational telemetry</p><h1>System Metrics</h1></div></header>
      <section className="metricGrid">
        <MetricTile label="API throughput 1h" value={overview?.tx_1h ?? 0} />
        <MetricTile label="Alerts 1h" value={overview?.alerts_1h ?? 0} tone="hot" />
        <MetricTile label="Active jobs" value={overview?.queue.active ?? 0} tone="cool" />
        <MetricTile label="Failed jobs" value={overview?.queue.failed ?? 0} tone="warn" />
        <MetricTile label="Avg latency" value={`${Math.round(Number(overview?.avg_latency_ms ?? 0))} ms`} />
      </section>
      <section className="panel formRow">
        <p>Prometheus scrapes `/metrics` from the API and worker. Grafana dashboards run in local/private monitoring mode and should stay behind authentication, a VPN, or an SSH tunnel rather than being exposed publicly.</p>
      </section>
      <section className="panel">
        <div className="panelHeader"><h2>Service Health</h2><strong>{overview?.serviceHealth?.length ?? 0} checks</strong></div>
        <table>
          <thead><tr><th>Service</th><th>Status</th><th>Detail</th><th>Uptime</th></tr></thead>
          <tbody>
            {overview?.serviceHealth?.map(item => (
              <tr key={item.service}>
                <td>{item.service}</td>
                <td>{item.status}</td>
                <td>{item.detail}</td>
                <td>{item.uptimeSeconds ? `${Math.floor(item.uptimeSeconds / 60)}m` : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
