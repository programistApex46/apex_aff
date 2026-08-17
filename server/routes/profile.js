const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { getDb } = require('../db');
const { wantsPartial, wantsPageFrame } = require('../lib/http');
const { refreshSessionUser } = require('../lib/session-user');
const {
  getBotUsername,
  getBotUrl,
  getBindLink,
  createOrGetBindCode,
  refreshBindCode,
  unlinkTelegram,
} = require('../lib/telegram-bind');

const router = express.Router();

const AVATAR_DIR = path.join(__dirname, '../public/uploads/avatars');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: AVATAR_DIR,
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_EXT.has(ext) ? ext : '.jpg';
      cb(null, `${req.session.user.id}${safeExt}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_IMAGE'));
    }
  },
});

function profileViewData(req, extras = {}) {
  const db = getDb();
  const profile = getProfile(db, req.session.user.id);
  if (!profile) return null;

  const bindCode = profile.telegram_chat_id ? null : createOrGetBindCode(req.session.user.id);
  return {
    title: 'Profile',
    pageTitle: 'Profile',
    pageIcon: 'user',
    profile,
    passkeyCount: getPasskeyCount(db, req.session.user.id),
    telegramConnected: !!profile.telegram_chat_id,
    telegramBindLink: bindCode ? getBindLink(bindCode) : null,
    telegramBotUsername: getBotUsername(),
    telegramBotUrl: getBotUrl(),
    success: extras.success || req.query.success || null,
    error: extras.error || req.query.error || null,
  };
}

function profileRedirect(res, { success, error } = {}) {
  const params = new URLSearchParams();
  if (success) params.set('success', success);
  if (error) params.set('error', error);
  const query = params.toString();
  res.redirect('/profile' + (query ? `?${query}` : ''));
}

function profileRespond(req, res, payload = {}) {
  if (wantsPartial(req) || wantsPageFrame(req)) {
    const viewData = profileViewData(req, payload);
    if (!viewData) return res.redirect('/login');
    return res.render('profile/_page', viewData);
  }
  return profileRedirect(res, payload);
}

function getProfile(db, userId) {
  return db
    .prepare(
      'SELECT id, username, stage, email, role, avatar_path, telegram_chat_id FROM users WHERE id = ? AND is_active = 1'
    )
    .get(userId);
}

function getPasskeyCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(userId).n;
}

function removeAvatarFile(avatarPath) {
  if (!avatarPath || !avatarPath.startsWith('/uploads/avatars/')) return;
  const filePath = path.join(__dirname, '../public', avatarPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

router.get('/', (req, res) => {
  const viewData = profileViewData(req);
  if (!viewData) {
    return res.redirect('/login');
  }

  if (wantsPageFrame(req) || wantsPartial(req)) {
    return res.render('profile/_page', viewData);
  }

  res.render('profile/index', viewData);
});

router.post('/', (req, res) => {
  const db = getDb();
  const userId = req.session.user.id;
  const stage = (req.body.stage || '').trim();
  const email = (req.body.email || '').trim();

  if (!stage) {
    return profileRespond(req, res, { error: 'Enter a name (stage)' });
  }

  const existingStage = db
    .prepare('SELECT id FROM users WHERE (stage = ? OR username = ?) AND id != ?')
    .get(stage, stage, userId);
  if (existingStage) {
    return profileRespond(req, res, { error: 'That name is already taken' });
  }

  if (email) {
    const existingEmail = db
      .prepare('SELECT id FROM users WHERE email = ? AND email IS NOT NULL AND id != ?')
      .get(email, userId);
    if (existingEmail) {
      return profileRespond(req, res, { error: 'Email is already in use' });
    }
  }

  db.prepare('UPDATE users SET stage = ?, username = ?, email = ? WHERE id = ?').run(
    stage,
    stage,
    email || null,
    userId
  );

  refreshSessionUser(req, db);
  profileRespond(req, res, { success: 'profile' });
});

router.post('/password', (req, res) => {
  const db = getDb();
  const userId = req.session.user.id;
  const currentPassword = req.body.current_password || '';
  const newPassword = req.body.new_password || '';
  const confirmPassword = req.body.confirm_password || '';

  if (!currentPassword || !newPassword) {
    return profileRespond(req, res, { error: 'Fill in all password fields' });
  }

  if (newPassword.length < 6) {
    return profileRespond(req, res, { error: 'New password must be at least 6 characters' });
  }

  if (newPassword !== confirmPassword) {
    return profileRespond(req, res, { error: 'New passwords do not match' });
  }

  const user = db
    .prepare('SELECT password_hash FROM users WHERE id = ? AND is_active = 1')
    .get(userId);

  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return profileRespond(req, res, { error: 'Current password is incorrect' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);

  profileRespond(req, res, { success: 'password' });
});

router.post('/avatar', (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      const message =
        err.message === 'INVALID_IMAGE' ? 'Only image files are allowed' : 'Failed to upload file';
      return profileRespond(req, res, { error: message });
    }

    if (!req.file) {
      return profileRespond(req, res, { error: 'Choose a file' });
    }

    const db = getDb();
    const userId = req.session.user.id;
    const profile = getProfile(db, userId);
    const avatarPath = `/uploads/avatars/${req.file.filename}`;

    if (profile?.avatar_path && profile.avatar_path !== avatarPath) {
      removeAvatarFile(profile.avatar_path);
    }

    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(avatarPath, userId);
    refreshSessionUser(req, db);
    profileRespond(req, res, { success: 'avatar' });
  });
});

router.post('/avatar/remove', (req, res) => {
  const db = getDb();
  const userId = req.session.user.id;
  const profile = getProfile(db, userId);

  if (profile?.avatar_path) {
    removeAvatarFile(profile.avatar_path);
    db.prepare('UPDATE users SET avatar_path = NULL WHERE id = ?').run(userId);
    refreshSessionUser(req, db);
  }

  profileRespond(req, res, { success: 'avatar_removed' });
});

router.post('/telegram/refresh', (req, res) => {
  refreshBindCode(req.session.user.id);
  profileRespond(req, res, {});
});

router.post('/telegram/unlink', (req, res) => {
  unlinkTelegram(req.session.user.id);
  profileRespond(req, res, { success: 'telegram_reset' });
});

module.exports = router;
