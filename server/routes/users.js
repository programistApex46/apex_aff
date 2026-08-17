const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db');
const { requireRole } = require('../middleware/auth');
const { getActiveTeamsByKind, validateTeamId, TEAM_ROLES } = require('../lib/teams');

const { userStage, STAGE_SQL, coalesceStageSql, USER_COMPANIES, resolveCompanyForRole } = require('../lib/users');

const ROLES = ['admin', 'teamlead', 'buyer', 'aff'];

const { wantsPartial, requirePartial } = require('../lib/http');

const router = express.Router();

function stageOrderSql(alias = 'u') {
  return coalesceStageSql(alias);
}

function getSessionTeamId(db, sessionUser) {
  if (sessionUser.role !== 'teamlead') return '';
  const row = db.prepare('SELECT team_id FROM users WHERE id = ?').get(sessionUser.id);
  return row?.team_id ? String(row.team_id) : '';
}

function getTeamOptionsForForm(db) {
  return {
    buyerTeams: getActiveTeamsByKind(db, 'buyer'),
    affTeams: getActiveTeamsByKind(db, 'aff'),
  };
}

function getTeamleads(db) {
  return db
    .prepare(
      `SELECT id, ${STAGE_SQL} AS stage FROM users WHERE role = 'teamlead' AND is_active = 1 ORDER BY ${STAGE_SQL} ASC`
    )
    .all();
}

function getUsersList(db, sessionUser) {
  if (sessionUser.role === 'teamlead') {
    return db
      .prepare(`
        SELECT u.*,
          ${coalesceStageSql('tl')} AS team_lead_stage,
          t.name AS team_name,
          COALESCE(u.company, tl.company) AS display_company
        FROM users u
        LEFT JOIN users tl ON u.team_lead_id = tl.id
        LEFT JOIN teams t ON u.team_id = t.id
        WHERE u.role = 'buyer' AND u.team_lead_id = ?
        ORDER BY u.is_active DESC, ${stageOrderSql('u')} ASC
      `)
      .all(sessionUser.id);
  }

  return db
    .prepare(`
      SELECT u.*,
        ${coalesceStageSql('tl')} AS team_lead_stage,
        t.name AS team_name,
        COALESCE(u.company, tl.company) AS display_company
      FROM users u
      LEFT JOIN users tl ON u.team_lead_id = tl.id
      LEFT JOIN teams t ON u.team_id = t.id
      ORDER BY u.is_active DESC, ${stageOrderSql('u')} ASC
    `)
    .all();
}

function getManagedUser(db, sessionUser, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  if (sessionUser.role === 'admin') return user;

  if (
    sessionUser.role === 'teamlead' &&
    user.role === 'buyer' &&
    user.team_lead_id === sessionUser.id
  ) {
    return user;
  }

  return null;
}

function renderUsersShell(res, sessionUser, options = {}) {
  const db = getDb();
  return res.render('partials/modals/users-shell', {
    users: getUsersList(db, sessionUser),
    error: options.error || null,
    success: options.success || null,
    currentUser: sessionUser,
    isTeamlead: sessionUser.role === 'teamlead',
    isAdmin: sessionUser.role === 'admin',
  });
}

function buildFormDefaults(db, sessionUser, overrides = {}) {
  const isTeamlead = sessionUser.role === 'teamlead';
  return {
    stage: '',
    username: '',
    email: '',
    telegram_chat_id: '',
    password: '',
    role: isTeamlead ? 'buyer' : 'buyer',
    team_lead_id: isTeamlead ? String(sessionUser.id) : '',
    team_id: isTeamlead ? getSessionTeamId(db, sessionUser) : '',
    company: '',
    ...overrides,
  };
}

function validateCreateUser(db, sessionUser, body) {
  const isTeamlead = sessionUser.role === 'teamlead';
  const isAdmin = sessionUser.role === 'admin';

  const form = buildFormDefaults(db, sessionUser, {
    stage: body.stage,
    email: body.email,
    telegram_chat_id: body.telegram_chat_id,
    password: body.password,
    role: isTeamlead ? 'buyer' : body.role,
    team_lead_id: isTeamlead ? String(sessionUser.id) : body.team_lead_id,
    team_id: isTeamlead ? getSessionTeamId(db, sessionUser) : body.team_id,
    company: body.company,
  });

  if (!form.stage?.trim()) {
    return { error: 'Enter stage', form };
  }

  if (!form.password?.trim()) {
    return { error: 'Enter password', form };
  }

  if (form.email?.trim()) {
    const existingEmail = db
      .prepare('SELECT id FROM users WHERE email = ? AND email IS NOT NULL')
      .get(form.email.trim());
    if (existingEmail) {
      return { error: 'Email already taken', form };
    }
  }

  const trimmedStage = form.stage.trim();
  const existingStage = db
    .prepare('SELECT id FROM users WHERE stage = ? OR username = ?')
    .get(trimmedStage, trimmedStage);
  if (existingStage) {
    return { error: 'Stage already taken', form };
  }

  if (!ROLES.includes(form.role)) {
    return { error: 'Invalid role', form };
  }

  if (isTeamlead && form.role !== 'buyer') {
    return { error: 'Team lead can only create buyers', form };
  }

  if (!isAdmin && form.role !== 'buyer') {
    return { error: 'Not allowed to create this role', form };
  }

  let teamLeadId = null;

  if (form.role === 'buyer') {
    teamLeadId = Number(form.team_lead_id);
    if (!teamLeadId) {
      return { error: 'Select team lead', form };
    }
    const teamlead = db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'teamlead' AND is_active = 1")
      .get(teamLeadId);
    if (!teamlead) {
      return { error: 'Selected team lead not found', form };
    }
    if (isTeamlead && teamLeadId !== sessionUser.id) {
      return { error: 'Team lead mismatch', form };
    }
  }

  const teamCheck = validateTeamId(db, form.role, form.team_id);
  if (teamCheck.error) {
    return { error: teamCheck.error, form };
  }

  if (isTeamlead && TEAM_ROLES.includes(form.role)) {
    const ownTeamId = getSessionTeamId(db, sessionUser);
    if (!ownTeamId) {
      return { error: 'Your account has no team assigned', form };
    }
    if (String(teamCheck.teamId) !== ownTeamId) {
      return { error: 'Team mismatch', form };
    }
  }

  const companyCheck = resolveCompanyForRole(form.role, form.company);
  if (companyCheck.error) {
    return { error: companyCheck.error, form };
  }

  return {
    error: null,
    form,
    data: {
      stage: trimmedStage,
      username: trimmedStage,
      email: form.email?.trim() || null,
      password: form.password,
      telegram_chat_id: form.telegram_chat_id?.trim() || null,
      role: form.role,
      team_lead_id: teamLeadId,
      team_id: teamCheck.teamId,
      company: companyCheck.company,
    },
  };
}

function validateUpdateUser(db, sessionUser, body, userId) {
  const isTeamlead = sessionUser.role === 'teamlead';
  const isAdmin = sessionUser.role === 'admin';

  const formUser = {
    stage: body.stage,
    email: body.email,
    telegram_chat_id: body.telegram_chat_id,
    password: body.password,
    role: isTeamlead ? 'buyer' : body.role,
    team_lead_id: isTeamlead ? body.team_lead_id : body.team_lead_id,
    team_id: isTeamlead ? getSessionTeamId(db, sessionUser) : body.team_id,
    company: body.company,
  };

  if (!formUser.stage?.trim()) {
    return { error: 'Enter stage', formUser };
  }

  if (formUser.email?.trim()) {
    const existingEmail = db
      .prepare('SELECT id FROM users WHERE email = ? AND email IS NOT NULL AND id != ?')
      .get(formUser.email.trim(), userId);
    if (existingEmail) {
      return { error: 'Email already taken', formUser };
    }
  }

  const trimmedStage = formUser.stage.trim();
  const existingStage = db
    .prepare('SELECT id FROM users WHERE (stage = ? OR username = ?) AND id != ?')
    .get(trimmedStage, trimmedStage, userId);
  if (existingStage) {
    return { error: 'Stage already taken', formUser };
  }

  if (!ROLES.includes(formUser.role)) {
    return { error: 'Invalid role', formUser };
  }

  if (isTeamlead && formUser.role !== 'buyer') {
    return { error: 'Team lead can only manage buyers', formUser };
  }

  if (!isAdmin && formUser.role !== 'buyer') {
    return { error: 'Not allowed to assign this role', formUser };
  }

  let teamLeadId = null;

  if (formUser.role === 'buyer') {
    teamLeadId = Number(formUser.team_lead_id);
    if (!teamLeadId) {
      return { error: 'Select team lead', formUser };
    }
    const teamlead = db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'teamlead' AND is_active = 1")
      .get(teamLeadId);
    if (!teamlead) {
      return { error: 'Selected team lead not found', formUser };
    }
    if (isTeamlead && teamLeadId !== sessionUser.id) {
      return { error: 'Team lead mismatch', formUser };
    }
  }

  const teamCheck = validateTeamId(db, formUser.role, formUser.team_id);
  if (teamCheck.error) {
    return { error: teamCheck.error, formUser };
  }

  if (isTeamlead && TEAM_ROLES.includes(formUser.role)) {
    const ownTeamId = getSessionTeamId(db, sessionUser);
    if (!ownTeamId) {
      return { error: 'Your account has no team assigned', formUser };
    }
    if (String(teamCheck.teamId) !== ownTeamId) {
      return { error: 'Team mismatch', formUser };
    }
  }

  const companyCheck = resolveCompanyForRole(formUser.role, formUser.company);
  if (companyCheck.error) {
    return { error: companyCheck.error, formUser };
  }

  return {
    error: null,
    formUser,
    data: {
      stage: trimmedStage,
      username: trimmedStage,
      email: formUser.email?.trim() || null,
      password: formUser.password?.trim() || null,
      telegram_chat_id: formUser.telegram_chat_id?.trim() || null,
      role: formUser.role,
      team_lead_id: teamLeadId,
      team_id: teamCheck.teamId,
      company: companyCheck.company,
    },
  };
}

function renderUserForm(res, options) {
  return res.render('partials/modals/user-form', options);
}

function renderUserEditForm(res, options) {
  return res.render('partials/modals/user-edit-form', options);
}

router.get('/modal', requireRole('admin', 'teamlead'), (req, res) => {
  if (!requirePartial(req, res, '/?panel=users')) return;

  return renderUsersShell(res, req.session.user, {
    error: req.query.error || null,
  });
});

router.get('/list-modal', requireRole('admin', 'teamlead'), (req, res) => {
  if (!requirePartial(req, res, '/?panel=users')) return;

  const db = getDb();
  const sessionUser = req.session.user;
  res.render('partials/modals/users-list', {
    users: getUsersList(db, sessionUser),
    error: req.query.error || null,
    isTeamlead: sessionUser.role === 'teamlead',
    isAdmin: sessionUser.role === 'admin',
  });
});

router.get('/new-modal', requireRole('admin', 'teamlead'), (req, res) => {
  if (!requirePartial(req, res, '/?panel=users-new')) return;

  const db = getDb();
  const sessionUser = req.session.user;

  renderUserForm(res, {
    form: buildFormDefaults(db, sessionUser),
    error: null,
    isTeamlead: sessionUser.role === 'teamlead',
    isAdmin: sessionUser.role === 'admin',
    teamleads: getTeamleads(db),
    ...getTeamOptionsForForm(db),
  });
});

router.get('/:id(\\d+)/edit-modal', requireRole('admin', 'teamlead'), (req, res) => {
  if (!requirePartial(req, res, '/?panel=users')) return;

  const db = getDb();
  const sessionUser = req.session.user;
  const userId = Number(req.params.id);
  const formUser = getManagedUser(db, sessionUser, userId);

  if (!formUser) {
    return res.status(403).render('403', { title: 'Access denied' });
  }

  renderUserEditForm(res, {
    formUser,
    error: null,
    isTeamlead: sessionUser.role === 'teamlead',
    isAdmin: sessionUser.role === 'admin',
    teamleads: getTeamleads(db),
    ...getTeamOptionsForForm(db),
  });
});

router.post('/', requireRole('admin', 'teamlead'), (req, res) => {
  const db = getDb();
  const sessionUser = req.session.user;
  const validation = validateCreateUser(db, sessionUser, req.body);

  if (validation.error) {
    if (!wantsPartial(req)) {
      return res.redirect('/?panel=users-new');
    }
    return renderUserForm(res, {
      form: validation.form,
      error: validation.error,
      isTeamlead: sessionUser.role === 'teamlead',
      isAdmin: sessionUser.role === 'admin',
      teamleads: getTeamleads(db),
      ...getTeamOptionsForForm(db),
    });
  }

  const { data } = validation;
  const passwordHash = bcrypt.hashSync(data.password, 10);

  db.prepare(`
    INSERT INTO users (username, stage, password_hash, role, email, telegram_chat_id, team_lead_id, team_id, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.username,
    data.stage,
    passwordHash,
    data.role,
    data.email,
    data.telegram_chat_id,
    data.team_lead_id,
    data.team_id,
    data.company
  );

  if (wantsPartial(req)) {
    return renderUsersShell(res, sessionUser, { success: 'User created' });
  }

  res.redirect('/?panel=users');
});

router.post('/:id(\\d+)/delete', requireRole('admin', 'teamlead'), (req, res) => {
  const db = getDb();
  const sessionUser = req.session.user;
  const userId = Number(req.params.id);
  const user = getManagedUser(db, sessionUser, userId);

  if (!user) {
    if (wantsPartial(req)) {
      return res.status(403).render('403', { title: 'Access denied' });
    }
    return res.redirect('/?panel=users');
  }

  if (userId === sessionUser.id) {
    return renderUsersShell(res, sessionUser, { error: 'You cannot deactivate yourself' });
  }

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);

  if (wantsPartial(req)) {
    return renderUsersShell(res, sessionUser, { success: 'User deactivated' });
  }

  res.redirect('/?panel=users');
});

router.post('/:id(\\d+)/restore', requireRole('admin', 'teamlead'), (req, res) => {
  const db = getDb();
  const sessionUser = req.session.user;
  const userId = Number(req.params.id);
  const user = getManagedUser(db, sessionUser, userId);

  if (!user) {
    if (wantsPartial(req)) {
      return res.status(403).render('403', { title: 'Access denied' });
    }
    return res.redirect('/?panel=users');
  }

  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(userId);

  if (wantsPartial(req)) {
    return renderUsersShell(res, sessionUser, { success: 'User restored' });
  }

  res.redirect('/?panel=users');
});

router.post('/:id(\\d+)', requireRole('admin', 'teamlead'), (req, res) => {
  const db = getDb();
  const sessionUser = req.session.user;
  const userId = Number(req.params.id);
  const existingUser = getManagedUser(db, sessionUser, userId);

  if (!existingUser) {
    if (wantsPartial(req)) {
      return res.status(403).render('403', { title: 'Access denied' });
    }
    return res.redirect('/?panel=users');
  }

  const validation = validateUpdateUser(db, sessionUser, req.body, userId);

  if (validation.error) {
    if (!wantsPartial(req)) {
      return res.redirect('/?panel=users');
    }
    return renderUserEditForm(res, {
      formUser: { ...existingUser, ...validation.formUser },
      error: validation.error,
      isTeamlead: sessionUser.role === 'teamlead',
      isAdmin: sessionUser.role === 'admin',
      teamleads: getTeamleads(db),
      ...getTeamOptionsForForm(db),
    });
  }

  const { data } = validation;

  if (data.password) {
    const passwordHash = bcrypt.hashSync(data.password, 10);
    db.prepare(`
      UPDATE users
      SET username = ?, stage = ?, email = ?, telegram_chat_id = ?, role = ?, team_lead_id = ?, team_id = ?, company = ?, password_hash = ?
      WHERE id = ?
    `).run(
      data.username,
      data.stage,
      data.email,
      data.telegram_chat_id,
      data.role,
      data.team_lead_id,
      data.team_id,
      data.company,
      passwordHash,
      userId
    );
  } else {
    db.prepare(`
      UPDATE users
      SET username = ?, stage = ?, email = ?, telegram_chat_id = ?, role = ?, team_lead_id = ?, team_id = ?, company = ?
      WHERE id = ?
    `).run(
      data.username,
      data.stage,
      data.email,
      data.telegram_chat_id,
      data.role,
      data.team_lead_id,
      data.team_id,
      data.company,
      userId
    );
  }

  if (wantsPartial(req)) {
    return renderUsersShell(res, sessionUser, { success: 'User updated' });
  }

  res.redirect('/?panel=users');
});

module.exports = router;
