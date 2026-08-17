const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../../db');
const { requireRole } = require('../../middleware/auth');
const { getActiveTeamsByKind, validateTeamId } = require('../../lib/teams');

function getTeamOptionsForForm(db) {
  return {
    buyerTeams: getActiveTeamsByKind(db, 'buyer'),
    affTeams: getActiveTeamsByKind(db, 'aff'),
  };
}

const { coalesceStageSql, resolveCompanyForRole } = require('../../lib/users');

const router = express.Router();

const ALLOWED_ROLES = ['teamlead', 'buyer', 'aff', 'admin'];

router.use(requireRole('admin'));

function getTeamleads(db) {
  return db
    .prepare(
      `SELECT id, ${coalesceStageSql()} AS stage FROM users WHERE role = 'teamlead' AND is_active = 1 ORDER BY ${coalesceStageSql()} ASC`
    )
    .all();
}

function roleBadgeClass(role) {
  const map = {
    admin: 'border-error/40 text-error',
    teamlead: 'border-info/40 text-info',
    buyer: 'border-primary/40 text-primary',
    aff: 'badge-new',
  };
  return map[role] || 'badge-ghost';
}

function validateUserFields(db, { stage, password, role, team_lead_id, team_id }, { isNew, userId }) {
  if (!stage || !stage.trim()) {
    return 'Enter stage';
  }

  if (isNew && (!password || !password.trim())) {
    return 'Enter password';
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return 'Invalid role';
  }

  const trimmedStage = stage.trim();
  const existing = db
    .prepare('SELECT id FROM users WHERE (stage = ? OR username = ?) AND id != ?')
    .get(trimmedStage, trimmedStage, userId || 0);

  if (existing) {
    return 'Stage already taken';
  }

  if (role === 'buyer') {
    if (!team_lead_id) {
      return 'Select a team lead for the buyer';
    }
    const teamlead = db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'teamlead' AND is_active = 1")
      .get(team_lead_id);
    if (!teamlead) {
      return 'Selected team lead not found';
    }
  }

  const teamCheck = validateTeamId(db, role, team_id);
  if (teamCheck.error) {
    return teamCheck.error;
  }

  return null;
}

router.get('/', (req, res) => {
  if (req.get('HX-Request') !== 'true') {
    return res.redirect('/?panel=users');
  }

  const db = getDb();
  res.render('partials/modals/users-shell', {
    users: db
      .prepare(`
        SELECT u.*,
          ${coalesceStageSql('tl')} AS team_lead_stage,
          ${coalesceStageSql('ta')} AS team_aff_stage,
          t.name AS team_name
        FROM users u
        LEFT JOIN users tl ON u.team_lead_id = tl.id
        LEFT JOIN users ta ON u.team_aff_id = ta.id
        LEFT JOIN teams t ON u.team_id = t.id
        ORDER BY u.is_active DESC, ${coalesceStageSql('u')} ASC
      `)
      .all(),
    error: req.query.error || null,
    currentUser: req.session.user,
  });
});

router.get('/new', (req, res) => {
  const db = getDb();
  res.render('admin/users/new', {
    title: 'New user',
    teamleads: getTeamleads(db),
    ...getTeamOptionsForForm(db),
    formUser: {},
    error: null,
  });
});

router.post('/', (req, res) => {
  const db = getDb();
  const { stage, password, role, team_lead_id, team_id, telegram_chat_id, company } = req.body;
  const trimmedStage = stage?.trim() || '';
  const formUser = { stage: trimmedStage, role, team_lead_id, team_id, telegram_chat_id, company };

  const error = validateUserFields(db, { stage: trimmedStage, password, role, team_lead_id, team_id }, { isNew: true });
  if (error) {
    return res.render('admin/users/new', {
      title: 'New user',
      teamleads: getTeamleads(db),
      ...getTeamOptionsForForm(db),
      formUser,
      error,
    });
  }

  const companyCheck = resolveCompanyForRole(role, company);
  if (companyCheck.error) {
    return res.render('admin/users/new', {
      title: 'New user',
      teamleads: getTeamleads(db),
      ...getTeamOptionsForForm(db),
      formUser,
      error: companyCheck.error,
    });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const resolvedTeamLeadId = role === 'buyer' ? Number(team_lead_id) : null;
  const teamCheck = validateTeamId(db, role, team_id);
  const chatId = telegram_chat_id?.trim() || null;

  db.prepare(`
    INSERT INTO users (username, stage, password_hash, role, team_lead_id, team_id, telegram_chat_id, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(trimmedStage, trimmedStage, passwordHash, role, resolvedTeamLeadId, teamCheck.teamId, chatId, companyCheck.company);

  res.redirect('/?panel=users');
});

router.get('/:id/edit', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

  if (!user) {
    return res.redirect('/?panel=users');
  }

  res.render('admin/users/edit', {
    title: 'Edit user',
    formUser: user,
    teamleads: getTeamleads(db),
    ...getTeamOptionsForForm(db),
    error: null,
  });
});

router.post('/:id', (req, res) => {
  const db = getDb();
  const userId = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user) {
    return res.redirect('/?panel=users');
  }

  const { stage, role, team_lead_id, team_id, telegram_chat_id, company } = req.body;
  const trimmedStage = stage?.trim() || '';
  const formUser = { ...user, stage: trimmedStage, role, team_lead_id, team_id, telegram_chat_id, company };

  const error = validateUserFields(
    db,
    { stage: trimmedStage, password: 'placeholder', role, team_lead_id, team_id },
    { isNew: false, userId }
  );

  if (error) {
    return res.render('admin/users/edit', {
      title: 'Edit user',
      formUser,
      teamleads: getTeamleads(db),
      ...getTeamOptionsForForm(db),
      error,
    });
  }

  const companyCheck = resolveCompanyForRole(role, company);
  if (companyCheck.error) {
    return res.render('admin/users/edit', {
      title: 'Edit user',
      formUser,
      teamleads: getTeamleads(db),
      ...getTeamOptionsForForm(db),
      error: companyCheck.error,
    });
  }

  const resolvedTeamLeadId = role === 'buyer' ? Number(team_lead_id) : null;
  const teamCheck = validateTeamId(db, role, team_id);
  const chatId = telegram_chat_id?.trim() || null;

  db.prepare(`
    UPDATE users
    SET username = ?, stage = ?, role = ?, team_lead_id = ?, team_id = ?, telegram_chat_id = ?, company = ?
    WHERE id = ?
  `).run(trimmedStage, trimmedStage, role, resolvedTeamLeadId, teamCheck.teamId, chatId, companyCheck.company, userId);

  if (req.session.user.id === userId) {
    req.session.user.username = trimmedStage;
    req.session.user.stage = trimmedStage;
    req.session.user.role = role;
  }

  res.redirect('/?panel=users');
});

router.post('/:id/delete', (req, res) => {
  const userId = Number(req.params.id);

  if (userId === req.session.user.id) {
    return res.redirect('/?panel=users&error=' + encodeURIComponent('You cannot deactivate yourself'));
  }

  const db = getDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
  res.redirect('/?panel=users');
});

router.post('/:id/restore', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(Number(req.params.id));
  res.redirect('/?panel=users');
});

module.exports = router;
