export type RingEntityType = "user" | "card" | "device" | "ip" | "merchant";

export interface SuspiciousTransactionRow extends Record<string, unknown> {
  transaction_id: string;
  user_id: string;
  card_id: string;
  merchant_id: string;
  user_name: string;
  merchant_name: string;
  device_fingerprint: string;
  ip_address: string;
  score: string | number;
  severity: string;
  amount: string | number;
  occurred_at: string;
}

export interface RingNode {
  id: string;
  label: string;
  type: RingEntityType;
  risk: number;
  transactionCount: number;
}

export interface RingEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface FraudRing {
  id: string;
  riskScore: number;
  transactionCount: number;
  alertCount: number;
  strongestSignals: string[];
  nodes: RingNode[];
  edges: RingEdge[];
}

export interface FraudRingGraph {
  generatedAt: string;
  lookbackHours: number;
  rings: FraudRing[];
  nodes: RingNode[];
  edges: RingEdge[];
}

const nodeId = (type: RingEntityType, value: string) => `${type}:${value}`;

const short = (value: string, chars = 12) => value.length > chars ? `${value.slice(0, chars)}...` : value;

export const buildFraudRingGraph = (
  rows: SuspiciousTransactionRow[],
  lookbackHours: number,
  generatedAt = new Date()
): FraudRingGraph => {
  const nodes = new Map<string, RingNode>();
  const edges = new Map<string, RingEdge>();
  const adjacency = new Map<string, Set<string>>();

  const ensureNode = (id: string, label: string, type: RingEntityType, risk: number) => {
    const existing = nodes.get(id);
    if (existing) {
      existing.risk = Math.max(existing.risk, risk);
      existing.transactionCount += 1;
      return existing;
    }
    const node: RingNode = { id, label, type, risk, transactionCount: 1 };
    nodes.set(id, node);
    adjacency.set(id, new Set());
    return node;
  };

  const addEdge = (source: string, target: string, relation: string) => {
    const key = source < target ? `${source}|${target}|${relation}` : `${target}|${source}|${relation}`;
    const existing = edges.get(key);
    if (existing) {
      existing.weight += 1;
    } else {
      edges.set(key, { source, target, relation, weight: 1 });
    }
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  };

  for (const row of rows) {
    const risk = Number(row.score);
    const user = nodeId("user", row.user_id);
    const card = nodeId("card", row.card_id);
    const device = nodeId("device", row.device_fingerprint);
    const ip = nodeId("ip", row.ip_address);
    const merchant = nodeId("merchant", row.merchant_id);

    ensureNode(user, row.user_name, "user", risk);
    ensureNode(card, `Card ${short(row.card_id, 8)}`, "card", risk);
    ensureNode(device, short(row.device_fingerprint, 18), "device", risk);
    ensureNode(ip, row.ip_address, "ip", risk);
    ensureNode(merchant, row.merchant_name, "merchant", risk);

    addEdge(user, card, "owns_card");
    addEdge(card, device, "used_device");
    addEdge(device, ip, "used_ip");
    addEdge(device, merchant, "visited_merchant");
    addEdge(ip, merchant, "routed_to_merchant");
  }

  const seen = new Set<string>();
  const rings: FraudRing[] = [];

  for (const id of nodes.keys()) {
    if (seen.has(id)) continue;
    const queue = [id];
    const component = new Set<string>();
    seen.add(id);
    while (queue.length) {
      const current = queue.shift()!;
      component.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const componentNodes = [...component].map(node => nodes.get(node)!);
    const componentEdges = [...edges.values()].filter(edge => component.has(edge.source) && component.has(edge.target));
    const entityTypes = new Set(componentNodes.map(node => node.type));
    const transactionCount = Math.max(...componentNodes.map(node => node.transactionCount));
    const alertCount = componentNodes.reduce((sum, node) => sum + (node.type === "merchant" ? node.transactionCount : 0), 0);
    const sharedDeviceOrIp = componentNodes.some(node => (node.type === "device" || node.type === "ip") && node.transactionCount >= 2);
    const avgRisk = componentNodes.reduce((sum, node) => sum + node.risk, 0) / Math.max(componentNodes.length, 1);
    const densityBoost = Math.min(18, componentEdges.length * 1.8);
    const riskScore = Math.min(99, Math.round(avgRisk + densityBoost + (sharedDeviceOrIp ? 8 : 0)));
    const strongestSignals = [
      sharedDeviceOrIp ? "shared device or IP" : null,
      entityTypes.has("merchant") ? "merchant convergence" : null,
      transactionCount >= 5 ? "high transaction concentration" : null,
      riskScore >= 85 ? "critical cluster score" : null
    ].filter((value): value is string => Boolean(value));

    if (componentNodes.length >= 4 && componentEdges.length >= 3) {
      rings.push({
        id: `ring-${rings.length + 1}`,
        riskScore,
        transactionCount,
        alertCount,
        strongestSignals,
        nodes: componentNodes.sort((a, b) => b.risk - a.risk),
        edges: componentEdges.sort((a, b) => b.weight - a.weight)
      });
    }
  }

  rings.sort((a, b) => b.riskScore - a.riskScore);

  return {
    generatedAt: generatedAt.toISOString(),
    lookbackHours,
    rings,
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  };
};
