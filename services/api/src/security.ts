import type { NextFunction, Request, Response } from "express";
import type { Socket } from "socket.io";

export type Role = "viewer" | "analyst" | "admin" | "service";

export type AuthPrincipal = {
  actor: string;
  role: Role;
  tokenLabel: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPrincipal;
    }
  }
}

type SecurityConfig = {
  authEnabled: boolean;
  apiTokens: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
};

type Credential = AuthPrincipal & { token: string };
type Bucket = { count: number; resetAt: number; actor: string };

const roleRank: Record<Role, number> = {
  viewer: 1,
  analyst: 2,
  admin: 3,
  service: 4
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
      return { token, actor, role: role as Role, tokenLabel: `${actor}:${role}` };
    });

const tokenFromRequest = (req: Request) => {
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer ?? req.header("x-api-token") ?? null;
};

const tokenFromSocket = (socket: Socket) => {
  const authToken = socket.handshake.auth?.token;
  const headerToken = socket.handshake.headers["x-api-token"];
  if (typeof authToken === "string") return authToken;
  if (typeof headerToken === "string") return headerToken;
  return null;
};

export const createSecurity = (config: SecurityConfig) => {
  const credentials = parseCredentials(config.apiTokens);
  const buckets = new Map<string, Bucket>();

  const authenticateToken = (token: string | null): AuthPrincipal | null => {
    if (!config.authEnabled) return { actor: "auth.disabled", role: "service", tokenLabel: "disabled" };
    const credential = credentials.find(item => item.token === token);
    if (!credential) return null;
    const { token: _token, ...principal } = credential;
    return principal;
  };

  const requireAuth = (minimumRole: Role = "viewer") => (req: Request, res: Response, next: NextFunction) => {
    const principal = authenticateToken(tokenFromRequest(req));
    if (!principal) return res.status(401).json({ error: "authentication_required" });
    if (roleRank[principal.role] < roleRank[minimumRole]) {
      return res.status(403).json({ error: "insufficient_role", requiredRole: minimumRole });
    }
    req.auth = principal;
    next();
  };

  const authenticateSocket = (socket: Socket, next: (err?: Error) => void) => {
    const principal = authenticateToken(tokenFromSocket(socket));
    if (!principal) return next(new Error("authentication_required"));
    socket.data.auth = principal;
    next();
  };

  const rateLimit = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const token = tokenFromRequest(req) ?? "anonymous";
    const principal = authenticateToken(token === "anonymous" ? null : token);
    const key = `${req.ip}:${token}`;
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
      return res.status(429).json({ error: "rate_limit_exceeded", resetAt: new Date(bucket.resetAt).toISOString() });
    }
    next();
  };

  const session = (req: Request) => ({
    authEnabled: config.authEnabled,
    actor: req.auth?.actor ?? "anonymous",
    role: req.auth?.role ?? "none",
    tokenLabel: req.auth?.tokenLabel ?? "none"
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

  return { authenticateSocket, requireAuth, rateLimit, session, rateLimitSnapshot };
};
