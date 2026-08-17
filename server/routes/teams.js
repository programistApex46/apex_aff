const express = require('express');
const { getDb } = require('../db');
const { requireRole } = require('../middleware/auth');
const { wantsPartial, requirePartial } = require('../lib/http');
const { TEAM_KINDS, memberCountSql } = require('../lib/teams');

const router = express.Router();

router.use(requireRole('admin'));

function getTeamsList(db) {
  return db
    .prepare(`
      SELECT t.*,
        ${memberCountSql('t')} AS member_count
      FROM teams t
      ORDER BY t.kind ASC, t.is_active DESC, t.name ASC
    `)
    .all();
}

function renderTeamsShell(res, options = {}) {
  const db = getDb();
  return res.render('partials/modals/teams-shell', {
    teams: getTeamsList(db),
    error: options.error || null,
    success: options.success || null,
  });
}

function validateTeamFields(db, { name, kind }, { teamId }) {
  const trimmed = name?.trim();
  if (!trimmed) {
    return 'Enter team name';
  }

  if (!TEAM_KINDS.includes(kind)) {
    return 'Select team type';
  }

  const existing = db
    .prepare('SELECT id FROM teams WHERE name = ? AND kind = ? AND id != ?')
    .get(trimmed, kind, teamId || 0);
  if (existing) {
    return 'Team name already taken for this type';
  }

  return null;
}

function countActiveMembers(db, teamId, kind) {
  return db
    .prepare(`
      SELECT COUNT(*) AS count FROM users
      WHERE team_id = ? AND is_active = 1
        AND (
          (? = 'buyer' AND role IN ('teamlead', 'buyer'))
          OR (? = 'aff' AND role = 'aff')
        )
    `)
    .get(teamId, kind, kind).count;
}

router.get('/modal', (req, res) => {
  if (!requirePartial(req, res, '/?panel=teams')) return;
  return renderTeamsShell(res, { error: req.query.error || null });
});

router.get('/list-modal', (req, res) => {
  if (!requirePartial(req, res, '/?panel=teams')) return;

  const db = getDb();
  res.render('partials/modals/teams-list', {
    teams: getTeamsList(db),
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

router.get('/new-modal', (req, res) => {
  if (!requirePartial(req, res, '/?panel=teams-new')) return;

  res.render('partials/modals/team-form', {
    form: { name: '', kind: 'buyer' },
    error: null,
  });
});

router.get('/:id(\\d+)/edit-modal', (req, res) => {
  if (!requirePartial(req, res, '/?panel=teams')) return;

  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(req.params.id));
  if (!team) {
    return res.status(404).render('404', { title: 'Not found' });
  }

  res.render('partials/modals/team-edit-form', {
    team,
    error: null,
  });
});

router.post('/', (req, res) => {
  const db = getDb();
  const form = { name: req.body.name || '', kind: req.body.kind || '' };
  const error = validateTeamFields(db, form, {});

  if (error) {
    if (!wantsPartial(req)) {
      return res.redirect('/?panel=teams-new');
    }
    return res.render('partials/modals/team-form', { form, error });
  }

  db.prepare('INSERT INTO teams (name, kind) VALUES (?, ?)').run(form.name.trim(), form.kind);

  if (wantsPartial(req)) {
    return renderTeamsShell(res, { success: 'Team created' });
  }

  res.redirect('/?panel=teams');
});

router.post('/:id(\\d+)/delete', (req, res) => {
  const db = getDb();
  const teamId = Number(req.params.id);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);

  if (!team) {
    if (wantsPartial(req)) {
      return res.status(404).render('404', { title: 'Not found' });
    }
    return res.redirect('/?panel=teams');
  }

  if (countActiveMembers(db, teamId, team.kind) > 0) {
    return renderTeamsShell(res, { error: 'Team has active members — reassign them first' });
  }

  db.prepare('UPDATE teams SET is_active = 0 WHERE id = ?').run(teamId);

  if (wantsPartial(req)) {
    return renderTeamsShell(res, { success: 'Team deactivated' });
  }

  res.redirect('/?panel=teams');
});

router.post('/:id(\\d+)/restore', (req, res) => {
  const db = getDb();
  const teamId = Number(req.params.id);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);

  if (!team) {
    if (wantsPartial(req)) {
      return res.status(404).render('404', { title: 'Not found' });
    }
    return res.redirect('/?panel=teams');
  }

  db.prepare('UPDATE teams SET is_active = 1 WHERE id = ?').run(teamId);

  if (wantsPartial(req)) {
    return renderTeamsShell(res, { success: 'Team restored' });
  }

  res.redirect('/?panel=teams');
});

router.post('/:id(\\d+)', (req, res) => {
  const db = getDb();
  const teamId = Number(req.params.id);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);

  if (!team) {
    if (wantsPartial(req)) {
      return res.status(404).render('404', { title: 'Not found' });
    }
    return res.redirect('/?panel=teams');
  }

  const form = { name: req.body.name || '', kind: team.kind };
  const error = validateTeamFields(db, form, { teamId });

  if (error) {
    if (!wantsPartial(req)) {
      return res.redirect('/?panel=teams');
    }
    return res.render('partials/modals/team-edit-form', {
      team: { ...team, name: form.name },
      error,
    });
  }

  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(form.name.trim(), teamId);

  if (wantsPartial(req)) {
    return renderTeamsShell(res, { success: 'Team updated' });
  }

  res.redirect('/?panel=teams');
});

module.exports = router;
