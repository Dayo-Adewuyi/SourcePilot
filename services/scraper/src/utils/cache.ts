import type { Redis } from "ioredis";

const memory = new Map<string, { expiresAt: number; value: string }>();

export class Cache {
  constructor(private redis?: Redis, private ttlSeconds = 900) {}

  async get(key: string): Promise<string | null> {
    if (this.redis) {
      const value = await this.redis.get(key);
      return value ?? null;
    }

    const hit = memory.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      memory.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.redis) {
      await this.redis.set(key, value, "EX", this.ttlSeconds);
      return;
    }

    memory.set(key, { value, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }
}
