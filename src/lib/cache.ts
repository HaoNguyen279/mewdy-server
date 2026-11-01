import { redis } from "./redis.js";

export class CacheService {
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError("Cache TTL must be a positive integer number of seconds");
    }

    try {
      const cached = await redis.get(key);
      if (cached !== null) {
        try {
          return JSON.parse(cached) as T;
        } catch {
          // Treat malformed or outdated cache values as misses.
          void redis.del(key).catch((error) => {
            console.warn("[Cache] Redis delete failed:", getErrorMessage(error));
          });
        }
      }
    } catch (error) {
      console.warn("[Cache] Redis read failed; loading fresh data:", getErrorMessage(error));
    }

    const freshData = await fetcher();
    if (freshData === null || freshData === undefined) return freshData;

    try {
      const serialized = JSON.stringify(freshData);
      if (serialized !== undefined) {
        // Cache writes are best-effort and must not delay a successful database response.
        void redis.set(key, serialized, "EX", ttlSeconds).catch((error) => {
          console.warn("[Cache] Redis write failed:", getErrorMessage(error));
        });
      }
    } catch (error) {
      console.warn("[Cache] Redis serialization failed:", getErrorMessage(error));
    }

    return freshData;
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await redis.del(...keys);
    } catch (error) {
      console.warn("[Cache] Redis delete failed:", getErrorMessage(error));
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    let cursor = "0";
    try {
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        if (keys.length > 0) await redis.del(...keys);
        cursor = nextCursor;
      } while (cursor !== "0");
    } catch (error) {
      console.warn("[Cache] Redis pattern delete failed:", getErrorMessage(error));
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const cacheService = new CacheService();
