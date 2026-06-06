"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { MetricTile } from "../../components/MetricTile";

type MerchantProfile = {
  name: string;
  category: string;
  country: string;
  risk_score: number;
  transaction_count: string;
  alert_count: string;
  avg_score: string;
  entity_risk?: { risk_score: string; velocity_score: string; anomaly_score: string; updated_at: string } | null;
};

export default function MerchantProfilePage({ params }: { params: { id: string } }) {
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  useEffect(() => { apiGet<MerchantProfile>(`/profiles/merchants/${params.id}`).then(setProfile); }, [params.id]);
  if (!profile) return <div className="screen">Loading merchant...</div>;
  return (
    <div className="screen">
      <header className="topbar"><div><p className="eyebrow">Merchant risk analysis</p><h1>{profile.name}</h1></div></header>
      <section className="metricGrid">
        <MetricTile label="Category" value={profile.category} />
        <MetricTile label="Country" value={profile.country} />
        <MetricTile label="Merchant risk" value={profile.risk_score} tone="warn" />
        <MetricTile label="Alerts" value={profile.alert_count} tone="hot" />
        <MetricTile label="Memory risk" value={Number(profile.entity_risk?.risk_score ?? 0).toFixed(1)} />
      </section>
      <section className="panel formRow">
        <p>Merchant profile risk is blended with transaction-level behavior and accumulated entity memory to avoid treating merchant category alone as proof of fraud.</p>
      </section>
    </div>
  );
}
