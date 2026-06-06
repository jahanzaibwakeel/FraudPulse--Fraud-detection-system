export function MetricTile({ label, value, tone }: { label: string; value: string | number; tone?: "hot" | "cool" | "warn" }) {
  return (
    <section className={`metricTile ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}
