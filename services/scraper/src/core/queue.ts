import { Queue, QueueEvents } from "bullmq";
import { config } from "../config";

export const queueName = "scrape";

export function createQueue() {
  if (!config.redisUrl) return null;
  return new Queue(queueName, {
    connection: { url: config.redisUrl },
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });
}

export function createQueueEvents() {
  if (!config.redisUrl) return null;
  return new QueueEvents(queueName, { connection: { url: config.redisUrl } });
}
