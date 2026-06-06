"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { MetricTile } from "../../components/MetricTile";

type UserProfile = {
  full_name: string;
  email: string;
  risk_tier: string;
  avg_amount: string;
  std_amount: string;
  transaction_count: string;
  alert_count: string;
  entity_risk?: { risk_score: string; velocity_score: string; anomaly_score: string; updated_at: string } | null;
};

export default function UserProfilePage({ params }: { params: { id: string } }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => { apiGet<UserProfile>(`/profiles/users/${params.id}`).then(setProfile); }, [params.id]);
  if (!profile) return <div className="screen">Loading user...</div>;
  return (
    <div className="screen">
      <header className="topbar"><div><p className="eyebrow">User risk history</p><h1>{profile.full_name}</h1></div></header>
      <section className="metricGrid">
        <MetricTile label="Risk tier" value={profile.risk_tier} />
        <MetricTile label="Transactions" value={profile.transaction_count} tone="cool" />
        <MetricTile label="Alerts" value={profile.alert_count} tone="hot" />
        <MetricTile label="Average amount" value={`$${Number(profile.avg_amount).toFixed(2)}`} />
        <MetricTile label="Memory risk" value={Number(profile.entity_risk?.risk_score ?? 0).toFixed(1)} tone="warn" />
      </section>
      <section className="panel formRow">
        <p>{profile.email}</p>
        <p>FraudPulse compares this user's current spend, device, and geo pattern against recent behavior before applying merchant, velocity, and accumulated entity risk memory.</p>
      </section>
    </div>
  );
}
