const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { userStage } = require('../lib/users');
const { getRpId, getOrigin } = require('../lib/webauthn-config');
const { buildSessionUser } = require('../lib/session-user');

const router = express.Router();
const RP_NAME = 'Request Hub';

function findUserByLogin(db, login) {
  return db
    .prepare(
      'SELECT id, username, stage, role, is_active FROM users WHERE username = ? OR stage = ?'
    )
    .get(login, login);
}

router.get('/register-options', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = db
      .prepare('SELECT id, username, stage, role FROM users WHERE id = ?')
      .get(req.session.user.id);

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const existing = db
      .prepare('SELECT credential_id FROM passkeys WHERE user_id = ?')
      .all(user.id);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(req),
      userName: user.username,
      userDisplayName: userStage(user),
      userID: new TextEncoder().encode(String(user.id)),
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existing.map((row) => ({
        id: row.credential_id,
      })),
    });

    req.session.webauthnRegisterChallenge = options.challenge;
    return res.json(options);
  } catch (err) {
    console.error('webauthn register-options:', err);
    return res.status(500).json({ error: 'Could not start passkey registration' });
  }
});

router.post('/register', requireAuth, async (req, res) => {
  const expectedChallenge = req.session.webauthnRegisterChallenge;
  delete req.session.webauthnRegisterChallenge;

  if (!expectedChallenge) {
    return res.status(400).json({ error: 'Registration session expired, try again' });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey registration could not be verified' });
    }

    const { credential } = verification.registrationInfo;
    const db = getDb();

    db.prepare(
      `INSERT INTO passkeys (user_id, credential_id, public_key, counter)
       VALUES (?, ?, ?, ?)`
    ).run(
      req.session.user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('webauthn register:', err);
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'This passkey is already linked' });
    }
    return res.status(400).json({ error: 'Passkey registration failed' });
  }
});

router.post('/login-options', async (req, res) => {
  const { username } = req.body || {};

  if (!username || !String(username).trim()) {
    return res.status(400).json({ error: 'Enter your stage' });
  }

  try {
    const db = getDb();
    const user = findUserByLogin(db, String(username).trim());

    if (!user || !user.is_active) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    const passkeys = db
      .prepare('SELECT credential_id FROM passkeys WHERE user_id = ?')
      .all(user.id);

    if (passkeys.length === 0) {
      return res.status(404).json({ error: 'No passkeys linked for this account' });
    }

    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      allowCredentials: passkeys.map((row) => ({
        id: row.credential_id,
        type: 'public-key',
        transports: ['internal', 'hybrid'],
      })),
      userVerification: 'preferred',
    });

    req.session.webauthnLoginChallenge = options.challenge;
    req.session.webauthnLoginUserId = user.id;

    return res.json(options);
  } catch (err) {
    console.error('webauthn login-options:', err);
    return res.status(500).json({ error: 'Could not start passkey login' });
  }
});

router.post('/login', async (req, res) => {
  const expectedChallenge = req.session.webauthnLoginChallenge;
  const expectedUserId = req.session.webauthnLoginUserId;
  delete req.session.webauthnLoginChallenge;
  delete req.session.webauthnLoginUserId;

  if (!expectedChallenge || !expectedUserId) {
    return res.status(401).json({
      error: 'Could not verify Face ID / Touch ID. Try again or sign in with your password',
    });
  }

  try {
    const db = getDb();
    const passkey = db
      .prepare('SELECT * FROM passkeys WHERE credential_id = ?')
      .get(req.body.id);

    if (!passkey || passkey.user_id !== expectedUserId) {
      return res.status(401).json({
        error: 'Could not verify Face ID / Touch ID. Try again or sign in with your password',
      });
    }

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, 'base64'),
        counter: passkey.counter,
      },
    });

    if (!verification.verified) {
      return res.status(401).json({
        error: 'Could not verify Face ID / Touch ID. Try again or sign in with your password',
      });
    }

    db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(
      verification.authenticationInfo.newCounter,
      passkey.id
    );

    const user = db
      .prepare('SELECT id, username, stage, role, is_active, avatar_path FROM users WHERE id = ?')
      .get(passkey.user_id);

    if (!user || !user.is_active) {
      return res.status(401).json({
        error: 'Could not verify Face ID / Touch ID. Try again or sign in with your password',
      });
    }

    req.session.user = buildSessionUser(user);
    return res.json({ ok: true, redirect: '/app' });
  } catch (err) {
    console.error('webauthn login:', err);
    return res.status(401).json({
      error: 'Could not verify Face ID / Touch ID. Try again or sign in with your password',
    });
  }
});

module.exports = router;
