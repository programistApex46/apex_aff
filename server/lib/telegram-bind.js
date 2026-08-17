const crypto = require('crypto');
const { getDb } = require('../db');

const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || 'Apex_aff_bot').replace(/^@/, '');
const CODE_TTL_MINUTES = 30;

function getBotUsername() {
  return BOT_USERNAME;
}

function getBotUrl() {
  return `https://t.me/${BOT_USERNAME}`;
}

function getBindLink(code) {
  return `https://t.me/${BOT_USERNAME}?start=bind_${code}`;
}

function createOrGetBindCode(userId) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT code FROM telegram_login_codes
       WHERE user_id = ? AND used = 0 AND expires_at > datetime('now')
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId);

  if (existing) {
    return existing.code;
  }

  const code = crypto.randomBytes(12).toString('hex');
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  db.prepare(
    `INSERT INTO telegram_login_codes (user_id, code, expires_at)
     VALUES (?, ?, ?)`
  ).run(userId, code, expiresAt);

  return code;
}

function refreshBindCode(userId) {
  const db = getDb();
  db.prepare('UPDATE telegram_login_codes SET used = 1 WHERE user_id = ? AND used = 0').run(userId);
  return createOrGetBindCode(userId);
}

function bindTelegramByCode(code, chatId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id FROM telegram_login_codes
       WHERE code = ? AND used = 0 AND expires_at > datetime('now')`
    )
    .get(code);

  if (!row) {
    return { ok: false, error: 'invalid_or_expired' };
  }

  db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?').run(String(chatId), row.user_id);
  db.prepare('UPDATE telegram_login_codes SET used = 1 WHERE id = ?').run(row.id);

  return { ok: true, userId: row.user_id };
}

function unlinkTelegram(userId) {
  const db = getDb();
  db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE id = ?').run(userId);
  db.prepare('UPDATE telegram_login_codes SET used = 1 WHERE user_id = ? AND used = 0').run(userId);
}

module.exports = {
  getBotUsername,
  getBotUrl,
  getBindLink,
  createOrGetBindCode,
  refreshBindCode,
  bindTelegramByCode,
  unlinkTelegram,
};
