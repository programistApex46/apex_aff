const { getDb } = require('../db');
const { buildAffMobileNav } = require('../lib/aff-mobile-nav');
const { buildTlMobileNav } = require('../lib/tl-mobile-nav');

function setAffMobileNav(req, res, next) {
  res.locals.isRequestsPage = req.path === '/' || req.path === '/list';
  res.locals.isProfilePage = req.path === '/profile' || req.path.startsWith('/profile/');

  if (req.session.user?.role === 'aff') {
    const db = getDb();
    res.locals.affMobileNav = buildAffMobileNav(db, req.session.user, req.query);
  }

  if (req.session.user?.role === 'teamlead') {
    const db = getDb();
    res.locals.tlMobileNav = buildTlMobileNav(db, req.session.user, req.query);
  }

  next();
}

module.exports = { setAffMobileNav };
