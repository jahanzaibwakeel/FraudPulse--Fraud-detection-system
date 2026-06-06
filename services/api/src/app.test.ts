import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("./db.js", () => ({
  query: vi.fn(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 }))
}));

vi.mock("./queue.js", () => ({
  scoringQueue: { add: vi.fn(), getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, failed: 0, delayed: 0 })) }
}));

import { createApp } from "./app.js";

describe("api health", () => {
  it("returns healthy status", async () => {
    const { app } = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("requires authentication for operational routes", async () => {
    const { app } = createApp();
    const res = await request(app).get("/alerts");
    expect(res.status).toBe(401);
  });

  it("exposes the authenticated local session", async () => {
    const { app } = createApp();
    const res = await request(app).get("/security/session").set("x-api-token", "local-admin-token");
    expect(res.status).toBe(200);
    expect(res.body.actor).toBe("lead.ops");
    expect(res.body.role).toBe("admin");
    expect(res.body.authMethod).toBe("api_token");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("creates an expiring local session from an API token", async () => {
    const { app } = createApp();
    const login = await request(app).post("/security/sessions").set("x-api-token", "local-admin-token").send({});
    expect(login.status).toBe(201);
    expect(login.body.sessionToken).toMatch(/^fp_session_/);

    const session = await request(app).get("/security/session").set("authorization", `Bearer ${login.body.sessionToken}`);
    expect(session.status).toBe(200);
    expect(session.body.actor).toBe("lead.ops");
    expect(session.body.authMethod).toBe("session");
  });

  it("blocks viewer tokens from admin mutations", async () => {
    const { app } = createApp();
    const res = await request(app)
      .patch("/rules/velocity_5m")
      .set("x-api-token", "local-viewer-token")
      .send({ weight: 30 });
    expect(res.status).toBe(403);
  });

  it("exposes security status without leaking raw API tokens", async () => {
    const { app } = createApp();
    const res = await request(app).get("/security/status").set("x-api-token", "local-admin-token");
    expect(res.status).toBe(200);
    expect(res.body.tokenCount).toBeGreaterThan(0);
    expect(res.body.tokenFingerprints[0].fingerprint).toHaveLength(12);
    expect(JSON.stringify(res.body)).not.toContain("local-admin-token");
  });
});
