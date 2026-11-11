const { Pool } = require('pg');
const { createApp } = require('./app.cjs');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (error) => console.error('Unexpected database error:', error));
const port = Number(process.env.PORT || 3000);
const server = createApp(pool).listen(port, '0.0.0.0', () => console.log(`Monster Spirital Company listening on port ${port}`));

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0), (error) => {
    console.error('Failed to close database:', error);
    process.exit(1);
  }));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
