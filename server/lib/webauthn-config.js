function getRpId(req) {
  if (process.env.WEBAUTHN_RP_ID) {
    return process.env.WEBAUTHN_RP_ID;
  }
  const host = req.get('host') || 'localhost:3000';
  return host.split(':')[0];
}

function getOrigin(req) {
  if (process.env.WEBAUTHN_ORIGIN) {
    return process.env.WEBAUTHN_ORIGIN;
  }
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host') || 'localhost:3000'}`;
}

module.exports = { getRpId, getOrigin };
