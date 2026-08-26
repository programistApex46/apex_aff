const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || './data.sqlite';
    db = new Database(path.resolve(dbPath));
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function hasColumn(database, table, column) {
  const columns = database.pragma(`table_info(${table})`);
  return columns.some((col) => col.name === column);
}

function hasTable(database, table) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return !!row;
}

function requestsUseTextIds(database) {
  if (!hasTable(database, 'requests')) return false;
  const col = database.pragma('table_info(requests)').find((c) => c.name === 'id');
  return !!(col && String(col.type).toUpperCase() === 'TEXT');
}

function migrateUsersTable(database) {
  if (!hasColumn(database, 'users', 'is_active')) {
    database.pragma('foreign_keys = OFF');

    database.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('teamlead', 'buyer', 'aff', 'admin')),
        telegram_chat_id TEXT,
        team_lead_id INTEGER REFERENCES users(id),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users_new (id, username, password_hash, role, telegram_chat_id, team_lead_id, created_at, is_active)
      SELECT id, username, password_hash, role, telegram_chat_id, team_lead_id, created_at, 1
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);

    database.pragma('foreign_keys = ON');
  }
}

function migrateUserProfileColumns(database) {
  const columns = [
    { name: 'email', sql: 'TEXT' },
    { name: 'team_aff_id', sql: 'INTEGER REFERENCES users(id)' },
  ];

  for (const column of columns) {
    if (!hasColumn(database, 'users', column.name)) {
      database.exec(`ALTER TABLE users ADD COLUMN ${column.name} ${column.sql}`);
    }
  }
}

function migrateRequestsTable(database) {
  const columns = [
    { name: 'stage', sql: 'TEXT' },
    { name: 'funnel', sql: 'TEXT' },
    { name: 'aff_geo', sql: 'TEXT' },
    { name: 'aff_wh', sql: 'TEXT' },
    { name: 'aff_price', sql: 'TEXT' },
  ];

  for (const column of columns) {
    if (!hasColumn(database, 'requests', column.name)) {
      database.exec(`ALTER TABLE requests ADD COLUMN ${column.name} ${column.sql}`);
    }
  }
}

function requestsSchemaHasDraft(database) {
  if (!hasTable(database, 'requests')) return true;
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='requests'")
    .get();
  return !!(row && row.sql && row.sql.includes("'draft'"));
}

function migrateRequestsStatusDraft(database) {
  if (requestsUseTextIds(database)) return;
  if (!hasTable(database, 'requests') || requestsSchemaHasDraft(database)) {
    return;
  }

  database.pragma('foreign_keys = OFF');

  database.exec(`
    CREATE TABLE requests_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL REFERENCES users(id),
      stage TEXT,
      geo TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      funnel TEXT,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('draft', 'new', 'in_progress', 'done')),
      taken_by_id INTEGER REFERENCES users(id),
      aff_geo TEXT,
      aff_wh TEXT,
      aff_price TEXT,
      result_status TEXT CHECK(result_status IN ('approved', 'rejected')),
      result_details TEXT,
      result_quantity INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO requests_new (
      id, buyer_id, stage, geo, quantity, funnel, comment, status,
      taken_by_id, aff_geo, aff_wh, aff_price,
      result_status, result_details, result_quantity, created_at, updated_at
    )
    SELECT
      id, buyer_id, stage, geo, quantity, funnel, comment, status,
      taken_by_id, aff_geo, aff_wh, aff_price,
      result_status, result_details, result_quantity, created_at, updated_at
    FROM requests;

    DROP TABLE requests;
    ALTER TABLE requests_new RENAME TO requests;
  `);

  database.pragma('foreign_keys = ON');
}

function migrateAuthTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telegram_login_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_login_codes_code ON telegram_login_codes(code);
  `);
}

function migratePasskeysTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS passkeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id);
  `);

  const passkeyCount = database.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n;
  if (passkeyCount === 0) {
    const legacy = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'webauthn_credentials'")
      .get();
    if (legacy) {
      database.exec(`
        INSERT INTO passkeys (user_id, credential_id, public_key, counter, created_at)
        SELECT user_id, credential_id, public_key, counter, created_at
        FROM webauthn_credentials
      `);
    }
  }
}

function migrateRequestsCompletedAt(database) {
  if (!hasColumn(database, 'requests', 'completed_at')) {
    database.exec('ALTER TABLE requests ADD COLUMN completed_at DATETIME');
    database.exec(`
      UPDATE requests
      SET completed_at = updated_at
      WHERE status = 'done' AND completed_at IS NULL
    `);
  }
}

function migrateTeamsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (!hasColumn(database, 'users', 'team_id')) {
    database.exec('ALTER TABLE users ADD COLUMN team_id INTEGER REFERENCES teams(id)');
  }
}

function migrateUserStageColumn(database) {
  if (!hasColumn(database, 'users', 'stage')) {
    database.exec('ALTER TABLE users ADD COLUMN stage TEXT');
  }
  database.exec("UPDATE users SET stage = username WHERE stage IS NULL OR stage = ''");
}

function migrateTeamKindColumn(database) {
  if (hasColumn(database, 'teams', 'kind')) {
    return;
  }

  database.pragma('foreign_keys = OFF');

  database.exec(`
    CREATE TABLE teams_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'buyer' CHECK(kind IN ('buyer', 'aff')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, kind)
    );

    INSERT INTO teams_new (id, name, kind, is_active, created_at)
    SELECT id, name, 'buyer', is_active, created_at FROM teams;

    DROP TABLE teams;
    ALTER TABLE teams_new RENAME TO teams;
  `);

  database.pragma('foreign_keys = ON');
}

function requestsSchemaAllowsPartial(database) {
  if (!hasTable(database, 'requests')) return false;
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='requests'")
    .get();
  return !!(row && row.sql && row.sql.includes("'partial'"));
}

function migrateRequestsRemovePartial(database) {
  if (requestsUseTextIds(database)) return;
  if (!requestsSchemaAllowsPartial(database)) {
    return;
  }

  database.exec("UPDATE requests SET result_status = 'approved' WHERE result_status = 'partial'");

  database.pragma('foreign_keys = OFF');

  database.exec(`
    CREATE TABLE requests_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL REFERENCES users(id),
      stage TEXT,
      geo TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      funnel TEXT,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('draft', 'new', 'in_progress', 'done')),
      taken_by_id INTEGER REFERENCES users(id),
      aff_geo TEXT,
      aff_wh TEXT,
      aff_price TEXT,
      result_status TEXT CHECK(result_status IN ('approved', 'rejected')),
      result_details TEXT,
      result_quantity INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    INSERT INTO requests_new (
      id, buyer_id, stage, geo, quantity, funnel, comment, status,
      taken_by_id, aff_geo, aff_wh, aff_price,
      result_status, result_details, result_quantity, created_at, updated_at, completed_at
    )
    SELECT
      id, buyer_id, stage, geo, quantity, funnel, comment, status,
      taken_by_id, aff_geo, aff_wh, aff_price,
      result_status, result_details, result_quantity, created_at, updated_at, completed_at
    FROM requests;

    DROP TABLE requests;
    ALTER TABLE requests_new RENAME TO requests;
  `);

  database.pragma('foreign_keys = ON');
}

function migrateUserAvatarColumn(database) {
  if (!hasColumn(database, 'users', 'avatar_path')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar_path TEXT');
  }
}

function migrateRequestLanguageColumns(database) {
  for (const column of ['language', 'aff_language']) {
    if (!hasColumn(database, 'requests', column)) {
      database.exec(`ALTER TABLE requests ADD COLUMN ${column} TEXT`);
    }
  }
}

function migrateRequestPartnerColumn(database) {
  if (!hasColumn(database, 'requests', 'partner')) {
    database.exec('ALTER TABLE requests ADD COLUMN partner TEXT');
  }
}

function migrateBuyerStageCodes(database) {
  const renames = [
    ['buyer-alex', 'REX'],
    ['buyer-maria', 'KAI'],
    ['buyer-noah', 'JON'],
    ['buyer-ivan', 'MAX'],
    ['buyer-kate', 'LEO'],
    ['buyer-sofia', 'ZOE'],
    ['buyer-omar', 'MIL'],
    ['buyer-lisa', 'RAY'],
  ];

  const update = database.prepare(`
    UPDATE users
    SET stage = ?, username = ?
    WHERE role = 'buyer' AND (stage = ? OR username = ?)
  `);

  for (const [from, to] of renames) {
    update.run(to, to, from, from);
  }
}

function migrateUserCompanyColumn(database) {
  if (!hasColumn(database, 'users', 'company')) {
    database.exec('ALTER TABLE users ADD COLUMN company TEXT');
  }
}

function runMigrations() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('teamlead', 'buyer', 'aff', 'admin')),
      telegram_chat_id TEXT,
      team_lead_id INTEGER REFERENCES users(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL REFERENCES users(id),
      stage TEXT,
      geo TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      funnel TEXT,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('draft', 'new', 'in_progress', 'done')),
      taken_by_id INTEGER REFERENCES users(id),
      aff_geo TEXT,
      aff_wh TEXT,
      aff_price TEXT,
      result_status TEXT CHECK(result_status IN ('approved', 'rejected')),
      result_details TEXT,
      result_quantity INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  migrateUsersTable(database);
  migrateUserProfileColumns(database);
  migrateRequestsTable(database);
  migrateRequestsStatusDraft(database);
  migrateRequestsCompletedAt(database);
  migrateAuthTables(database);
  migratePasskeysTable(database);
  migrateTeamsTable(database);
  migrateTeamKindColumn(database);
  migrateUserStageColumn(database);
  migrateBuyerStageCodes(database);
  migrateUserCompanyColumn(database);
  migrateUserAvatarColumn(database);
  migrateRequestLanguageColumns(database);
  migrateRequestPartnerColumn(database);
  migrateRequestsRemovePartial(database);

  const { ensureAssignmentSchema } = require('./lib/request-assignments');
  ensureAssignmentSchema(database);
}

module.exports = { getDb, runMigrations };
