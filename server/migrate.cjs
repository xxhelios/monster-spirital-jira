const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
      const backlogMigration = await fs.readFile(path.join(__dirname, 'backlog-migration.sql'), 'utf8');
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(786542319)');
      await client.query(schema);
      await client.query(backlogMigration);
      await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id)");
      await client.query('CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks(project_id)');
      await client.query('COMMIT');
      console.log('Database schema is ready.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
});
