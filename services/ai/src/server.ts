import Fastify from "fastify";
import { z } from "zod";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

const scrapedProductSchema = z.object({
  title: z.string(),
  price: z.coerce.number().nonnegative(),
  currency: z.string().default("USD"),
  moq: z.coerce.number().int().nonnegative().default(0),
  supplier: z.string().default(""),
  supplierRating: z.coerce.number().min(0).max(5).default(0),
  supplierUrl: z.string().optional(),
  productUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  source: z.string().default("unknown"),
  shippingEstimate: z.coerce.number().optional(),
  location: z.string().optional(),
});

const analyzeSchema = z.object({
  products: z.array(scrapedProductSchema),
  agentPreferences: z.object({
    minOrderSize: z.coerce.number().int().nonnegative(),
    maxOrderSize: z.coerce.number().int().nonnegative(),
    categories: z.array(z.string()).default([]),
  }),
});

const assessRiskSchema = z.object({
  supplier: scrapedProductSchema,
  dealAmount: z.coerce.number().nonnegative(),
});

app.get("/health", async () => ({ status: "ok" }));

app.post("/analyze-suppliers", async (request, reply) => {
  const parsed = analyzeSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { products, agentPreferences } = parsed.data;
  const normalized = products.map((product) => {
    const moq = product.moq ?? 0;
    const moqPenalty = moq > agentPreferences.maxOrderSize || moq < agentPreferences.minOrderSize ? 2000 : 0;
    const ratingScore = Math.round((product.supplierRating / 5) * 4000);
    const priceScore = product.price > 0 ? Math.max(0, 4000 - Math.round(product.price * 10)) : 1000;
    const score = Math.max(0, Math.min(10000, ratingScore + priceScore - moqPenalty));

    const unitPrice = BigInt(Math.round(product.price * 1_000_000));
    const shippingCost = BigInt(0);

    return {
      productHash: "0x" + Buffer.from(product.title).toString("hex").slice(0, 64).padEnd(64, "0"),
      unitPrice,
      moq: BigInt(moq),
      shippingCost,
      supplierScore: BigInt(score),
      supplierRef: product.supplierUrl || product.productUrl || product.title,
    };
  });

  const sorted = normalized.sort((a, b) => Number(b.supplierScore - a.supplierScore));
  return reply.send(sorted);
});

app.post("/assess-risk", async (request, reply) => {
  const parsed = assessRiskSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { supplier, dealAmount } = parsed.data;

  let riskScore = 5000;
  let reason = "Baseline risk";

  if (supplier.supplierRating < 3) {
    riskScore += 2500;
    reason = "Low supplier rating";
  }

  if (dealAmount > 10000) {
    riskScore += 1500;
    reason = "High deal amount";
  }

  if (!supplier.supplierUrl) {
    riskScore += 1000;
    reason = "Missing supplier URL";
  }

  riskScore = Math.min(10000, riskScore);

  return reply.send({ riskScore, reason });
});

export async function start() {
  const port = Number(process.env.PORT ?? 4090);
  await app.listen({ port, host: "0.0.0.0" });
}
