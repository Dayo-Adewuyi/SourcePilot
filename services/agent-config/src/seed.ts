import { pool } from "./db";
import { runMigrations } from "./migrations";

async function seed() {
  await runMigrations();

  await pool.query(
    `INSERT INTO agent_configs (id, name, config, active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id)
     DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config, active = EXCLUDED.active, updated_at = NOW()`,
    [
      "amara-agent-1",
      "Amara - Phone Accessories",
      {
        sources: ["alibaba"],
        categories: ["phone-cases", "screen-protectors", "charging-cables"],
        limit: 20,
        currency: "USD",
        preferences: { minOrderSize: 50, maxOrderSize: 10000 },
      },
      true,
    ]
  );

  await pool.end();
}

seed().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
