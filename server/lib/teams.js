const TEAM_ROLES = ['teamlead', 'buyer', 'aff'];
const TEAM_KINDS = ['buyer', 'aff'];

function teamKindForRole(role) {
  if (role === 'aff') return 'aff';
  if (role === 'teamlead' || role === 'buyer') return 'buyer';
  return null;
}

function getActiveTeamsByKind(db, kind) {
  return db
    .prepare('SELECT id, name, kind FROM teams WHERE is_active = 1 AND kind = ? ORDER BY name ASC')
    .all(kind);
}

function getActiveTeams(db, role) {
  const kind = teamKindForRole(role);
  if (!kind) return [];
  return getActiveTeamsByKind(db, kind);
}

function validateTeamId(db, role, teamIdRaw) {
  const expectedKind = teamKindForRole(role);
  if (!expectedKind) {
    return { teamId: null, error: null };
  }

  const teamId = Number(teamIdRaw);
  if (!teamId) {
    return { teamId: null, error: 'Select team' };
  }

  const team = db
    .prepare('SELECT id, kind FROM teams WHERE id = ? AND is_active = 1')
    .get(teamId);
  if (!team) {
    return { teamId: null, error: 'Selected team not found' };
  }

  if (team.kind !== expectedKind) {
    return { teamId: null, error: 'Selected team does not match role' };
  }

  return { teamId, error: null };
}

function memberCountSql(alias = 't') {
  return `(SELECT COUNT(*) FROM users u
    WHERE u.team_id = ${alias}.id
      AND u.is_active = 1
      AND (
        (${alias}.kind = 'buyer' AND u.role IN ('teamlead', 'buyer'))
        OR (${alias}.kind = 'aff' AND u.role = 'aff')
      ))`;
}

module.exports = {
  TEAM_ROLES,
  TEAM_KINDS,
  teamKindForRole,
  getActiveTeams,
  getActiveTeamsByKind,
  validateTeamId,
  memberCountSql,
};
