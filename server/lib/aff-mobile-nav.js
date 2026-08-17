function parseAssignedFromQuery(query) {
  const assigned = query?.assigned;
  if (assigned === 'none') return 'none';
  if (assigned && /^\d+$/.test(String(assigned))) return String(assigned);
  return '';
}

function getAffMobileNavActive(assigned, userId) {
  if (assigned === 'none') return 'available';
  if (assigned === String(userId)) return 'mine';
  return 'all';
}

function getAffOpenCount(db, userId) {
  return db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM requests
      WHERE taken_by_id = ? AND status = 'in_progress'
    `)
    .get(userId).count;
}

function getAffUnassignedCount(db) {
  return db
    .prepare(`
      SELECT COUNT(*) AS count FROM requests
      WHERE taken_by_id IS NULL AND status = 'new'
    `)
    .get().count;
}

function buildAffMobileNav(db, user, query = {}) {
  const assigned = parseAssignedFromQuery(query);

  return {
    active: getAffMobileNavActive(assigned, user.id),
    myCount: getAffOpenCount(db, user.id),
    unassignedCount: getAffUnassignedCount(db),
    userId: user.id,
  };
}

module.exports = {
  parseAssignedFromQuery,
  getAffMobileNavActive,
  getAffOpenCount,
  getAffUnassignedCount,
  buildAffMobileNav,
};
