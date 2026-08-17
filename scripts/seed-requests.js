#!/usr/bin/env node
/**
 * Seed demo buyers/teams and 200 realistic requests.
 * Usage: node scripts/seed-requests.js [--count=200] [--clear]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcrypt');
const { runMigrations, getDb } = require('../server/db');

const COUNT = (() => {
  const arg = process.argv.find((a) => a.startsWith('--count='));
  return arg ? Math.max(1, Number(arg.split('=')[1]) || 200) : 200;
})();
const CLEAR = process.argv.includes('--clear');

const GEOS = ['UA', 'PL', 'DE', 'US', 'GB', 'CA', 'AU', 'BR', 'MX', 'IN', 'KZ'];
const LANGUAGES = ['EN', 'DE', 'PL', 'UA', 'ES', 'PT', 'FR', 'IT', 'RU', 'TR'];
const FUNNELS = ['Main', 'CRM', 'Quiz', 'Landing', 'PWA', 'Wheel', 'Pre-lander', 'Reg form'];
const COMPANIES = ['ABB', 'SER', 'AM'];

const BUYER_NOTES = [
  'Need quality leads, no fraud',
  'Prefer morning delivery window',
  'Cap can be increased if CR is good',
  'Strict geo match required',
  'Test batch first, then scale',
  'No duplicate phones',
  'WhatsApp verification required',
  'SMS + email double opt-in',
  'Weekend traffic OK',
  'Pause after daily cap hit',
  'High intent only',
  'Exclude existing CRM base',
  'Landing A/B test running',
  'Need daily report in Telegram',
  '',
  '',
];

const AFF_DETAILS = [
  'Delivered via partner network',
  'All leads passed validation',
  'Minor geo mismatch on 2 leads, replaced',
  'Campaign paused by buyer request',
  'Quality check passed',
];

const PARTNERS = ['LeadFlow', 'AdPeak', 'TrafficHub', 'MediaGate', 'ClickNova', 'PartnerX'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i += 1) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function randomDate(daysBack = 45) {
  const now = Date.now();
  const offset = randInt(0, daysBack * 24 * 60 * 60 * 1000);
  const d = new Date(now - offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ensureTeams(db) {
  const legacyRenames = [
    ['Alpha Buyers', 'OLG'],
    ['Beta Media', 'OST'],
    ['Core Team', 'OLI'],
    ['North Ops', 'OLG'],
  ];

  for (const [from, to] of legacyRenames) {
    db.prepare('UPDATE teams SET name = ? WHERE name = ?').run(to, from);
  }

  const teams = [
    { name: 'OLG', kind: 'buyer' },
    { name: 'OST', kind: 'buyer' },
    { name: 'OLI', kind: 'buyer' },
    { name: 'Aff Team', kind: 'aff' },
  ];

  const insert = db.prepare('INSERT INTO teams (name, kind, is_active) VALUES (?, ?, 1)');
  for (const team of teams) {
    const exists = db.prepare('SELECT id FROM teams WHERE name = ?').get(team.name);
    if (!exists) insert.run(team.name, team.kind);
  }

  return db.prepare('SELECT id, name, kind FROM teams WHERE is_active = 1').all();
}

function ensureUsers(db, teams) {
  const buyerTeams = teams.filter((t) => t.kind === 'buyer');
  const affTeam = teams.find((t) => t.kind === 'aff');
  const passwordHash = bcrypt.hashSync('demo123', 10);

  const roster = [
    { stage: 'tl-alpha', role: 'teamlead', company: 'ABB', team: 'OLG' },
    { stage: 'tl-beta', role: 'teamlead', company: 'SER', team: 'OST' },
    { stage: 'tl-core', role: 'teamlead', company: 'AM', team: 'OLI' },
    { stage: 'REX', legacyStage: 'buyer-alex', role: 'buyer', company: 'ABB', team: 'OLG', tl: 'tl-alpha' },
    { stage: 'KAI', legacyStage: 'buyer-maria', role: 'buyer', company: 'ABB', team: 'OLG', tl: 'tl-alpha' },
    { stage: 'MAX', legacyStage: 'buyer-ivan', role: 'buyer', company: 'SER', team: 'OST', tl: 'tl-beta' },
    { stage: 'LEO', legacyStage: 'buyer-kate', role: 'buyer', company: 'SER', team: 'OST', tl: 'tl-beta' },
    { stage: 'MIL', legacyStage: 'buyer-omar', role: 'buyer', company: 'AM', team: 'OLI', tl: 'tl-core' },
    { stage: 'RAY', legacyStage: 'buyer-lisa', role: 'buyer', company: 'AM', team: 'OLI', tl: 'tl-core' },
    { stage: 'JON', legacyStage: 'buyer-noah', role: 'buyer', company: 'ABB', team: 'OLG', tl: 'tl-alpha' },
    { stage: 'ZOE', legacyStage: 'buyer-sofia', role: 'buyer', company: 'SER', team: 'OST', tl: 'tl-beta' },
  ];

  const findUser = db.prepare('SELECT id FROM users WHERE stage = ? OR username = ?');
  const insertUser = db.prepare(`
    INSERT INTO users (username, stage, password_hash, role, team_id, team_lead_id, company, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const updateUser = db.prepare(`
    UPDATE users SET username = ?, stage = ?, team_id = ?, team_lead_id = ?, company = ?, role = ?
    WHERE id = ?
  `);

  const ids = {};

  for (const person of roster) {
    const team = buyerTeams.find((t) => t.name === person.team);
    const teamId = person.role === 'aff' ? affTeam?.id : team?.id;
    let tlId = null;
    if (person.tl) tlId = ids[person.tl] || null;

    const lookupStage = person.legacyStage || person.stage;
    const existing = findUser.get(lookupStage, lookupStage) || findUser.get(person.stage, person.stage);
    if (existing) {
      updateUser.run(person.stage, person.stage, teamId, tlId, person.company, person.role, existing.id);
      ids[person.stage] = existing.id;
    } else {
      const result = insertUser.run(
        person.stage,
        person.stage,
        passwordHash,
        person.role,
        teamId,
        tlId,
        person.company
      );
      ids[person.stage] = result.lastInsertRowid;
    }
  }

  // Resolve teamlead ids after all teamleads inserted
  for (const person of roster.filter((p) => p.role === 'buyer')) {
    const buyerId = ids[person.stage];
    const tlId = ids[person.tl];
    if (buyerId && tlId) {
      db.prepare('UPDATE users SET team_lead_id = ? WHERE id = ?').run(tlId, buyerId);
    }
  }

  // Keep existing demo users in pool
  const buyers = db
    .prepare("SELECT id, stage, company, team_id FROM users WHERE role = 'buyer' AND is_active = 1")
    .all();
  const affs = db
    .prepare("SELECT id FROM users WHERE role = 'aff' AND is_active = 1")
    .all();

  return { buyers, affs };
}

function buildRequest(buyers, affs) {
  const buyer = pick(buyers);
  const geo = pick(GEOS);
  const language = pick(LANGUAGES);
  const quantity = pick([50, 75, 100, 120, 150, 200, 250, 300, 400, 500]);
  const funnel = pick(FUNNELS);
  const comment = pick(BUYER_NOTES);
  const createdAt = randomDate(50);

  const roll = Math.random();
  let status;
  if (roll < 0.08) status = 'draft';
  else if (roll < 0.35) status = 'new';
  else if (roll < 0.55) status = 'in_progress';
  else status = 'done';

  let takenById = null;
  let affGeo = null;
  let affLanguage = null;
  let affWh = null;
  let affPrice = null;
  let partner = null;
  let resultStatus = null;
  let resultDetails = null;
  let resultQuantity = null;
  let completedAt = null;
  let updatedAt = createdAt;

  if (status !== 'draft' && status !== 'new' && affs.length) {
    takenById = pick(affs).id;
  }

  if (status === 'in_progress' || status === 'done') {
    affGeo = Math.random() < 0.85 ? geo : pick(GEOS);
    affLanguage = Math.random() < 0.9 ? language : pick(LANGUAGES);
    affWh = String(randInt(70, 100));
    affPrice = String(randInt(8, 35) * 500);
    partner = pick(PARTNERS);
    updatedAt = randomDate(30);
  }

  if (status === 'done') {
    resultQuantity = Math.random() < 0.15 ? randInt(Math.floor(quantity * 0.5), quantity) : quantity;
    resultStatus = Math.random() < 0.82 ? 'approved' : 'rejected';
    resultDetails = pick(AFF_DETAILS);
    completedAt = updatedAt;
  }

  if (status === 'draft') {
    return {
      buyer_id: buyer.id,
      geo: Math.random() < 0.5 ? geo : '',
      language: Math.random() < 0.5 ? language : null,
      quantity: Math.random() < 0.5 ? quantity : 0,
      funnel: Math.random() < 0.5 ? funnel : null,
      comment: Math.random() < 0.4 ? comment : null,
      status: 'draft',
      taken_by_id: null,
      aff_geo: null,
      aff_language: null,
      aff_wh: null,
      aff_price: null,
      partner: null,
      result_status: null,
      result_details: null,
      result_quantity: null,
      created_at: createdAt,
      updated_at: createdAt,
      completed_at: null,
    };
  }

  return {
    buyer_id: buyer.id,
    geo,
    language,
    quantity,
    funnel,
    comment: comment || null,
    status,
    taken_by_id: takenById,
    aff_geo: affGeo,
    aff_language: affLanguage,
    aff_wh: affWh,
    aff_price: affPrice,
    partner,
    result_status: resultStatus,
    result_details: resultDetails,
    result_quantity: resultQuantity,
    created_at: createdAt,
    updated_at: updatedAt,
    completed_at: completedAt,
  };
}

function main() {
  runMigrations();
  const db = getDb();

  if (CLEAR) {
    db.prepare('DELETE FROM requests').run();
    console.log('Cleared all requests.');
  }

  const teams = ensureTeams(db);
  const { buyers, affs } = ensureUsers(db, teams);

  if (!buyers.length) {
    console.error('No buyers found. Create buyers first.');
    process.exit(1);
  }

  const insert = db.prepare(`
    INSERT INTO requests (
      buyer_id, geo, language, quantity, funnel, comment, status,
      taken_by_id, aff_geo, aff_language, partner, aff_wh, aff_price,
      result_status, result_details, result_quantity,
      created_at, updated_at, completed_at
    ) VALUES (
      @buyer_id, @geo, @language, @quantity, @funnel, @comment, @status,
      @taken_by_id, @aff_geo, @aff_language, @partner, @aff_wh, @aff_price,
      @result_status, @result_details, @result_quantity,
      @created_at, @updated_at, @completed_at
    )
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });

  const rows = [];
  for (let i = 0; i < COUNT; i += 1) {
    rows.push(buildRequest(buyers, affs));
  }
  insertMany(rows);

  const stats = db
    .prepare(`
      SELECT status, COUNT(*) AS c
      FROM requests
      GROUP BY status
      ORDER BY status
    `)
    .all();

  console.log(`Inserted ${COUNT} requests.`);
  console.log('Buyers:', buyers.map((b) => b.stage).join(', '));
  console.log('Status breakdown:', stats);
  console.log('Total requests:', db.prepare('SELECT COUNT(*) AS c FROM requests').get().c);
}

main();
