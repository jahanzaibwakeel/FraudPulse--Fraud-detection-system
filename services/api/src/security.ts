import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Socket } from "socket.io";

export type Role = "viewer" | "analyst" | "admin" | "service";
type AuthMethod = "api_token" | "session" | "disabled";

export type AuthPrincipal = {
  actor: string;
  role: Role;
  tokenLabel: string;
  authMethod: AuthMethod;
  sessionId?: string;
  expiresAt?: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPrincipal;
      requestId?: string;
    }
  }
}

type SecurityConfig = {
  authEnabled: boolean;
  apiTokens: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  sessionTtlMs: number;
  authFailureWindowMs: number;
  authFailureMaxAttempts: number;
  authLockoutMs: number;
};

type Credential = Omit<AuthPrincipal, "authMethod"> & {
  tokenHash: string;
  tokenFingerprint: string;
};

type SessionRecord = {
  tokenHash: string;
  tokenFingerprint: string;
  createdAt: number;
  expiresAt: number;
  principal: AuthPrincipal;
};

type Bucket = { count: number; resetAt: number; actor: string };
type FailureBucket = { count: number; resetAt: number; lockedUntil?: number; fingerprint: string };
type SecurityEvent = {
  id: string;
  type: string;
  actor: string;
  role?: Role | "unknown";
  fingerprint?: string;
  ip?: string;
  requestId?: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

const roleRank: Record<Role, number> = {
  viewer: 1,
  analyst: 2,
  admin: 3,
  service: 4
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const tokenFingerprint = (value: string) => sha256(value).slice(0, 12);

const safeHashEquals = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const parseCredentials = (value: string) =>
  value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map((item, index): Credential => {
      const [token, actor, role] = item.split(":");
      if (!token || !actor || !["viewer", "analyst", "admin", "service"].includes(role)) {
        throw new Error(`invalid_api_token_config:${index}`);
      }
      return {
        actor,
        role: role as Role,
        tokenLabel: `${actor}:${role}`,
        tokenHash: sha256(token),
        tokenFingerprint: tokenFingerprint(token)
      };
    });

const tokenFromRequest = (req: Request) => {
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer ?? req.header("x-session-token") ?? req.header("x-api-token") ?? null;
};

const tokenFromSocket = (socket: Socket) => {
  const authToken = socket.handshake.auth?.token;
  const sessionToken = socket.handshake.headers["x-session-token"];
  const headerToken = socket.handshake.headers["x-api-token"];
  if (typeof authToken === "string") return authToken;
  if (typeof sessionToken === "string") return sessionToken;
  if (typeof headerToken === "string") return headerToken;
  return null;
};

const publicPrincipal = (): AuthPrincipal => ({
  actor: "auth.disabled",
  role: "service",
  tokenLabel: "disabled",
  authMethod: "disabled"
});

export const createSecurity = (config: SecurityConfig) => {
  const credentials = parseCredentials(config.apiTokens);
  const buckets = new Map<string, Bucket>();
  const failures = new Map<string, FailureBucket>();
  const sessions = new Map<string, SessionRecord>();
  const events: SecurityEvent[] = [];

  const recordEvent = (event: Omit<SecurityEvent, "id" | "createdAt">) => {
    events.unshift({ id: randomUUID(), createdAt: new Date().toISOString(), ...event });
    if (events.length > 200) events.length = 200;
  };

  const failureKey = (token: string | null, ip: string | undefined) =>
    `${ip ?? "unknown"}:${token ? tokenFingerprint(token) : "missing"}`;

  const noteFailure = (token: string | null, req: Request | undefined, type: string) => {
    const now = Date.now();
    const key = failureKey(token, req?.ip);
    const current = failures.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + config.authFailureWindowMs, fingerprint: token ? tokenFingerprint(token) : "missing" };
    bucket.count += 1;
    if (bucket.count >= config.authFailureMaxAttempts) bucket.lockedUntil = now + config.authLockoutMs;
    failures.set(key, bucket);
    recordEvent({
      type: bucket.lockedUntil && bucket.lockedUntil > now ? "auth_lockout" : type,
      actor: "unknown",
      role: "unknown",
      fingerprint: bucket.fingerprint,
      ip: req?.ip,
      requestId: req?.requestId,
      detail: {
        attempts: bucket.count,
        resetAt: new Date(bucket.resetAt).toISOString(),
        lockedUntil: bucket.lockedUntil ? new Date(bucket.lockedUntil).toISOString() : null
      }
    });
  };

  const clearFailure = (token: string | null, req: Request | undefined) => {
    failures.delete(failureKey(token, req?.ip));
  };

  const lockoutFor = (token: string | null, req: Request | undefined) => {
    const current = failures.get(failureKey(token, req?.ip));
    if (!current?.lockedUntil) return null;
    if (current.lockedUntil <= Date.now()) {
      current.lockedUntil = undefined;
      return null;
    }
    return current.lockedUntil;
  };

  const authenticateToken = (token: string | null, req?: Request, recordFailures = true): AuthPrincipal | null => {
    if (!config.authEnabled) return publicPrincipal();
    const lockedUntil = lockoutFor(token, req);
    if (lockedUntil) {
      if (recordFailures) noteFailure(token, req, "auth_lockout");
      return null;
    }
    if (!token) {
      if (recordFailures) noteFailure(token, req, "missing_token");
      return null;
    }

    const hash = sha256(token);
    const credential = credentials.find(item => safeHashEquals(item.tokenHash, hash));
    if (credential) {
      clearFailure(token, req);
      return {
        actor: credential.actor,
        role: credential.role,
        tokenLabel: credential.tokenLabel,
        authMethod: "api_token"
      };
    }

    const session = sessions.get(hash);
    if (session) {
      if (session.expiresAt <= Date.now()) {
        sessions.delete(hash);
        if (recordFailures) noteFailure(token, req, "expired_session");
        return null;
      }
      clearFailure(token, req);
      return {
        ...session.principal,
        authMethod: "session",
        expiresAt: new Date(session.expiresAt).toISOString()
      };
    }

    if (recordFailures) noteFailure(token, req, "invalid_token");
    return null;
  };

  const requestId = (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header("x-request-id");
    req.requestId = incoming && /^[a-zA-Z0-9._:-]{8,80}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  };

  const requireAuth = (minimumRole: Role = "viewer") => (req: Request, res: Response, next: NextFunction) => {
    const token = tokenFromRequest(req);
    const principal = authenticateToken(token, req);
    if (!principal) {
      const lockedUntil = lockoutFor(token, req);
      res.setHeader("WWW-Authenticate", "Bearer");
      return res.status(lockedUntil ? 423 : 401).json({
        error: lockedUntil ? "auth_locked" : "authentication_required",
        requestId: req.requestId,
        lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : undefined
      });
    }
    if (roleRank[principal.role] < roleRank[minimumRole]) {
      recordEvent({
        type: "authorization_denied",
        actor: principal.actor,
        role: principal.role,
        ip: req.ip,
        requestId: req.requestId,
        detail: { requiredRole: minimumRole, path: req.path, method: req.method }
      });
      return res.status(403).json({ error: "insufficient_role", requiredRole: minimumRole, requestId: req.requestId });
    }
    req.auth = principal;
    next();
  };

  const authenticateSocket = (socket: Socket, next: (err?: Error) => void) => {
    const principal = authenticateToken(tokenFromSocket(socket), undefined);
    if (!principal) return next(new Error("authentication_required"));
    socket.data.auth = principal;
    next();
  };

  const rateLimit = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const token = tokenFromRequest(req) ?? "anonymous";
    const principal = authenticateToken(token === "anonymous" ? null : token, req, false);
    const key = `${req.ip}:${tokenFingerprint(token)}`;
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + config.rateLimitWindowMs, actor: principal?.actor ?? "anonymous" };
    bucket.count += 1;
    bucket.actor = principal?.actor ?? bucket.actor;
    buckets.set(key, bucket);
    res.setHeader("RateLimit-Limit", String(config.rateLimitMaxRequests));
    res.setHeader("RateLimit-Remaining", String(Math.max(config.rateLimitMaxRequests - bucket.count, 0)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > config.rateLimitMaxRequests) {
      recordEvent({
        type: "rate_limit_exceeded",
        actor: bucket.actor,
        ip: req.ip,
        requestId: req.requestId,
        detail: { count: bucket.count, resetAt: new Date(bucket.resetAt).toISOString() }
      });
      return res.status(429).json({ error: "rate_limit_exceeded", resetAt: new Date(bucket.resetAt).toISOString(), requestId: req.requestId });
    }
    next();
  };

  const createSession = (req: Request, res: Response) => {
    const token = tokenFromRequest(req);
    const principal = authenticateToken(token, req);
    if (!principal || principal.authMethod !== "api_token") {
      return res.status(401).json({ error: "api_token_required", requestId: req.requestId });
    }
    const sessionId = randomUUID();
    const sessionToken = `fp_session_${randomBytes(32).toString("base64url")}`;
    const now = Date.now();
    const expiresAt = now + config.sessionTtlMs;
    const sessionPrincipal: AuthPrincipal = {
      actor: principal.actor,
      role: principal.role,
      tokenLabel: principal.tokenLabel,
      authMethod: "session",
      sessionId,
      expiresAt: new Date(expiresAt).toISOString()
    };
    sessions.set(sha256(sessionToken), {
      tokenHash: sha256(sessionToken),
      tokenFingerprint: tokenFingerprint(sessionToken),
      createdAt: now,
      expiresAt,
      principal: sessionPrincipal
    });
    recordEvent({
      type: "session_created",
      actor: principal.actor,
      role: principal.role,
      fingerprint: tokenFingerprint(sessionToken),
      ip: req.ip,
      requestId: req.requestId,
      detail: { sessionId, expiresAt: new Date(expiresAt).toISOString() }
    });
    res.status(201).json({ sessionToken, expiresAt: new Date(expiresAt).toISOString(), principal: sessionPrincipal });
  };

  const revokeCurrentSession = (req: Request, res: Response) => {
    const token = tokenFromRequest(req);
    const hash = token ? sha256(token) : null;
    const session = hash ? sessions.get(hash) : null;
    if (hash && session) sessions.delete(hash);
    recordEvent({
      type: "session_revoked",
      actor: req.auth?.actor ?? "unknown",
      role: req.auth?.role ?? "unknown",
      fingerprint: token ? tokenFingerprint(token) : "missing",
      ip: req.ip,
      requestId: req.requestId,
      detail: { sessionId: session?.principal.sessionId ?? null }
    });
    res.json({ revoked: Boolean(session), requestId: req.requestId });
  };

  const session = (req: Request) => ({
    authEnabled: config.authEnabled,
    actor: req.auth?.actor ?? "anonymous",
    role: req.auth?.role ?? "none",
    tokenLabel: req.auth?.tokenLabel ?? "none",
    authMethod: req.auth?.authMethod ?? "none",
    sessionId: req.auth?.sessionId ?? null,
    expiresAt: req.auth?.expiresAt ?? null,
    requestId: req.requestId
  });

  const rateLimitSnapshot = () => {
    const now = Date.now();
    return {
      windowMs: config.rateLimitWindowMs,
      maxRequests: config.rateLimitMaxRequests,
      buckets: [...buckets.entries()]
        .filter(([, bucket]) => bucket.resetAt > now)
        .slice(0, 25)
        .map(([key, bucket], index) => ({
          key: `${bucket.actor}:${index + 1}:${key.length}`,
          actor: bucket.actor,
          count: bucket.count,
          resetAt: new Date(bucket.resetAt).toISOString()
        }))
    };
  };

  const securitySnapshot = () => {
    const now = Date.now();
    return {
      generatedAt: new Date().toISOString(),
      tokenCount: credentials.length,
      tokenFingerprints: credentials.map(item => ({ actor: item.actor, role: item.role, fingerprint: item.tokenFingerprint })),
      activeSessions: [...sessions.values()]
        .filter(item => item.expiresAt > now)
        .map(item => ({
          sessionId: item.principal.sessionId,
          actor: item.principal.actor,
          role: item.principal.role,
          fingerprint: item.tokenFingerprint,
          createdAt: new Date(item.createdAt).toISOString(),
          expiresAt: new Date(item.expiresAt).toISOString()
        })),
      lockedPrincipals: [...failures.values()]
        .filter(item => item.lockedUntil && item.lockedUntil > now)
        .map(item => ({
          fingerprint: item.fingerprint,
          attempts: item.count,
          lockedUntil: new Date(item.lockedUntil as number).toISOString()
        })),
      policies: {
        authEnabled: config.authEnabled,
        sessionTtlMs: config.sessionTtlMs,
        authFailureWindowMs: config.authFailureWindowMs,
        authFailureMaxAttempts: config.authFailureMaxAttempts,
        authLockoutMs: config.authLockoutMs
      }
    };
  };

  const securityEvents = (limit = 100) => events.slice(0, Math.min(limit, 200));

  const tokenRotationPlan = (actor: string) => {
    const generatedAt = new Date().toISOString();
    const replacements = credentials.map(credential => {
      const token = `fp_${credential.role}_${randomBytes(24).toString("base64url")}`;
      return {
        actor: credential.actor,
        role: credential.role,
        oldFingerprint: credential.tokenFingerprint,
        newFingerprint: tokenFingerprint(token),
        replacement: `${token}:${credential.actor}:${credential.role}`
      };
    });
    recordEvent({
      type: "token_rotation_plan_created",
      actor,
      role: "admin",
      detail: { generatedAt, replacementCount: replacements.length }
    });
    return {
      generatedAt,
      createdBy: actor,
      applyByUpdating: ["API_TOKENS", "NEXT_PUBLIC_API_TOKEN", "API_SERVICE_TOKEN"],
      replacements,
      note: "Generated locally only. Update .env, restart Docker Compose, and discard this plan after rotation."
    };
  };

  return {
    authenticateSocket,
    createSession,
    rateLimit,
    rateLimitSnapshot,
    requestId,
    requireAuth,
    revokeCurrentSession,
    securityEvents,
    securitySnapshot,
    session,
    tokenRotationPlan
  };
};
