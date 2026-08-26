function parseRequestId(raw) {
  if (raw === null || raw === undefined) return '';
  try {
    return decodeURIComponent(String(raw).trim());
  } catch (_err) {
    return String(raw).trim();
  }
}

function requestDomSlug(id) {
  return String(id).replace(/\//g, '--');
}

function requestIdFromDomSlug(slug) {
  return String(slug).replace(/--/g, '/');
}

function encodeRequestPath(id) {
  return encodeURIComponent(String(id));
}

function formatRequestDisplayId(request) {
  if (!request) return '';
  if (request.id !== null && request.id !== undefined && String(request.id) !== '') {
    return String(request.id);
  }
  return '';
}

function nextRootRequestId(db) {
  const row = db
    .prepare(`
      SELECT MAX(CAST(id AS INTEGER)) AS max_id
      FROM requests
      WHERE instr(id, '/') = 0
    `)
    .get();
  return String(Number(row?.max_id || 0) + 1);
}

function compareRequestIds(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (!sa.includes('/') && !sb.includes('/') && /^\d+$/.test(sa) && /^\d+$/.test(sb)) {
    return Number(sa) - Number(sb);
  }
  return sa.localeCompare(sb, undefined, { numeric: true });
}

function compareSplitRequestRows(a, b, rootId) {
  const aId = a?.id ?? a;
  const bId = b?.id ?? b;
  if (String(aId) === String(rootId)) return -1;
  if (String(bId) === String(rootId)) return 1;
  const partDiff = Number(a?.split_part ?? 0) - Number(b?.split_part ?? 0);
  if (partDiff !== 0) return partDiff;
  return compareRequestIds(aId, bId);
}

function requestsUseTextIds(db) {
  const col = db.pragma('table_info(requests)').find((c) => c.name === 'id');
  return !!(col && String(col.type).toUpperCase() === 'TEXT');
}

module.exports = {
  parseRequestId,
  requestDomSlug,
  requestIdFromDomSlug,
  encodeRequestPath,
  formatRequestDisplayId,
  nextRootRequestId,
  requestsUseTextIds,
  compareRequestIds,
  compareSplitRequestRows,
};
