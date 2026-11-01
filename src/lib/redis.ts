import "dotenv/config";
import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL?.trim() || "redis://localhost:6379";

/**
 * Shared Redis connection. Redis is an optional cache dependency: callers should
 * handle command errors and continue with their primary data source.
 */
export const redis = new Redis(redisUrl, {
  lazyConnect: true,
  connectTimeout: 1_000,
  // A TCP connection can be established while the Redis server/proxy stops replying.
  // Bound every command so optional cache operations cannot hold HTTP requests forever.
  commandTimeout: 500,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: true,
  retryStrategy(times) {
    return Math.min(times * 500, 5_000);
  },
});

redis.on("connect", () => {
  console.info("[Redis] TCP connection established");
});

redis.on("ready", () => {
  console.info("[Redis] Ready to accept commands");
});

redis.on("error", (error) => {
  // Redis is only used as a cache, so connection failures must not take down the API.
  console.warn("[Redis] Connection error:", error.message);
});
