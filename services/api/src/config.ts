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
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:13000,http://127.0.0.1:13000")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 900),
  sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 8 * 60 * 60 * 1000),
  authFailureWindowMs: Number(process.env.AUTH_FAILURE_WINDOW_MS ?? 5 * 60 * 1000),
  authFailureMaxAttempts: Number(process.env.AUTH_FAILURE_MAX_ATTEMPTS ?? 8),
  authLockoutMs: Number(process.env.AUTH_LOCKOUT_MS ?? 10 * 60 * 1000)
};
