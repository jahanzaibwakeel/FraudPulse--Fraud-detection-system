export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:14000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:14000";
export const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? "local-admin-token";

const sessionTokenKey = "fraudpulse.sessionToken";

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

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: authHeaders() });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.json() as Promise<T>;
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
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.json() as Promise<T>;
}
