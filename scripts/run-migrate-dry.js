// Small runner that registers ts-node then requires the TS migration script.
// Usage: node scripts/run-migrate-dry.js --dry-run
// This runner will also load .env into process.env using dotenv, so you can
// store MONGO_URI_OP or other helpers in the repository .env file.
try {
  // load .env first so process.env contains values from .env
  try { require('dotenv').config(); } catch (e) { /* ignore if dotenv not installed */ }

  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
} catch (e) {
  console.error('ts-node not found. Install it with: npm i -D ts-node typescript');
  process.exit(1);
}
require('./migrate-populate-hexid.ts');
