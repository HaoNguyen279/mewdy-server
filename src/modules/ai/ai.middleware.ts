import type { RequestHandler } from "express";
import { redis } from "../../lib/redis.js";
import { getChatAuth } from "../chat/chat.auth.js";
import { AiHttpError } from "./ai.service.js";
import { aiChatRequestSchema } from "./ai.validation.js";

const RATE_LIMIT = 10;
const WINDOW_SECONDS = 60;
const incrementFixedWindowScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

type RedisEvalClient = {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
};

export const validateAiChatRequest: RequestHandler = (req, res, next) => {
  const parsed = aiChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid AI chat request",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  req.body = parsed.data;
  next();
};

export function createAiUserRateLimit(client: RedisEvalClient): RequestHandler {
  return async (_req, res, next) => {
    const { userId } = getChatAuth(res);
    const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `ratelimit:ai:chat:${userId}:${bucket}`;

    try {
      const count = Number(await client.eval(incrementFixedWindowScript, 1, key, WINDOW_SECONDS + 1));
      if (!Number.isFinite(count)) throw new Error("Invalid Redis rate limit result");

      if (count > RATE_LIMIT) {
        res.setHeader("Retry-After", String(WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % WINDOW_SECONDS)));
        res.status(429).json({ success: false, message: "AI request limit exceeded. Try again shortly." });
        return;
      }

      next();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("[AI] Redis rate limit check failed", { errorName });
      next(new AiHttpError(503, "AI service is temporarily unavailable"));
    }
  };
}

export const aiUserRateLimit = createAiUserRateLimit(redis);
