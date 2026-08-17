function setUserLocals(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).render('403', { title: 'Access denied' });
    }
    next();
  };
}

module.exports = { setUserLocals, requireAuth, requireRole };
