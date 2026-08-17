const express = require('express');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
const { getDb } = require('../db');
const { HOME } = require('../lib/paths');
const { buildSessionUser } = require('../lib/session-user');

const router = express.Router();
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

function renderLogin(res, error) {
  res.render('login', {
    title: 'Sign in',
    error,
    googleClientId,
  });
}

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(HOME);
  }
  renderLogin(res, null);
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return renderLogin(res, 'Enter username and password');
  }

  const db = getDb();
  const user = db
    .prepare('SELECT id, username, stage, password_hash, role, is_active, avatar_path FROM users WHERE username = ? OR stage = ?')
    .get(username, username);

  if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
    return renderLogin(res, 'Invalid username or password');
  }

  req.session.user = buildSessionUser(user);

  res.redirect(HOME);
});

router.post('/auth/google', async (req, res) => {
  const { credential } = req.body || {};

  if (!googleClient || !googleClientId) {
    return res.status(503).json({
      success: false,
      error: 'Google sign-in is not configured',
    });
  }

  if (!credential) {
    return res.status(400).json({
      success: false,
      error: 'Missing Google credential',
    });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || payload.email_verified !== true) {
      return res.status(401).json({
        success: false,
        error: 'Google email is not verified',
      });
    }

    const db = getDb();
    const user = db
      .prepare('SELECT id, username, stage, role, is_active, avatar_path FROM users WHERE email = ?')
      .get(payload.email);

    if (!user) {
      return res.json({
        success: false,
        error: 'No user found with this email. Contact an administrator',
      });
    }

    if (!user.is_active) {
      return res.json({
        success: false,
        error: 'Account is deactivated. Contact an administrator',
      });
    }

    req.session.user = buildSessionUser(user);
    return res.json({ success: true });
  } catch (err) {
    console.error('auth/google:', err);
    return res.status(401).json({
      success: false,
      error: 'Could not verify Google sign-in, please try again',
    });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
