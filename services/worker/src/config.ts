export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://fraudpulse:fraudpulse@localhost:5432/fraudpulse",
  valkeyUrl: process.env.VALKEY_URL ?? "redis://localhost:6379",
  apiUrl: process.env.API_URL ?? "http://api:4000",
  apiServiceToken: process.env.API_SERVICE_TOKEN ?? "local-service-token",
  metricsPort: Number(process.env.WORKER_METRICS_PORT ?? 4100),
  logLevel: process.env.LOG_LEVEL ?? "info"
};
