import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { requireChatAuth } from "../chat/chat.auth.js";
import { createAiUserRateLimit, validateAiChatRequest } from "./ai.middleware.js";

function responseMock() {
  const response = {
    locals: {} as Record<string, unknown>,
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return response;
}

test("AI chat rejects missing authentication", async () => {
  const res = responseMock();
  let continued = false;
  await requireChatAuth(
    { headers: {} } as Request,
    res as unknown as Response,
    () => { continued = true; },
  );
  assert.equal(res.statusCode, 401);
  assert.equal(continued, false);
});

test("AI validation middleware rejects empty and overlong messages", () => {
  for (const message of ["   ", "x".repeat(2001)]) {
    const req = { body: { message } } as Request;
    const res = responseMock();
    let continued = false;
    validateAiChatRequest(req, res as unknown as Response, () => { continued = true; });
    assert.equal(res.statusCode, 400);
    assert.equal(continued, false);
  }
});

test("AI rate limit is keyed by authenticated user ID and returns 429", async () => {
  let redisKey = "";
  const middleware = createAiUserRateLimit({
    eval: async (_script, _numberOfKeys, key) => {
      redisKey = String(key);
      return 11;
    },
  });
  const res = responseMock();
  res.locals.chatAuth = { userId: "user-123", firebaseUid: "firebase-123" };
  let continued = false;

  await middleware({} as Request, res as unknown as Response, () => { continued = true; });
  assert.match(redisKey, /user-123/);
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers["Retry-After"]);
  assert.equal(continued, false);
});

test("AI rate limiter fails closed when Redis is unavailable", async () => {
  const middleware = createAiUserRateLimit({ eval: async () => { throw new Error("private redis detail"); } });
  const res = responseMock();
  res.locals.chatAuth = { userId: "user-123", firebaseUid: "firebase-123" };
  let forwarded: unknown;

  await middleware({} as Request, res as unknown as Response, (error?: unknown) => { forwarded = error; });
  assert.equal((forwarded as { statusCode: number }).statusCode, 503);
  assert.equal((forwarded as Error).message, "AI service is temporarily unavailable");
});
