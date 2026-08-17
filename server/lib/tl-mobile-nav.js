function parseViewFromQuery(query) {
  const view = query?.view;
  if (view === 'all' || view === 'mine') return view;
  return '';
}

function getTlNavActive(view) {
  return view === 'mine' ? 'mine' : 'all';
}

function getTlOpenCount(db, teamLeadId) {
  return db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM requests r
      JOIN users buyer ON r.buyer_id = buyer.id
      WHERE (buyer.team_lead_id = ? OR r.buyer_id = ?)
        AND r.status IN ('new', 'in_progress')
    `)
    .get(teamLeadId, teamLeadId).count;
}

function buildTlMobileNav(db, user, query = {}) {
  const view = parseViewFromQuery(query);

  return {
    active: getTlNavActive(view),
    myCount: getTlOpenCount(db, user.id),
  };
}

module.exports = {
  parseViewFromQuery,
  getTlNavActive,
  getTlOpenCount,
  buildTlMobileNav,
};
