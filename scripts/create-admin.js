require('dotenv').config();

const bcrypt = require('bcrypt');
const { getDb, runMigrations } = require('../server/db');

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node scripts/create-admin.js <username> <password>');
  process.exit(1);
}

runMigrations();

const db = getDb();
const existing = db
  .prepare('SELECT id FROM users WHERE username = ?')
  .get(username);

if (existing) {
  console.error(`Error: username "${username}" is already taken`);
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 10);

db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
).run(username, passwordHash, 'admin');

console.log(`Admin "${username}" created successfully`);
