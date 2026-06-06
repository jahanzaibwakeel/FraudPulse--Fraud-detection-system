"use client";

import { useEffect, useMemo, useState } from "react";
import { Network, RefreshCw } from "lucide-react";
import { apiGet } from "../lib/api";
import { MetricTile } from "../components/MetricTile";

type RingNode = {
  id: string;
  label: string;
  type: "user" | "card" | "device" | "ip" | "merchant";
  risk: number;
  transactionCount: number;
};

type RingEdge = {
  source: string;
  target: string;
  relation: string;
  weight: number;
};

type FraudRing = {
  id: string;
  riskScore: number;
  transactionCount: number;
  alertCount: number;
  strongestSignals: string[];
  nodes: RingNode[];
  edges: RingEdge[];
};

type RingGraph = {
  generatedAt: string;
  lookbackHours: number;
  rings: FraudRing[];
  nodes: RingNode[];
  edges: RingEdge[];
};

const positions = [
  [50, 8],
  [82, 24],
  [78, 68],
  [50, 88],
  [18, 68],
  [16, 24],
  [50, 48],
  [70, 46],
  [30, 46]
];

export default function RingsPage() {
  const [graph, setGraph] = useState<RingGraph | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = async () => {
    const next = await apiGet<RingGraph>("/graph/rings?lookbackHours=24&minScore=55");
    setGraph(next);
    setSelectedId(current => current ?? next.rings[0]?.id ?? null);
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, []);

  const selected = useMemo(
    () => graph?.rings.find(ring => ring.id === selectedId) ?? graph?.rings[0] ?? null,
    [graph, selectedId]
  );

  const topShared = selected?.nodes.filter(node => node.transactionCount > 1).slice(0, 6) ?? [];
  const nodePosition = (node: RingNode, index: number) => {
    const point = positions[index % positions.length];
    return { ...node, x: point[0], y: point[1] };
  };
  const visualNodes = selected?.nodes.slice(0, 9).map(nodePosition) ?? [];

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Connected entity intelligence</p>
          <h1>Fraud Ring Graph</h1>
        </div>
        <button className="iconButton" onClick={refresh} title="Refresh graph">
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="metricGrid">
        <MetricTile label="Detected rings" value={graph?.rings.length ?? 0} tone="hot" />
        <MetricTile label="Graph nodes" value={graph?.nodes.length ?? 0} tone="cool" />
        <MetricTile label="Graph edges" value={graph?.edges.length ?? 0} />
        <MetricTile label="Top ring risk" value={graph?.rings[0]?.riskScore ?? 0} tone="warn" />
        <MetricTile label="Lookback" value={`${graph?.lookbackHours ?? 24}h`} />
      </section>

      <section className="ringLayout">
        <aside className="panel">
          <div className="panelHeader"><h2>Clusters</h2><Network size={18} /></div>
          <div className="ringList">
            {graph?.rings.map(ring => (
              <button
                className={ring.id === selected?.id ? "ringListItem active" : "ringListItem"}
                key={ring.id}
                onClick={() => setSelectedId(ring.id)}
              >
                <strong>{ring.id}</strong>
                <span>Risk {ring.riskScore} · {ring.transactionCount} tx · {ring.nodes.length} entities</span>
                <small>{ring.strongestSignals.join(" / ") || "connected suspicious entities"}</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="panel">
          <div className="panelHeader">
            <h2>{selected ? `${selected.id} Entity Graph` : "No Rings Detected"}</h2>
            <strong>{selected ? `${selected.riskScore}/100` : ""}</strong>
          </div>
          <div className="graphCanvas">
            {selected && visualNodes.map((node, index) => {
              const links = selected.edges
                .filter(edge => edge.source === node.id || edge.target === node.id)
                .map(edge => edge.source === node.id ? edge.target : edge.source);
              return visualNodes
                .filter(target => links.includes(target.id))
                .map(target => (
                  <span
                    className="graphEdge"
                    key={`${node.id}-${target.id}-${index}`}
                    style={{
                      left: `${Math.min(node.x, target.x)}%`,
                      top: `${Math.min(node.y, target.y)}%`,
                      width: `${Math.abs(node.x - target.x)}%`,
                      height: `${Math.abs(node.y - target.y)}%`
                    }}
                  />
                ));
            })}
            {visualNodes.map(node => (
              <div className={`graphNode ${node.type}`} key={node.id} style={{ left: `${node.x}%`, top: `${node.y}%` }}>
                <strong>{node.label}</strong>
                <span>{node.type} · {Math.round(node.risk)}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="panel">
          <div className="panelHeader"><h2>Shared Signals</h2></div>
          <div className="timeline">
            {topShared.map(node => (
              <div className="timelineItem" key={node.id}>
                <strong>{node.label}</strong>
                <span>{node.type} reused across {node.transactionCount} suspicious transactions</span>
              </div>
            ))}
            {selected?.edges.slice(0, 8).map(edge => (
              <div className="timelineItem" key={`${edge.source}-${edge.target}-${edge.relation}`}>
                <strong>{edge.relation.replaceAll("_", " ")}</strong>
                <span>{edge.weight} linked events</span>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
