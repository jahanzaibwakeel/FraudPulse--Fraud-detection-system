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
  });

  it("blocks viewer tokens from admin mutations", async () => {
    const { app } = createApp();
    const res = await request(app)
      .patch("/rules/velocity_5m")
      .set("x-api-token", "local-viewer-token")
      .send({ weight: 30 });
    expect(res.status).toBe(403);
  });
});
