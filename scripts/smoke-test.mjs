const apiUrl = process.env.SMOKE_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:14000";
const webUrl = process.env.SMOKE_WEB_URL ?? "http://127.0.0.1:13000";
const apiToken = process.env.SMOKE_API_TOKEN ?? process.env.NEXT_PUBLIC_API_TOKEN ?? "local-admin-token";

const checks = [];

const check = async (name, run) => {
  const started = Date.now();
  try {
    const detail = await run();
    checks.push({ name, ok: true, ms: Date.now() - started, detail });
  } catch (error) {
    checks.push({ name, ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message : String(error) });
  }
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${apiUrl}${path}`, options);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return { response, body: await response.json() };
};

await check("api health", async () => {
  const { body } = await fetchJson("/health");
  if (body.status !== "ok") throw new Error(`unexpected health status ${body.status}`);
  return body.service;
});

await check("authenticated session", async () => {
  const { response, body } = await fetchJson("/security/session", { headers: { Authorization: `Bearer ${apiToken}` } });
  const requestId = response.headers.get("x-request-id");
  if (!requestId) throw new Error("missing x-request-id header");
  if (body.role !== "admin") throw new Error(`expected admin role, received ${body.role}`);
  return `${body.actor}:${body.authMethod}`;
});

await check("dashboard overview", async () => {
  const { body } = await fetchJson("/admin/overview", { headers: { Authorization: `Bearer ${apiToken}` } });
  if (!body.queue) throw new Error("missing queue summary");
  return `queue waiting=${body.queue.waiting}`;
});

await check("web dashboard", async () => {
  const response = await fetch(webUrl);
  if (!response.ok) throw new Error(`web returned ${response.status}`);
  const html = await response.text();
  if (!html.includes("FraudPulse")) throw new Error("dashboard html missing FraudPulse marker");
  return response.headers.get("content-type") ?? "html";
});

const failed = checks.filter(item => !item.ok);
for (const item of checks) {
  const marker = item.ok ? "PASS" : "FAIL";
  console.log(`${marker} ${item.name} (${item.ms}ms) ${item.detail}`);
}

if (failed.length) {
  console.error(`${failed.length} smoke check(s) failed`);
  process.exit(1);
}
