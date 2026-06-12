export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:14000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:14000";
export const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? "local-admin-token";
export const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS ?? 10000);

const sessionTokenKey = "fraudpulse.sessionToken";
const cachePrefix = "fraudpulse.api.";
const memoryCache = new Map<string, { at: number; data: unknown }>();

export const getAuthToken = () => {
  if (typeof window === "undefined") return API_TOKEN;
  return window.sessionStorage.getItem(sessionTokenKey) ?? API_TOKEN;
};

export const setSessionToken = (token: string) => {
  if (typeof window !== "undefined") window.sessionStorage.setItem(sessionTokenKey, token);
};

export const clearSessionToken = () => {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(sessionTokenKey);
};

const authHeaders = () => ({ Authorization: `Bearer ${getAuthToken()}` });

const cacheKey = (path: string) => `${cachePrefix}${path}`;

const readCacheEntry = <T>(path: string): { at: number; data: T } | null => {
  const memory = memoryCache.get(path);
  if (memory) return memory as { at: number; data: T };
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(cacheKey(path));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at: number; data: T };
    memoryCache.set(path, parsed);
    return parsed;
  } catch {
    window.sessionStorage.removeItem(cacheKey(path));
    return null;
  }
};

const writeCache = (path: string, data: unknown) => {
  const entry = { at: Date.now(), data };
  memoryCache.set(path, entry);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(cacheKey(path), JSON.stringify(entry));
  }
};

const clearApiCache = () => {
  memoryCache.clear();
  if (typeof window === "undefined") return;
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(cachePrefix)) window.sessionStorage.removeItem(key);
  }
};

const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: authHeaders() });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  const data = await response.json() as T;
  writeCache(path, data);
  return data;
};

export async function apiGet<T>(path: string): Promise<T> {
  const cached = readCacheEntry<T>(path);
  if (cached) {
    if (Date.now() - cached.at >= REFRESH_MS) {
      void fetchJson<T>(path).catch(() => undefined);
    }
    return cached.data;
  }
  return fetchJson<T>(path);
}

export async function apiText(path: string): Promise<string> {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: authHeaders() });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.text();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  clearApiCache();
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  clearApiCache();
  return response.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  clearApiCache();
  return response.json() as Promise<T>;
}
