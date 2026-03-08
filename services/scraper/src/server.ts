import Fastify from "fastify";
import { z } from "zod";
import Redis from "ioredis";
import { config } from "./config";
import { ScrapeService } from "./core/service";
import { createQueue, createQueueEvents } from "./core/queue";
import { startWorker } from "./core/worker";

const app = Fastify({ logger: { level: config.logLevel } });

const querySchema = z.object({
  source: z.enum([
    "alibaba",
    "1688",
    "indiamart",
    "madeinchina",
    "amazon",
    "dhgate",
    "tradekey",
    "globalsources",
    "generic",
    "custom",
  ]),
  query: z.string().min(2),
  targetUrl: z.string().url().optional(),
  selectors: z
    .object({
      item: z.string(),
      title: z.string(),
      price: z.string().optional(),
      url: z.string().optional(),
      image: z.string().optional(),
    })
    .optional(),
  limit: z.coerce.number().int().min(1).max(config.maxItems).optional(),
  currency: z.string().optional(),
  region: z.string().optional(),
  useBrowser: z.coerce.boolean().optional(),
});

const batchSchema = z.object({
  queries: z.array(querySchema).min(1).max(10),
});

const redis = config.redisUrl ? new Redis(config.redisUrl) : undefined;
const service = new ScrapeService(redis);
const queue = createQueue();
const queueEvents = createQueueEvents();

if (config.startWorker) {
  startWorker(redis);
}

app.get("/health", async () => ({ status: "ok" }));

app.post<{ Querystring: { async?: string } }>("/scrape", async (request, reply) => {
  const parsed = querySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const asyncMode = request.query.async === "true";
  if (parsed.data.source === "custom") {
    if (!parsed.data.targetUrl || !parsed.data.selectors) {
      return reply
        .status(400)
        .send({ error: "Custom source requires targetUrl and selectors" });
    }
    parsed.data.useBrowser = true;
  }

  if (!queue || !queueEvents) {
    if (asyncMode) {
      return reply.status(400).send({ error: "Async mode requires REDIS_URL" });
    }
    const result = await service.scrape(parsed.data);
    return reply.send(result);
  }

  const job = await queue.add("scrape", parsed.data);
  if (asyncMode) {
    return reply.send({ jobId: job.id });
  }

  const result = await job.waitUntilFinished(queueEvents, config.jobTimeoutMs);
  return reply.send(result);
});

app.post("/scrape/batch", async (request, reply) => {
  const parsed = batchSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  let normalizedQueries: typeof parsed.data.queries;
  try {
    normalizedQueries = parsed.data.queries.map((item) => {
      if (item.source === "custom") {
        if (!item.targetUrl || !item.selectors) {
          throw new Error("Custom source requires targetUrl and selectors");
        }
        return { ...item, useBrowser: true };
      }
      return item;
    });
  } catch (error) {
    return reply.status(400).send({ error: (error as Error).message });
  }

  if (!queue || !queueEvents) {
    const result = await service.scrapeBatch(normalizedQueries);
    return reply.send({ results: result });
  }

  const jobs = await Promise.all(normalizedQueries.map((q) => queue.add("scrape", q)));
  const results = await Promise.all(jobs.map((job) => job.waitUntilFinished(queueEvents, config.jobTimeoutMs)));
  return reply.send({ results });
});

app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
  if (!queue) return reply.status(400).send({ error: "Queue not configured" });
  const job = await queue.getJob(request.params.id);
  if (!job) return reply.status(404).send({ error: "Job not found" });
  const state = await job.getState();
  const result = job.returnvalue ?? null;
  return reply.send({ id: job.id, state, result });
});

export async function start() {
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
