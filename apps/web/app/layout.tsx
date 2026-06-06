import type { Metadata } from "next";
import { Activity, Bell, BriefcaseBusiness, Database, FlaskConical, Gauge, LockKeyhole, Network, RadioTower, ShieldAlert, ShieldCheck, SlidersHorizontal, Target, Trophy } from "lucide-react";
import Link from "next/link";
import "./styles.css";

export const metadata: Metadata = {
  title: "FraudPulse Risk Operations",
  description: "Real-time local fraud detection dashboard"
};

const nav = [
  { href: "/", label: "Live Monitor", icon: RadioTower },
  { href: "/alerts", label: "Alert Center", icon: Bell },
  { href: "/operations", label: "Operations", icon: BriefcaseBusiness },
  { href: "/simulation", label: "Simulation Lab", icon: FlaskConical },
  { href: "/rings", label: "Ring Graph", icon: Network },
  { href: "/features", label: "Feature Store", icon: Database },
  { href: "/risk", label: "Risk Memory", icon: Target },
  { href: "/quality", label: "Data Quality", icon: ShieldAlert },
  { href: "/performance", label: "Model Metrics", icon: Gauge },
  { href: "/models", label: "Model Registry", icon: Trophy },
  { href: "/metrics", label: "System Metrics", icon: Activity },
  { href: "/security", label: "Security", icon: LockKeyhole },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal }
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="rail">
            <Link href="/" className="brand" aria-label="FraudPulse home">
              <span className="brandMark"><ShieldCheck size={22} /></span>
              <span>
                <strong>FraudPulse</strong>
                <small>Risk operations</small>
              </span>
            </Link>
            <nav>
              {nav.map(item => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="navItem">
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
          <main className="workspace">{children}</main>
        </div>
      </body>
    </html>
  );
}
