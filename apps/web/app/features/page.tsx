"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "../lib/api";
import { MetricTile } from "../components/MetricTile";
import { StatusPill } from "../components/StatusPill";

type FeatureRow = {
  transaction_id: string;
  full_name: string;
  merchant_name: string;
  amount: string;
  currency: string;
  velocity_5m: number;
  velocity_1h: number;
  amount_zscore: string;
  geo_kmh: string;
  merchant_risk: number;
  device_seen: boolean;
  score: string;
  severity: string;
};

type FeatureOverview = {
  feature_count: string;
  avg_velocity_5m: string;
  avg_velocity_1h: string;
  avg_amount_zscore: string;
  max_amount_zscore: string;
  avg_geo_kmh: string;
  max_geo_kmh: string;
  avg_merchant_risk: string;
  new_device_count: string;
  topAnomalies: FeatureRow[];
};

type FeatureExplanation = {
  transaction: FeatureRow & { channel: string; occurred_at: string; reasons: unknown[] };
  featureCards: Array<{ feature: string; label: string; value: number; severity: string; explanation: string }>;
  topDrivers: Array<{ feature: string; label: string; value: number; severity: string; explanation: string }>;
  recommendation: string;
};

type FeatureTrend = {
  bucket: string;
  avg_velocity_5m: string;
  avg_abs_amount_zscore: string;
  avg_geo_kmh: string;
  new_device_rate: string;
  avg_score: string;
};

export default function FeaturesPage() {
  const [overview, setOverview] = useState<FeatureOverview | null>(null);
  const [trends, setTrends] = useState<FeatureTrend[]>([]);
  const [selected, setSelected] = useState<FeatureExplanation | null>(null);
  const refresh = async () => {
    const [nextOverview, nextTrends] = await Promise.all([
      apiGet<FeatureOverview>("/features/overview"),
      apiGet<{ points: FeatureTrend[] }>("/features/trends?lookbackHours=6")
    ]);
    setOverview(nextOverview);
    setTrends(nextTrends.points);
  };

  const explain = async (transactionId: string) => {
    setSelected(await apiGet<FeatureExplanation>(`/features/transactions/${transactionId}/explain`));
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Scoring feature intelligence</p>
          <h1>Feature Store</h1>
        </div>
        <button className="iconButton" onClick={refresh} title="Refresh features"><RefreshCw size={18} /></button>
      </header>

      <section className="metricGrid">
        <MetricTile label="Feature snapshots" value={overview?.feature_count ?? 0} tone="cool" />
        <MetricTile label="Avg velocity 5m" value={Number(overview?.avg_velocity_5m ?? 0).toFixed(1)} />
        <MetricTile label="Max amount z" value={Number(overview?.max_amount_zscore ?? 0).toFixed(1)} tone="warn" />
        <MetricTile label="Max geo km/h" value={Number(overview?.max_geo_kmh ?? 0).toFixed(0)} tone="hot" />
        <MetricTile label="New devices" value={overview?.new_device_count ?? 0} />
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Feature Trends</h2><strong>last 6h</strong></div>
        <div className="chartBox">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trends.map(point => ({
              bucket: new Date(point.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              velocity: Number(point.avg_velocity_5m),
              amountZ: Number(point.avg_abs_amount_zscore),
              geo: Number(point.avg_geo_kmh) / 100,
              newDeviceRate: Number(point.new_device_rate) * 10,
              score: Number(point.avg_score) / 10
            }))}>
              <CartesianGrid stroke="#20313d" vertical={false} />
              <XAxis dataKey="bucket" stroke="#7f96a3" tick={{ fontSize: 11 }} />
              <YAxis stroke="#7f96a3" />
              <Tooltip contentStyle={{ background: "#0c1418", border: "1px solid #27424e" }} />
              <Line type="monotone" dataKey="velocity" stroke="#26c6da" dot={false} />
              <Line type="monotone" dataKey="amountZ" stroke="#f4b44d" dot={false} />
              <Line type="monotone" dataKey="geo" stroke="#ff6b6b" dot={false} />
              <Line type="monotone" dataKey="score" stroke="#8fd14f" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Top Feature Anomalies</h2></div>
        <table>
          <thead><tr><th>Transaction</th><th>Customer</th><th>Merchant</th><th>Velocity</th><th>Amount Z</th><th>Geo</th><th>Device</th><th>Score</th><th>Action</th></tr></thead>
          <tbody>
            {overview?.topAnomalies.map(row => (
              <tr key={row.transaction_id}>
                <td><Link href={`/alerts`}>{row.transaction_id.slice(0, 8)}</Link><small>{row.currency} {Number(row.amount).toFixed(2)}</small></td>
                <td>{row.full_name}</td>
                <td>{row.merchant_name}</td>
                <td>{row.velocity_5m} / 5m<small>{row.velocity_1h} / 1h</small></td>
                <td>{Number(row.amount_zscore).toFixed(2)}</td>
                <td>{Number(row.geo_kmh).toFixed(0)} km/h</td>
                <td><StatusPill value={row.device_seen ? "known" : "new_device"} /></td>
                <td><StatusPill value={row.severity} /><small>{Number(row.score).toFixed(0)}</small></td>
                <td><button className="primary" onClick={() => explain(row.transaction_id)}>Explain</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Feature Explanation</h2><strong>{selected?.transaction.transaction_id?.slice(0, 8) ?? "none"}</strong></div>
        {selected ? (
          <div className="timeline">
            <div className="timelineItem">
              <strong>{selected.transaction.full_name} at {selected.transaction.merchant_name}</strong>
              <span>{selected.recommendation}</span>
            </div>
            {selected.featureCards.map(card => (
              <div className="timelineItem" key={card.feature}>
                <strong>{card.label}</strong>
                <span>{card.severity} - value {Number(card.value).toFixed(2)}</span>
                <p>{card.explanation}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="timelineItem"><strong>No transaction selected</strong><span>Click Explain on an anomaly row to inspect scoring features.</span></div>
        )}
      </section>
    </div>
  );
}
