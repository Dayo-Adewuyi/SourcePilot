import { Worker, type Job } from "bullmq";
import { config } from "../config";
import type { ScrapeQuery, ScrapeResult } from "../types";
import { ScrapeService } from "./service";
import type { Redis } from "ioredis";

export function startWorker(redis?: Redis) {
  if (!config.redisUrl) return null;

  const service = new ScrapeService(redis);

  return new Worker(
    "scrape",
    async (job: Job<ScrapeQuery>): Promise<ScrapeResult> => {
      return service.scrape(job.data);
    },
    {
      connection: { url: config.redisUrl },
      concurrency: config.concurrency,
    }
  );
}
