function buildSessionUser(user) {
  return {
    id: user.id,
    username: user.username,
    stage: user.stage || user.username,
    role: user.role,
    avatar_path: user.avatar_path || null,
  };
}

function refreshSessionUser(req, db) {
  if (!req.session.user) return null;

  const user = db
    .prepare(
      'SELECT id, username, stage, role, avatar_path FROM users WHERE id = ? AND is_active = 1'
    )
    .get(req.session.user.id);

  if (!user) return null;

  req.session.user = buildSessionUser(user);
  return req.session.user;
}

module.exports = { buildSessionUser, refreshSessionUser };
