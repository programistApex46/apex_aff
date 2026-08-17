function htmxTarget(req) {
  return String(req.get('HX-Target') || '').replace(/^#/, '');
}

function wantsPartial(req) {
  return req.get('HX-Request') === 'true' || !!req.get('HX-Target');
}

function wantsPageFrame(req) {
  return htmxTarget(req) === 'rh-page';
}

function wantsQuizPartial(req) {
  return htmxTarget(req) === 'request-quiz-body' || req.get('X-RH-Quiz') === '1';
}

function requirePartial(req, res, redirectTo = '/') {
  if (!wantsPartial(req)) {
    res.redirect(redirectTo);
    return false;
  }
  return true;
}

module.exports = { htmxTarget, wantsPartial, wantsPageFrame, wantsQuizPartial, requirePartial };
