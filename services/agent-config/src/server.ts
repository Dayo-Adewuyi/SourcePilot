import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config";
import { pool } from "./db";
import { runMigrations } from "./migrations";
import { createAgentSchema, updateAgentSchema } from "./schemas";

const app = Fastify({ logger: { level: config.logLevel } });

app.register(rateLimit, {
  max: config.rateLimit.max,
  timeWindow: `${config.rateLimit.window}s`,
});

app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/health") return;
  const apiKey = request.headers["x-api-key"];
  if (!apiKey || apiKey !== config.apiKey) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

app.get("/health", async () => ({ status: "ok" }));

app.post("/agents", async (request, reply) => {
  const parsed = createAgentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { id, name, config: agentConfig, active } = parsed.data;
  await pool.query(
    `INSERT INTO agent_configs (id, name, config, active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id)
     DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config, active = EXCLUDED.active, updated_at = NOW()`,
    [id, name, agentConfig, active]
  );

  return reply.status(201).send({ id, name, config: agentConfig, active });
});

app.get("/agents/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const result = await pool.query(
    `SELECT id, name, config, active, created_at, updated_at
     FROM agent_configs
     WHERE id = $1`,
    [id]
  );

  if (result.rowCount === 0) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  return reply.send(result.rows[0]);
});

app.put("/agents/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const parsed = updateAgentSchema.safeParse({ ...(request.body as object), id });
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const existing = await pool.query(
    `SELECT id, name, config, active FROM agent_configs WHERE id = $1`,
    [id]
  );
  if (existing.rowCount === 0) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const merged = {
    name: parsed.data.name ?? existing.rows[0].name,
    config: parsed.data.config ?? existing.rows[0].config,
    active: parsed.data.active ?? existing.rows[0].active,
  };

  await pool.query(
    `UPDATE agent_configs SET name = $2, config = $3, active = $4, updated_at = NOW() WHERE id = $1`,
    [id, merged.name, merged.config, merged.active]
  );

  return reply.send({ id, ...merged });
});

app.delete("/agents/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  await pool.query(`DELETE FROM agent_configs WHERE id = $1`, [id]);
  return reply.status(204).send();
});

export async function start() {
  await runMigrations();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
