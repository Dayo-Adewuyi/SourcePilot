import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4080),
  LOG_LEVEL: z.string().default("info"),
  REDIS_URL: z.string().optional(),
  START_WORKER: z.coerce.boolean().default(true),
  CACHE_TTL_SECONDS: z.coerce.number().default(900),
  DEFAULT_CURRENCY: z.string().default("USD"),
  MAX_ITEMS: z.coerce.number().default(40),
  CONCURRENCY: z.coerce.number().default(4),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(20000),
  JOB_TIMEOUT_MS: z.coerce.number().default(60000),
  BROWSER_WAIT_MS: z.coerce.number().default(1200),
  BROWSER_SCROLLS: z.coerce.number().default(2),
  DEBUG_SCRAPER: z.coerce.boolean().default(false),
  DEBUG_DIR: z.string().default("tmp/scraper-debug"),

  ALIBABA_API_BASE: z.string().optional(),
  ALIBABA_APP_KEY: z.string().optional(),
  ALIBABA_APP_SECRET: z.string().optional(),
  ALIBABA_API_METHOD: z.string().optional(),
  ALIBABA_SIGN_METHOD: z.enum(["md5", "hmac"]).default("md5"),
  ALIBABA_API_VERSION: z.string().default("2.0"),
  ALIBABA_API_FORMAT: z.string().default("json"),
  ALIBABA_QUERY_KEY: z.string().default("keywords"),
  ALIBABA_LIMIT_KEY: z.string().default("pageSize"),
  ALIBABA_EXTRA_PARAMS: z.string().optional(),
  ALIBABA_SESSION: z.string().optional(),

  INDIAMART_API_BASE: z.string().optional(),
  INDIAMART_API_KEY: z.string().optional(),

  MADEINCHINA_API_BASE: z.string().optional(),
  MADEINCHINA_API_KEY: z.string().optional(),

  AMAZON_PA_API_BASE: z.string().optional(),
  AMAZON_PA_ACCESS_KEY: z.string().optional(),
  AMAZON_PA_SECRET_KEY: z.string().optional(),
  AMAZON_PA_PARTNER_TAG: z.string().optional(),
  AMAZON_PA_REGION: z.string().optional(),
  AMAZON_PA_HOST: z.string().optional(),
  AMAZON_PA_MARKETPLACE: z.string().optional(),
  AMAZON_PA_SEARCH_INDEX: z.string().optional(),

  PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
  PLAYWRIGHT_PROXY: z.string().optional()
});

const parsed = schema.parse(process.env);

export const config = {
  port: parsed.PORT,
  logLevel: parsed.LOG_LEVEL,
  redisUrl: parsed.REDIS_URL,
  startWorker: parsed.START_WORKER,
  cacheTtlSeconds: parsed.CACHE_TTL_SECONDS,
  defaultCurrency: parsed.DEFAULT_CURRENCY,
  maxItems: parsed.MAX_ITEMS,
  concurrency: parsed.CONCURRENCY,
  requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
  jobTimeoutMs: parsed.JOB_TIMEOUT_MS,
  browserWaitMs: parsed.BROWSER_WAIT_MS,
  browserScrolls: parsed.BROWSER_SCROLLS,
  debug: {
    enabled: parsed.DEBUG_SCRAPER,
    dir: parsed.DEBUG_DIR,
  },
  providers: {
    alibaba: {
      baseUrl: parsed.ALIBABA_API_BASE,
      appKey: parsed.ALIBABA_APP_KEY,
      appSecret: parsed.ALIBABA_APP_SECRET,
      method: parsed.ALIBABA_API_METHOD,
      signMethod: parsed.ALIBABA_SIGN_METHOD,
      version: parsed.ALIBABA_API_VERSION,
      format: parsed.ALIBABA_API_FORMAT,
      queryKey: parsed.ALIBABA_QUERY_KEY,
      limitKey: parsed.ALIBABA_LIMIT_KEY,
      extraParams: parsed.ALIBABA_EXTRA_PARAMS,
      session: parsed.ALIBABA_SESSION,
    },
    indiamart: {
      baseUrl: parsed.INDIAMART_API_BASE,
      apiKey: parsed.INDIAMART_API_KEY,
    },
    madeinchina: {
      baseUrl: parsed.MADEINCHINA_API_BASE,
      apiKey: parsed.MADEINCHINA_API_KEY,
    },
    amazon: {
      baseUrl: parsed.AMAZON_PA_API_BASE,
      accessKey: parsed.AMAZON_PA_ACCESS_KEY,
      secretKey: parsed.AMAZON_PA_SECRET_KEY,
      partnerTag: parsed.AMAZON_PA_PARTNER_TAG,
      region: parsed.AMAZON_PA_REGION ?? "us-east-1",
      host: parsed.AMAZON_PA_HOST,
      marketplace: parsed.AMAZON_PA_MARKETPLACE ?? "www.amazon.com",
      searchIndex: parsed.AMAZON_PA_SEARCH_INDEX,
    },
  },
  playwright: {
    headless: parsed.PLAYWRIGHT_HEADLESS,
    proxy: parsed.PLAYWRIGHT_PROXY,
  },
};
