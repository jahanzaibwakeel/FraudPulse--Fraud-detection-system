export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://fraudpulse:fraudpulse@localhost:5432/fraudpulse",
  valkeyUrl: process.env.VALKEY_URL ?? "redis://localhost:6379",
  logLevel: process.env.LOG_LEVEL ?? "info",
  authEnabled: process.env.AUTH_ENABLED !== "false",
  apiTokens:
    process.env.API_TOKENS ??
    "local-viewer-token:viewer.demo:viewer,local-analyst-token:casey.ops:analyst,local-admin-token:lead.ops:admin,local-service-token:pipeline.service:service",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 900)
};
