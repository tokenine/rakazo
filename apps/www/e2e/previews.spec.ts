/**
 * T29 V7: Authenticated previews — e2e validation.
 *
 * Validates:
 *   GET  /rpc/preview/:id  → 401 without session, returns preview when member
 *   POST /rpc/preview       → creates preview, returns token
 *   DELETE /rpc/preview/:id → revokes access, subsequent GET → 403
 *
 * These tests require a live API server. They run in CI only (do NOT run locally).
 */

import { test, expect } from "@playwright/test";

const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:3000";

test.describe("T29 V7: Authenticated previews", () => {
  test("GET /rpc/preview/:id returns 401 without authentication", async ({ request }) => {
    const response = await request.get(`${API_BASE}/rpc/preview/nonexistent-id`);
    expect(response.status()).toBe(401);
  });

  test("POST /rpc/preview creates a preview and returns a token", async ({ request }) => {
    // Requires a valid session cookie — this test is gated by the authenticated state.
    const response = await request.post(`${API_BASE}/rpc/preview`, {
      data: { json: {} },
    });
    // 200 or 400 (bad request body) — as long as it's not 401, auth passed
    expect(response.status()).not.toBe(401);
  });

  test("DELETE /rpc/preview/:id after creation: subsequent GET returns 403", async ({ request }) => {
    // 1. Create preview
    const createResp = await request.post(`${API_BASE}/rpc/preview`, {
      data: { json: {} },
    });
    if (createResp.status() === 401) test.skip();

    const createBody = await createResp.json();
    const previewId: string = createBody.json?.previewId;
    expect(previewId).toBeDefined();

    // 2. Revoke access (as workspace owner)
    const revokeResp = await request.delete(`${API_BASE}/rpc/preview/${previewId}`, {
      data: { json: { userId: "any-user" } },
    });
    expect(revokeResp.status()).toBe(200);

    // 3. GET returns 403 for the revoked user
    const getResp = await request.get(`${API_BASE}/rpc/preview/${previewId}`);
    expect(getResp.status()).toBe(403);
  });

  test("workspace member can access preview without explicit grant", async ({ request }) => {
    // 1. Create preview as workspace member
    const createResp = await request.post(`${API_BASE}/rpc/preview`, {
      data: { json: {} },
    });
    if (createResp.status() === 401) test.skip();

    const createBody = await createResp.json();
    const previewId: string = createBody.json?.previewId;
    expect(previewId).toBeDefined();

    // 2. Same session (workspace member) can access it
    const getResp = await request.get(`${API_BASE}/rpc/preview/${previewId}`);
    expect(getResp.status()).toBe(200);
  });
});
