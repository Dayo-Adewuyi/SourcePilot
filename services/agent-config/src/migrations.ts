import { pool } from "./db";

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config JSONB NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS agent_configs_active_idx
      ON agent_configs (active);
  `);
}

const isDirectRun = process.argv[1] === new URL(import.meta.url).pathname;
if (isDirectRun) {
  runMigrations()
    .then(() => pool.end())
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}
