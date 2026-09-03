const express = require('express');
const { getDb } = require('../db');
const { requireRole } = require('../middleware/auth');
const { notifyNewRequest, notifyRequestClaimed, notifyRequestReleased, notifyAssignmentDone } = require('../telegram');
const { GEO_CODES, isKnownGeo } = require('../lib/geos');
const { broadcast } = require('../sse');

const router = express.Router();

const COMMON_GEOS = GEO_CODES;
const REQUEST_STATUSES = ['draft', 'new', 'in_progress', 'done'];
const FILTER_STATUSES = ['open', 'draft', 'new', 'in_progress', 'approved', 'rejected'];

const { wantsPartial, wantsPageFrame, wantsQuizPartial, requirePartial } = require('../lib/http');
const {
  isAffFieldsComplete,
  canAffClaimRequest,
  canAffManageRequest,
  canAffReopenRequest,
  getActiveAssignmentId,
} = require('../lib/request-aff');
const {
  ensureAssignmentSchema,
  enrichRequestForUser,
  enrichRequests,
  nestRequestsForDisplay,
  collectMissingSplitTreeMemberIds,
  shouldAttachSplitTreeMembers,
  getSplitTreeMemberRequests,
  claimAssignment,
  parseCapTaken,
  cancelAssignment,
  updateAssignmentFields,
  completeAssignment,
  reopenAssignment,
  setRemainingCapOnCreate,
  applyQuantityEdit,
  aggregateResultStatus,
} = require('../lib/request-assignments');
const { parseRequestId, nextRootRequestId } = require('../lib/request-id');
const { buildTlMobileNav } = require('../lib/tl-mobile-nav');
const { buildAffMobileNav } = require('../lib/aff-mobile-nav');
const { HOME, REQUESTS_LIST } = require('../lib/paths');
const {
  getCardSortOptions,
  getPerPageOptions,
  parsePerPage,
  DEFAULT_PER_PAGE,
} = require('../lib/sort-options');

const CREATE_REQUEST_ROLES = ['buyer', 'teamlead'];

function resolveCreateBuyerId(user) {
  return user.id;
}

const REQUEST_SELECT = `
  SELECT r.*,
    COALESCE(buyer.stage, buyer.username) AS buyer_stage,
    COALESCE(buyer.company, tl.company) AS buyer_company,
    team.name AS buyer_team_name,
    COALESCE(aff.stage, aff.username) AS taken_by_stage,
    aff.avatar_path AS taken_by_avatar_path
  FROM requests r
  JOIN users buyer ON r.buyer_id = buyer.id
  LEFT JOIN users tl ON buyer.team_lead_id = tl.id
  LEFT JOIN teams team ON COALESCE(buyer.team_id, tl.team_id) = team.id
  LEFT JOIN users aff ON r.taken_by_id = aff.id
`;

const SORTABLE_COLUMNS = {
  id: 'r.id',
  created_at: 'r.created_at',
  company: 'COALESCE(buyer.company, tl.company)',
  team: 'team.name',
  stage: 'COALESCE(buyer.stage, buyer.username)',
  geo: 'r.geo',
  language: 'r.language',
  quantity: 'r.quantity',
  funnel: 'r.funnel',
  comment: 'r.comment',
  aff: 'COALESCE(aff.stage, aff.username)',
  partner: 'r.partner',
  aff_geo: 'r.aff_geo',
  aff_language: 'r.aff_language',
  aff_cap: 'r.result_quantity',
  aff_wh: 'r.aff_wh',
  aff_price: 'r.aff_price',
  aff_status: 'r.result_status',
};

function parseSort(query) {
  if (!query.sort || !SORTABLE_COLUMNS[query.sort]) {
    return { column: 'created_at', dir: 'desc', isDefault: true };
  }

  return {
    column: query.sort,
    dir: query.dir === 'asc' ? 'asc' : 'desc',
    isDefault: false,
  };
}

function getOrderByClause(sort) {
  const direction = sort.dir === 'asc' ? 'ASC' : 'DESC';

  if (sort.column === 'aff' || sort.column === 'stage') {
    const col = sort.column === 'stage'
      ? 'COALESCE(buyer.stage, buyer.username)'
      : 'COALESCE(aff.stage, aff.username)';
    if (sort.column === 'aff') {
      return `ORDER BY (${col} IS NULL) ${direction}, ${col} ${direction}`;
    }
    return `ORDER BY ${col} ${direction}`;
  }

  if (sort.column === 'partner') {
    return `ORDER BY (r.partner IS NULL OR r.partner = '') ${direction}, r.partner ${direction}`;
  }

  if (sort.column === 'aff_status') {
    return `ORDER BY (r.result_status IS NULL) ${direction}, r.result_status ${direction}`;
  }

  if (sort.column === 'team') {
    return `ORDER BY (team.name IS NULL) ${direction}, team.name ${direction}`;
  }

  if (sort.column === 'company') {
    return `ORDER BY (COALESCE(buyer.company, tl.company) IS NULL) ${direction}, COALESCE(buyer.company, tl.company) ${direction}`;
  }

  return `ORDER BY ${SORTABLE_COLUMNS[sort.column]} ${direction}`;
}

function appendQueryParams(params, { filters, sort, pagination }) {
  if (filters.status) params.set('status', filters.status);
  if (filters.geo) params.set('geo', filters.geo);
  if (filters.buyer_id) params.set('buyer_id', filters.buyer_id);
  if (filters.assigned) params.set('assigned', filters.assigned);
  if (filters.view) params.set('view', filters.view);
  if (!sort.isDefault) {
    params.set('sort', sort.column);
    params.set('dir', sort.dir);
  }
  if (pagination) {
    if (pagination.page > 1) params.set('page', String(pagination.page));
    if (pagination.perPage !== DEFAULT_PER_PAGE) {
      params.set('per_page', String(pagination.perPage));
    }
  }
}

function requestsListUrl(filters, sort, base = HOME, pagination = null) {
  const params = new URLSearchParams();
  appendQueryParams(params, { filters, sort, pagination });
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function sortToggleUrl(filters, sort, column, base = HOME, pagination = null) {
  const activeColumn = sort.isDefault ? 'created_at' : sort.column;
  const nextDir =
    column === activeColumn && sort.dir === 'asc' ? 'desc' : 'asc';

  return requestsListUrl(
    filters,
    { column, dir: nextDir, isDefault: false },
    base,
    pagination ? { ...pagination, page: 1 } : { page: 1, perPage: 50 }
  );
}

function isSortActive(sort, column) {
  if (sort.isDefault) return column === 'created_at';
  return sort.column === column;
}

function statusBadgeClass(status) {
  const map = {
    draft: 'badge-draft',
    new: 'badge-sent',
    in_progress: 'badge-progress',
    done: 'badge-done',
  };
  return map[status] || 'badge-sent';
}

function getBuyerDraft(db, buyerId) {
  return db
    .prepare(`${REQUEST_SELECT} WHERE r.buyer_id = ? AND r.status = 'draft' ORDER BY r.updated_at DESC LIMIT 1`)
    .get(buyerId);
}

function draftToForm(draft, commonGeos) {
  let geo = (draft.geo || '').trim().toUpperCase();
  let geo_other = '';

  if (geo && commonGeos && !commonGeos.includes(geo) && !isKnownGeo(geo)) {
    geo_other = geo;
  }

  return {
    draft_id: draft.id,
    geo,
    geo_other,
    quantity: draft.quantity > 0 ? draft.quantity : '',
    funnel: draft.funnel || '',
    comment: draft.comment || '',
    language: draft.language || '',
  };
}

function parseDraftFields({ geo, geo_other, quantity, funnel, comment, language }) {
  const resolvedGeo = geo === '__other__' ? (geo_other || '').trim() : (geo || '').trim();
  const qtyRaw = quantity !== undefined && quantity !== null && String(quantity).trim() !== ''
    ? Number(quantity)
    : 0;
  const qty = Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : 0;

  return {
    geo: resolvedGeo,
    quantity: qty,
    funnel: (funnel || '').trim() || null,
    comment: (comment || '').trim() || null,
    language: (language || '').trim() || null,
  };
}

function hasDraftContent(fields) {
  return !!(fields.geo || fields.quantity > 0 || fields.funnel || fields.comment || fields.language);
}

function parsePagination(query) {
  if (String(query.catalog) === '1') {
    return { page: 1, perPage: 1000, offset: 0 };
  }
  const perPage = parsePerPage(query.per_page);
  const page = Math.max(1, Number(query.page) || 1);
  return { page, perPage, offset: (page - 1) * perPage };
}

function buildRequestConditions(user, filters = {}) {
  const conditions = [];
  const params = [];

  if (user.role === 'buyer') {
    conditions.push('r.buyer_id = ?');
    params.push(user.id);
  } else if (user.role === 'teamlead') {
    conditions.push('(buyer.team_lead_id = ? OR r.buyer_id = ?)');
    params.push(user.id, user.id);
  } else if (user.role !== 'admin' && user.role !== 'aff') {
    conditions.push('1 = 0');
  }

  if (user.role === 'aff' || user.role === 'admin') {
    conditions.push("r.status != 'draft'");
  } else if (user.role === 'teamlead') {
    conditions.push("(r.status != 'draft' OR r.buyer_id = ?)");
    params.push(user.id);
  }

  if (filters.status === 'open') {
    if (user.role === 'buyer') {
      conditions.push("r.status IN ('draft', 'new', 'in_progress')");
    } else {
      conditions.push("r.status IN ('new', 'in_progress')");
    }
  } else if (filters.status === 'approved') {
    conditions.push("r.status = 'done' AND r.result_status = 'approved'");
  } else if (filters.status === 'rejected') {
    conditions.push("r.status = 'done' AND r.result_status = 'rejected'");
  } else if (filters.status) {
    conditions.push('r.status = ?');
    params.push(filters.status);
  }

  if (filters.geo) {
    conditions.push('r.geo = ?');
    params.push(filters.geo);
  }

  if (filters.buyer_id) {
    conditions.push('r.buyer_id = ?');
    params.push(Number(filters.buyer_id));
  }

  if (filters.assigned === 'none') {
    conditions.push("r.taken_by_id IS NULL AND r.status = 'new'");
  } else if (filters.assigned) {
    conditions.push('r.taken_by_id = ?');
    params.push(Number(filters.assigned));
  }

  if (filters.view === 'mine') {
    conditions.push("r.status IN ('new', 'in_progress')");
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

function applyPaginationScope(where, filters) {
  if (!shouldAttachSplitTreeMembers(filters)) return where;
  const clause = 'r.split_from_id IS NULL';
  return where ? `${where} AND ${clause}` : `WHERE ${clause}`;
}

function countRequestsForUser(db, user, filters = {}) {
  const { where, params } = buildRequestConditions(user, filters);
  const scopedWhere = applyPaginationScope(where, filters);
  return db
    .prepare(`
      SELECT COUNT(*) AS c
      FROM requests r
      JOIN users buyer ON r.buyer_id = buyer.id
      ${scopedWhere}
    `)
    .get(...params).c;
}

function getRequestsForUser(db, user, filters = {}, sort = parseSort({}), pagination = null) {
  const { where, params } = buildRequestConditions(user, filters);
  const scopedWhere = pagination ? applyPaginationScope(where, filters) : where;
  let sql = `${REQUEST_SELECT} ${scopedWhere} ${getOrderByClause(sort)}`;

  if (pagination) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(pagination.perPage, pagination.offset);
  }

  return db.prepare(sql).all(...params);
}

function parseFilters(query) {
  const status = FILTER_STATUSES.includes(query.status) ? query.status : '';
  const geo = typeof query.geo === 'string' ? query.geo.trim() : '';
  const buyer_id =
    query.buyer_id && /^\d+$/.test(String(query.buyer_id)) ? String(query.buyer_id) : '';
  const assigned =
    query.assigned === 'none' || (query.assigned && /^\d+$/.test(String(query.assigned)))
      ? String(query.assigned)
      : '';
  const view = query.view === 'all' || query.view === 'mine' ? query.view : '';

  return { status, geo, buyer_id, assigned, view };
}

function hasActiveFilters(filters) {
  return !!(
    filters.status ||
    filters.geo ||
    filters.buyer_id ||
    filters.assigned ||
    filters.view === 'mine'
  );
}

function sanitizeFilters(db, user, filters) {
  const options = getFilterOptions(db, user);
  const sanitized = { ...filters };

  if (sanitized.geo && !options.geos.includes(sanitized.geo)) {
    sanitized.geo = '';
  }

  if (sanitized.buyer_id && !options.buyers.some((b) => String(b.id) === sanitized.buyer_id)) {
    sanitized.buyer_id = '';
  }

  if (
    sanitized.assigned &&
    sanitized.assigned !== 'none' &&
    user.role !== 'aff' &&
    !options.affs.some((a) => String(a.id) === sanitized.assigned)
  ) {
    sanitized.assigned = '';
  }

  if (user.role === 'aff') {
    if (
      sanitized.assigned &&
      sanitized.assigned !== 'none' &&
      String(sanitized.assigned) !== String(user.id)
    ) {
      sanitized.assigned = '';
    }
  }

  return sanitized;
}

function getFilterOptions(db, user) {
  const requests = getRequestsForUser(db, user);
  const geos = [...new Set(requests.map((r) => r.geo))].sort();
  const buyers = [];
  const affs = [];
  const buyerIds = new Set();
  const affIds = new Set();

  for (const request of requests) {
    if (!buyerIds.has(request.buyer_id)) {
      buyerIds.add(request.buyer_id);
      buyers.push({ id: request.buyer_id, stage: request.buyer_stage });
    }

    if (request.taken_by_id && !affIds.has(request.taken_by_id)) {
      affIds.add(request.taken_by_id);
      affs.push({ id: request.taken_by_id, stage: request.taken_by_stage || '' });
    }
  }

  buyers.sort((a, b) => a.stage.localeCompare(b.stage));
  affs.sort((a, b) => a.stage.localeCompare(b.stage));

  return { geos, buyers, affs };
}

function mapRequestRow(db, id, user) {
  ensureAssignmentSchema(db);
  const row = db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id);
  if (!row) return null;
  const request = enrichRequestForUser(db, row, user);
  request.aggregate_result_status = aggregateResultStatus(request);
  return request;
}

function getSplitTreeForRender(db, id, user) {
  return getSplitTreeMemberRequests(db, id, (memberId) => mapRequestRow(db, memberId, user));
}

function getRequestById(db, id, user = null) {
  return mapRequestRow(db, id, user);
}

function canUserSeeRequest(db, user, request) {
  if (!request) return false;

  if (request.status === 'draft') {
    return (
      (user.role === 'buyer' || user.role === 'teamlead') &&
      request.buyer_id === user.id
    );
  }

  if (user.role === 'buyer') {
    return request.buyer_id === user.id;
  }

  if (user.role === 'teamlead') {
    const buyer = db.prepare('SELECT team_lead_id FROM users WHERE id = ?').get(request.buyer_id);
    return buyer && buyer.team_lead_id === user.id;
  }

  return user.role === 'aff' || user.role === 'admin';
}

function broadcastRequestUpdated(request) {
  const splitRootId = request.split_tree_root_id || request.split_root_id || request.id;
  broadcast(
    'request-updated',
    JSON.stringify({ id: request.id, splitRootId, status: request.status })
  );
}

function canCompleteRequest(request, user) {
  return canAffManageRequest(request, user) && isAffFieldsComplete(request);
}

function validateNewRequest({ geo, geo_other, quantity, funnel, comment, language }) {
  const resolvedGeo = geo === '__other__' ? (geo_other || '').trim() : (geo || '').trim();

  if (!resolvedGeo) {
    return { error: 'GEO is required' };
  }

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { error: 'Cap must be a whole number greater than 0' };
  }

  return {
    error: null,
    resolvedGeo,
    qty,
    funnel: (funnel || '').trim() || null,
    comment: (comment || '').trim() || null,
    language: (language || '').trim() || null,
  };
}

function normalizeResultStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function validateCompleteRequest(body) {
  const {
    result_quantity,
    aff_geo,
    aff_wh,
    aff_price,
    result_details,
  } = body;

  const result_status = normalizeResultStatus(body.result_status);

  const allowedStatuses = ['approved', 'rejected'];
  if (!allowedStatuses.includes(result_status)) {
    return { error: 'Select a status' };
  }

  if (result_status === 'rejected') {
    const qtyRaw =
      result_quantity !== undefined &&
      result_quantity !== null &&
      String(result_quantity).trim() !== ''
        ? Number(result_quantity)
        : null;
    const qty =
      qtyRaw === null
        ? null
        : Number.isInteger(qtyRaw) && qtyRaw >= 0
          ? qtyRaw
          : null;

    if (qtyRaw !== null && qty === null) {
      return { error: 'Cap must be a whole number from 0' };
    }

    return {
      error: null,
      result_status,
      result_quantity: qty,
      aff_geo: (aff_geo || '').trim() || null,
      aff_wh: (aff_wh || '').trim() || null,
      aff_price: (aff_price || '').trim() || null,
      result_details: (result_details || '').trim() || null,
    };
  }

  const qty = Number(result_quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    return { error: 'Cap must be a whole number from 0' };
  }

  const geo = (aff_geo || '').trim();
  if (!geo) {
    return { error: 'GEO is required' };
  }

  const wh = (aff_wh || '').trim();
  if (!wh) {
    return { error: 'Wh is required' };
  }

  const price = (aff_price || '').trim();
  if (!price) {
    return { error: 'Price is required' };
  }

  return {
    error: null,
    result_status,
    result_quantity: qty,
    aff_geo: geo,
    aff_wh: wh,
    aff_price: price,
    result_details: (result_details || '').trim() || null,
  };
}

function validateAffFields(body) {
  const qty = Number(body.result_quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    return { error: 'Cap must be a whole number from 0' };
  }

  const geo = (body.aff_geo || '').trim();
  if (!geo) {
    return { error: 'GEO is required' };
  }

  const language = (body.aff_language || '').trim();
  if (!language) {
    return { error: 'Language is required' };
  }

  const wh = (body.aff_wh || '').trim();
  if (!wh) {
    return { error: 'Wh is required' };
  }

  const price = (body.aff_price || '').trim();
  if (!price) {
    return { error: 'Price is required' };
  }

  const partner = (body.partner || '').trim();
  if (!partner) {
    return { error: 'Partner is required' };
  }

  return {
    error: null,
    aff_geo: geo,
    aff_language: (body.aff_language || '').trim() || null,
    aff_wh: wh,
    aff_price: price,
    partner,
    result_quantity: qty,
  };
}

function renderRow(res, { request, user, error, oob, insertIds }) {
  return res.render('partials/request-rows', {
    request,
    insertIds: insertIds || [],
    user,
    error: error || null,
    statusBadgeClass,
    oob: oob || false,
  });
}

function renderRows(res, { requests, user, error, oob, removeIds, insertIds }) {
  const nested = nestRequestsForDisplay(requests);
  return res.render('partials/htmx-oob-rows', {
    requests: nested,
    removeIds: removeIds || [],
    insertIds: insertIds || [],
    user,
    error: error || null,
    statusBadgeClass,
    oob: oob || false,
  });
}

function buildSplitOobRequests(rows, ids) {
  const idSet = new Set((ids || []).map((id) => String(id)));
  return rows.filter((row) => idSet.has(String(row.id)));
}

const LIST_PARTIAL_PATH = REQUESTS_LIST;

function getRequestsByIds(db, user, ids) {
  if (!ids.length) return [];
  const { where, params } = buildRequestConditions(user, {});
  const placeholders = ids.map(() => '?').join(', ');
  const extraWhere = where ? `${where} AND r.id IN (${placeholders})` : `WHERE r.id IN (${placeholders})`;
  return db.prepare(`${REQUEST_SELECT} ${extraWhere}`).all(...params, ...ids);
}

function buildRequestsListViewData(req) {
  const db = getDb();
  const user = req.session.user;
  const sort = parseSort(req.query);
  const filters = sanitizeFilters(db, user, parseFilters(req.query));
  const parsedPagination = parsePagination(req.query);
  const filteredCount = countRequestsForUser(db, user, filters);
  const totalPages = Math.max(1, Math.ceil(filteredCount / parsedPagination.perPage));
  const page = Math.min(parsedPagination.page, totalPages);
  const pagination = {
    page,
    perPage: parsedPagination.perPage,
    totalPages,
    totalCount: filteredCount,
    offset: (page - 1) * parsedPagination.perPage,
  };
  let rows = getRequestsForUser(db, user, filters, sort, pagination);
  const missingSplitIds = collectMissingSplitTreeMemberIds(db, rows, filters);
  if (missingSplitIds.length) {
    const extras = getRequestsByIds(db, user, missingSplitIds);
    const seen = new Set(rows.map((row) => row.id));
    for (const row of extras) {
      if (!seen.has(row.id)) {
        rows.push(row);
        seen.add(row.id);
      }
    }
  }
  const enriched = enrichRequests(
    db,
    rows,
    user
  ).map((request) => ({
    ...request,
    aggregate_result_status: aggregateResultStatus(request),
  }));
  const requests = nestRequestsForDisplay(enriched);
  const totalAllCount = countRequestsForUser(db, user, {});

  const paginationForUrl = { page: pagination.page, perPage: pagination.perPage };

  return {
    title: 'Requests',
    user,
    requests,
    totalCount: totalAllCount,
    filteredCount,
    filters,
    filterOptions: getFilterOptions(db, user),
    hasActiveFilters: hasActiveFilters(filters),
    sort,
    pagination,
    sortToggleUrl: (column) => sortToggleUrl(filters, sort, column, HOME, paginationForUrl),
    sortToggleListUrl: (column) =>
      sortToggleUrl(filters, sort, column, LIST_PARTIAL_PATH, paginationForUrl),
    paginationUrl: (targetPage) =>
      requestsListUrl(filters, sort, HOME, { ...paginationForUrl, page: targetPage }),
    paginationListUrl: (targetPage) =>
      requestsListUrl(filters, sort, LIST_PARTIAL_PATH, { ...paginationForUrl, page: targetPage }),
    isSortActive: (column) => isSortActive(sort, column),
    clearListUrl: requestsListUrl({}, sort, LIST_PARTIAL_PATH),
    cardSortOptions: getCardSortOptions(user.role),
    perPageOptions: getPerPageOptions(),
    statusBadgeClass,
  };
}

function renderRequestsListPartial(req, res) {
  const viewData = buildRequestsListViewData(req);
  if (String(req.query.catalog) !== '1') {
    res.set(
      'HX-Push-Url',
      requestsListUrl(viewData.filters, viewData.sort, HOME, {
        page: viewData.pagination.page,
        perPage: viewData.pagination.perPage,
      })
    );
  }
  return res.render('requests/_main', viewData);
}

router.get('/list', (req, res) => renderRequestsListPartial(req, res));

router.get('/aff-nav', requireRole('aff'), (req, res) => {
  const db = getDb();

  return res.render('partials/aff-mobile-nav', {
    affMobileNav: buildAffMobileNav(db, req.session.user, req.query),
    isRequestsPage: true,
  });
});

router.get('/tl-nav', requireRole('teamlead'), (req, res) => {
  const db = getDb();

  return res.render('partials/tl-mobile-nav', {
    tlMobileNav: buildTlMobileNav(db, req.session.user, req.query),
    user: req.session.user,
    isRequestsPage: true,
  });
});

router.get('/', (req, res) => {
  const viewData = buildRequestsListViewData(req);

  if (wantsPageFrame(req)) {
    return res.render('requests/_page', viewData);
  }

  if (wantsPartial(req)) {
    return res.render('requests/_main', viewData);
  }

  res.render('requests/index', viewData);
});

router.get('/new', requireRole(...CREATE_REQUEST_ROLES), (req, res) => {
  if (!wantsPartial(req)) {
    return res.redirect(HOME + '?new=1');
  }

  const db = getDb();
  const buyerId = resolveCreateBuyerId(req.session.user);
  const draft = getBuyerDraft(db, buyerId);
  const form = draft ? draftToForm(draft, COMMON_GEOS) : {};

  return res.render('partials/modals/request-create', {
    commonGeos: COMMON_GEOS,
    form,
    error: null,
    user: req.session.user,
    isDraft: !!draft,
    quizOnly: wantsQuizPartial(req),
  });
});

router.post('/', requireRole(...CREATE_REQUEST_ROLES), (req, res) => {
  const db = getDb();
  const buyerId = resolveCreateBuyerId(req.session.user);
  const isDraft = req.body.intent === 'draft' || req.body.status === 'draft';
  const draftId = req.body.draft_id ? Number(req.body.draft_id) : null;
  const { geo, geo_other, quantity, funnel, comment, language } = req.body;
  const form = { draft_id: draftId || '', geo, geo_other, quantity, funnel, comment, language };

  if (isDraft) {
    const fields = parseDraftFields({ geo, geo_other, quantity, funnel, comment, language });

    if (!hasDraftContent(fields)) {
      if (wantsPartial(req)) {
        return res.status(204).end();
      }
      return res.redirect(HOME);
    }

    let existingDraft = draftId
      ? db.prepare("SELECT id FROM requests WHERE id = ? AND buyer_id = ? AND status = 'draft'").get(draftId, buyerId)
      : null;

    if (!existingDraft) {
      existingDraft = getBuyerDraft(db, buyerId);
    }

    if (existingDraft) {
      db.prepare(`
        UPDATE requests
        SET geo = ?, language = ?, quantity = ?, funnel = ?, comment = ?, remaining_cap = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND buyer_id = ? AND status = 'draft'
      `).run(
        fields.geo || '',
        fields.language,
        fields.quantity,
        fields.funnel,
        fields.comment,
        fields.quantity,
        existingDraft.id,
        buyerId
      );
    } else {
      const draftRequestId = nextRootRequestId(db);
      db.prepare(`
        INSERT INTO requests (id, buyer_id, geo, language, quantity, funnel, comment, status, remaining_cap)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
      `).run(
        draftRequestId,
        buyerId,
        fields.geo || '',
        fields.language,
        fields.quantity,
        fields.funnel,
        fields.comment,
        fields.quantity
      );
      setRemainingCapOnCreate(db, draftRequestId, fields.quantity);
    }

    if (wantsPartial(req)) {
      return res.status(204).end();
    }
    return res.redirect('/');
  }

  const validation = validateNewRequest({ geo, geo_other, quantity, funnel, comment, language });
  if (validation.error) {
    const viewData = {
      commonGeos: COMMON_GEOS,
      form,
      error: validation.error,
      user: req.session.user,
      isDraft: false,
    };
    if (wantsPartial(req)) {
      viewData.quizOnly = wantsQuizPartial(req);
      return res.status(422).render('partials/modals/request-create', viewData);
    }
    return res.redirect(HOME + '?new=1');
  }

  let requestId;

  if (draftId) {
    const updated = db
      .prepare(`
        UPDATE requests
        SET geo = ?, language = ?, quantity = ?, funnel = ?, comment = ?, status = 'new', remaining_cap = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND buyer_id = ? AND status = 'draft'
      `)
      .run(
        validation.resolvedGeo,
        validation.language,
        validation.qty,
        validation.funnel,
        validation.comment,
        validation.qty,
        draftId,
        buyerId
      );

    if (updated.changes === 0) {
      const viewData = {
        commonGeos: COMMON_GEOS,
        form,
        error: 'Draft not found',
        user: req.session.user,
        isDraft: false,
      };
      if (wantsPartial(req)) {
        viewData.quizOnly = wantsQuizPartial(req);
        return res.status(422).render('partials/modals/request-create', viewData);
      }
      return res.redirect(HOME + '?new=1');
    }
    requestId = draftId;
  } else {
    requestId = nextRootRequestId(db);
    db.prepare(`
        INSERT INTO requests (id, buyer_id, geo, language, quantity, funnel, comment, status, remaining_cap)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)
      `)
      .run(
        requestId,
        buyerId,
        validation.resolvedGeo,
        validation.language,
        validation.qty,
        validation.funnel,
        validation.comment,
        validation.qty
      );
  }

  setRemainingCapOnCreate(db, requestId, validation.qty);

  const request = getRequestById(db, requestId, req.session.user);
  notifyNewRequest(request);
  broadcastRequestUpdated(request);

  if (wantsPartial(req)) {
    res.set('HX-Trigger', 'modal-close, requests-refresh');
    return res.status(204).end();
  }

  res.redirect(HOME);
});

router.get('/:id/row', (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const requestId = parseRequestId(req.params.id);
  const request = getRequestById(db, requestId, user);

  if (!request) {
    return res.status(404).end();
  }

  if (!canUserSeeRequest(db, user, request)) {
    return res.status(403).end();
  }

  const requests = getSplitTreeForRender(db, requestId, user);
  if (requests.length <= 1) {
    return renderRow(res, { request: requests[0] || request, user, oob: true });
  }

  return renderRows(res, { requests, user, oob: true });
});

router.get('/:id/take-modal', requireRole('aff'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const request = getRequestById(db, parseRequestId(req.params.id), user);

  if (!canAffClaimRequest(request, user)) {
    return res.status(403).end();
  }

  res.render('partials/modals/request-take', {
    request,
    form: { cap_taken: request.available_leads ?? request.quantity },
    error: null,
  });
});

router.post('/:id/take', requireRole('aff'), (req, res) => {
  const db = getDb();
  const requestId = parseRequestId(req.params.id);
  const user = req.session.user;
  const requestBefore = getRequestById(db, requestId, user);

  if (!canAffClaimRequest(requestBefore, user)) {
    const request = getRequestById(db, requestId, user);
    return renderRow(res, {
      request,
      user,
      error: 'Request is not available to take',
      oob: true,
    });
  }

  const capTakenRaw = req.body.cap_taken ?? requestBefore.quantity;
  const capTaken = parseCapTaken(capTakenRaw);
  if (capTaken === null) {
    if (wantsPartial(req) && req.headers['hx-request']) {
      res.set('HX-Retarget', '#modal-body');
      res.set('HX-Reswap', 'innerHTML');
      return res.render('partials/modals/request-take', {
        request: requestBefore,
        form: { cap_taken: capTakenRaw },
        error: 'Enter a whole number greater than 0',
      });
    }
    return renderRow(res, {
      request: requestBefore,
      user,
      error: 'Enter a whole number greater than 0',
      oob: true,
    });
  }

  const result = claimAssignment(db, requestId, user.id, capTaken);

  if (!result.ok) {
    if (wantsPartial(req) && req.headers['hx-request']) {
      res.set('HX-Retarget', '#modal-body');
      res.set('HX-Reswap', 'innerHTML');
      return res.render('partials/modals/request-take', {
        request: requestBefore,
        form: { cap_taken: capTaken },
        error: result.error,
      });
    }
    return renderRow(res, {
      request: requestBefore,
      user,
      error: result.error,
      oob: true,
    });
  }

  const request = getRequestById(db, result.requestId ?? requestId, user);
  const childRequest = result.remainderRequestId
    ? getRequestById(db, result.remainderRequestId, user)
    : null;

  notifyRequestClaimed(request || requestBefore, user, result, childRequest);
  broadcastRequestUpdated(request || requestBefore);
  if (childRequest) {
    broadcastRequestUpdated(childRequest);
  }

  const rootId = result.rootId || requestId;
  const rows = getSplitTreeForRender(db, rootId, user);
  const insertIds = [];
  if (childRequest) insertIds.push(childRequest.id);
  if (result.poolChildCreated && result.poolChildId) insertIds.push(result.poolChildId);
  const removeIds = result.removedPoolChildIds || [];
  const oobIds = [rootId];
  if (childRequest) oobIds.push(childRequest.id);
  if (result.poolChildId) oobIds.push(result.poolChildId);
  const oobRequests = buildSplitOobRequests(rows, oobIds);

  if (wantsPartial(req)) {
    res.set('HX-Trigger', 'modal-close');
    return renderRows(res, { requests: oobRequests, insertIds, removeIds, user, oob: true });
  }

  return renderRows(res, {
    requests: oobRequests,
    insertIds,
    removeIds,
    user,
    oob: true,
  });
});

router.get('/:id/release-modal', requireRole('aff'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const request = getRequestById(db, parseRequestId(req.params.id), user);

  if (!canAffManageRequest(request, user)) {
    return res.status(403).end();
  }

  res.render('partials/modals/request-release', {
    request,
    error: null,
  });
});

router.post('/:id/release', requireRole('aff'), (req, res) => {
  const db = getDb();
  const requestId = parseRequestId(req.params.id);
  const user = req.session.user;
  const request = getRequestById(db, requestId, user);

  if (!canAffManageRequest(request, user)) {
    return res.status(403).end();
  }

  const result = cancelAssignment(db, requestId, user.id);

  if (!result.ok) {
    const updated = getRequestById(db, requestId, user);
    if (wantsPartial(req)) {
      res.set('HX-Retarget', '#modal-body');
      res.set('HX-Reswap', 'innerHTML');
      return res.render('partials/modals/request-release', {
        request: updated || request,
        error: result.error || 'Cannot release this request',
      });
    }
    return renderRow(res, {
      request: updated || request,
      user,
      error: result.error || 'Cannot release this request',
      oob: true,
    });
  }

  notifyRequestReleased(request, user);

  const rows = getSplitTreeForRender(db, result.rootId || requestId, user);
  const removeIds = result.deleted ? [requestId] : [];
  const insertIds = result.poolChildCreated && result.poolChildId ? [result.poolChildId] : [];
  const oobIds = [result.rootId || requestId];
  if (result.poolChildId) oobIds.push(result.poolChildId);
  if (!result.deleted) oobIds.push(requestId);
  const oobRequests = buildSplitOobRequests(rows, oobIds);

  if (rows.length) {
    broadcastRequestUpdated(rows[0]);
  }

  if (wantsPartial(req)) {
    res.set('HX-Trigger', 'modal-close');
  }

  return renderRows(res, { requests: oobRequests, insertIds, removeIds, user, oob: true });
});

router.get('/:id/complete', requireRole('aff'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const request = getRequestById(db, parseRequestId(req.params.id), user);

  if (!canCompleteRequest(request, user)) {
    return res.status(403).render('403', { title: 'Access denied' });
  }

  res.render('requests/complete', {
    title: 'Submit result',
    request,
    form: {},
    error: null,
  });
});

router.post('/:id/complete', requireRole('aff'), (req, res) => {
  const db = getDb();
  const requestId = parseRequestId(req.params.id);
  const user = req.session.user;
  const request = getRequestById(db, requestId, user);

  if (!canCompleteRequest(request, user)) {
    return res.status(403).render('403', { title: 'Access denied' });
  }

  const {
    result_status,
    result_quantity,
    aff_geo,
    aff_wh,
    aff_price,
    result_details,
  } = req.body;
  const form = { result_status, result_quantity, aff_geo, aff_wh, aff_price, result_details };

  const validation = validateCompleteRequest(req.body);
  if (validation.error) {
    if (wantsPartial(req)) {
      res.set('HX-Retarget', '#modal-body');
      res.set('HX-Reswap', 'innerHTML');
      return res.render('partials/modals/request-complete', {
        request,
        form,
        error: validation.error,
      });
    }
    return res.render('requests/complete', {
      title: 'Submit result',
      request,
      form,
      error: validation.error,
    });
  }

  if (
    validation.result_quantity !== null &&
    validation.result_quantity > request.quantity
  ) {
    const capError = `Cap cannot exceed request quantity (${request.quantity})`;
    if (wantsPartial(req)) {
      res.set('HX-Retarget', '#modal-body');
      res.set('HX-Reswap', 'innerHTML');
      return res.render('partials/modals/request-complete', {
        request,
        form,
        error: capError,
      });
    }
    return res.render('requests/complete', {
      title: 'Submit result',
      request,
      form,
      error: capError,
    });
  }

  const result = completeAssignment(db, requestId, user.id, validation);

  if (!result.ok) {
    if (wantsPartial(req)) {
      res.set('HX-Retarget', '#modal-body');
      res.set('HX-Reswap', 'innerHTML');
      return res.render('partials/modals/request-complete', {
        request: getRequestById(db, requestId, user),
        form,
        error: result.error,
      });
    }
    return res.render('requests/complete', {
      title: 'Submit result',
      request: getRequestById(db, requestId, user),
      form,
      error: result.error,
    });
  }

  const updated = getRequestById(db, requestId, user);
  notifyAssignmentDone(updated);
  broadcastRequestUpdated(updated);
  if (result.rootClosedId) {
    const root = getRequestById(db, result.rootClosedId, user);
    if (root) broadcastRequestUpdated(root);
  }

  const rows = getSplitTreeForRender(db, result.rootId || requestId, user);
  const oobIds = [requestId];
  if (result.rootId && String(result.rootId) !== String(requestId)) {
    oobIds.push(result.rootId);
  }
  if (result.rootClosedId) {
    oobIds.push(result.rootClosedId);
  }
  const oobRequests = buildSplitOobRequests(rows, oobIds);

  if (wantsPartial(req)) {
    res.set('HX-Trigger', 'modal-close');
    return renderRows(res, { requests: oobRequests, user, oob: true });
  }

  res.redirect(HOME);
});

router.get('/:id/aff-edit-modal', requireRole('aff'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const request = getRequestById(db, parseRequestId(req.params.id), user);

  if (!canAffManageRequest(request, user)) {
    return res.status(403).end();
  }

  res.render('partials/modals/request-aff-edit', {
    request,
    form: {
      aff_geo: request.aff_geo || request.geo || '',
      aff_language: request.aff_language || request.language || '',
      partner: request.partner || '',
      result_quantity: request.result_quantity ?? request.quantity ?? '',
      aff_wh: request.aff_wh || '',
      aff_price: request.aff_price || '',
    },
    error: null,
  });
});

router.post('/:id/aff-fields', requireRole('aff'), (req, res) => {
  const db = getDb();
  const requestId = parseRequestId(req.params.id);
  const user = req.session.user;
  const request = getRequestById(db, requestId, user);

  if (!canAffManageRequest(request, user)) {
    return res.status(403).end();
  }

  const form = {
    aff_geo: req.body.aff_geo || '',
    aff_language: req.body.aff_language || '',
    result_quantity: req.body.result_quantity ?? '',
    aff_wh: req.body.aff_wh || '',
    aff_price: req.body.aff_price || '',
    partner: req.body.partner || '',
  };

  const validation = validateAffFields(form);
  if (validation.error) {
    res.set('HX-Retarget', '#modal-body');
    res.set('HX-Reswap', 'innerHTML');
    return res.render('partials/modals/request-aff-edit', {
      request,
      form,
      error: validation.error,
    });
  }

  const qty = Number(validation.result_quantity);
  if (request.split_from_id && qty !== Number(request.quantity)) {
    res.set('HX-Retarget', '#modal-body');
    res.set('HX-Reswap', 'innerHTML');
    return res.render('partials/modals/request-aff-edit', {
      request,
      form,
      error: 'Cap cannot be changed on a split task',
    });
  }
  if (qty > request.quantity) {
    res.set('HX-Retarget', '#modal-body');
    res.set('HX-Reswap', 'innerHTML');
    return res.render('partials/modals/request-aff-edit', {
      request,
      form,
      error: `Cap cannot exceed request quantity (${request.quantity})`,
    });
  }

  const result = updateAssignmentFields(db, requestId, user.id, validation);
  if (!result.ok) {
    res.set('HX-Retarget', '#modal-body');
    res.set('HX-Reswap', 'innerHTML');
    return res.render('partials/modals/request-aff-edit', {
      request,
      form,
      error: result.error,
    });
  }

  const updated = getRequestById(db, requestId, user);
  const rootRequest = result.rootId && result.rootId !== requestId
    ? getRequestById(db, result.rootId, user)
    : null;

  broadcastRequestUpdated(updated);
  if (rootRequest) broadcastRequestUpdated(rootRequest);

  const rows = getSplitTreeForRender(db, result.rootId || requestId, user);
  const oobIds = [requestId];
  if (result.rootId && String(result.rootId) !== String(requestId)) {
    oobIds.push(result.rootId);
  }
  const oobRequests = buildSplitOobRequests(rows, oobIds);

  if (wantsPartial(req)) {
    res.set('HX-Trigger', 'modal-close');
    return renderRows(res, { requests: oobRequests, user, oob: true });
  }

  res.redirect(HOME);
});

router.get('/:id/complete-modal', requireRole('aff'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const request = getRequestById(db, parseRequestId(req.params.id), user);

  if (!canCompleteRequest(request, user)) {
    return res.status(403).end();
  }

  res.render('partials/modals/request-complete', {
    request,
    form: {
      result_status: request.result_status || '',
      result_details: request.result_details || '',
      aff_geo: request.aff_geo || '',
      result_quantity: request.result_quantity ?? request.quantity ?? '',
      aff_wh: request.aff_wh || '',
      aff_price: request.aff_price || '',
    },
    error: null,
  });
});

router.get('/:id/reopen-modal', requireRole('aff'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const request = getRequestById(db, parseRequestId(req.params.id), user);

  if (!canAffReopenRequest(request, user)) {
    return res.status(403).end();
  }

  res.render('partials/modals/request-reopen', {
    request,
    error: null,
  });
});

router.post('/:id/reopen', requireRole('aff'), (req, res) => {
  const db = getDb();
  const requestId = parseRequestId(req.params.id);
  const user = req.session.user;
  const request = getRequestById(db, requestId, user);

  if (!canAffReopenRequest(request, user)) {
    return res.status(403).end();
  }

  const result = reopenAssignment(db, requestId, user.id);
  const updated = getRequestById(db, requestId, user);

  if (!result.ok) {
    if (wantsPartial(req)) {
      res.set('HX-Retarget', '#modal-body');
      res.set('HX-Reswap', 'innerHTML');
      return res.render('partials/modals/request-reopen', {
        request: updated || request,
        error: result.error || 'Cannot reopen this request',
      });
    }
    return res.status(403).end();
  }

  broadcastRequestUpdated(updated);

  const rows = getSplitTreeForRender(db, result.rootId || requestId, user);
  const oobIds = [requestId];
  if (result.rootId && String(result.rootId) !== String(requestId)) {
    oobIds.push(result.rootId);
  }
  const oobRequests = buildSplitOobRequests(rows, oobIds);

  if (wantsPartial(req)) {
    res.set('HX-Trigger', 'modal-close');
    return renderRows(res, { requests: oobRequests, user, oob: true });
  }

  return renderRows(res, { requests: oobRequests, user, oob: true });
});

module.exports = router;
