import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4100),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string(),
  API_KEY: z.string().min(16),
  RATE_LIMIT_MAX: z.coerce.number().default(120),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60),
});

const parsed = schema.parse(process.env);

export const config = {
  port: parsed.PORT,
  logLevel: parsed.LOG_LEVEL,
  databaseUrl: parsed.DATABASE_URL,
  apiKey: parsed.API_KEY,
  rateLimit: {
    max: parsed.RATE_LIMIT_MAX,
    window: parsed.RATE_LIMIT_WINDOW,
  },
};
