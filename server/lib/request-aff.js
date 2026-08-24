function isAffFieldsComplete(request) {
  if (!request) return false;

  const geo = (request.aff_geo || '').trim();
  const language = (request.aff_language || '').trim();
  const wh = (request.aff_wh || '').trim();
  const price = (request.aff_price || '').trim();
  const partner = (request.partner || '').trim();
  const qtyRaw = request.result_quantity ?? request.quantity;

  if (!geo || !language || !wh || !price || !partner) return false;
  if (qtyRaw === null || qtyRaw === undefined || String(qtyRaw).trim() === '') return false;

  const qty = Number(qtyRaw);
  return Number.isInteger(qty) && qty >= 0;
}

function canAffClaimRequest(request, user) {
  return (
    user &&
    user.role === 'aff' &&
    request &&
    request.status === 'new' &&
    !request.taken_by_id &&
    !request.split_from_id &&
    request.has_available_cap !== false
  );
}

function isSplitChildRequest(request) {
  return !!(request && request.split_from_id);
}

function canAffManageRequest(request, user) {
  return (
    user &&
    user.role === 'aff' &&
    request &&
    request.taken_by_id === user.id &&
    request.status === 'in_progress'
  );
}

function canAffReopenRequest(request, user) {
  return (
    user &&
    user.role === 'aff' &&
    request &&
    request.taken_by_id === user.id &&
    request.status === 'done'
  );
}

function getActiveAssignmentId(request) {
  return null;
}

module.exports = {
  isAffFieldsComplete,
  canAffClaimRequest,
  canAffManageRequest,
  canAffReopenRequest,
  isSplitChildRequest,
  getActiveAssignmentId,
};
