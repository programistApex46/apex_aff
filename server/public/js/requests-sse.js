(function () {
  if (window.__rhRequestsSseBound) {
    if (typeof window.initRequestsList === 'function') window.initRequestsList();
    return;
  }
  window.__rhRequestsSseBound = true;

  function requestDomSlug(id) {
    return window.rhRequestDomSlug(id);
  }

  function requestRowElement(id) {
    return document.getElementById('request-row-' + requestDomSlug(id));
  }

  function requestCardElement(id) {
    return document.getElementById('request-card-' + requestDomSlug(id));
  }

  function isMobile() {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  function isMobileFiltersOpen() {
    return document.body.classList.contains('rh-mobile-filters-open');
  }

  function currentUrl() {
    return window.location.pathname + window.location.search;
  }

  function urlFromParams(params) {
    var qs = params.toString();
    return window.location.pathname + (qs ? '?' + qs : '');
  }

  function usesDeskCatalog() {
    return !!document.getElementById('rh-desk-slider');
  }

  function readListPage() {
    var params = new URLSearchParams(window.location.search);
    return Math.max(1, Number(params.get('page')) || 1);
  }

  var paginatedRefreshTimer = null;
  var paginationReloadAttempts = 0;
  var MAX_PAGINATION_RELOADS = 2;
  var pendingListMutations = 0;

  function isListMutationForm(form) {
    if (!form || !form.action) return false;
    try {
      var parts = new URL(form.action, window.location.origin).pathname.split('/').filter(Boolean);
      var action = parts[parts.length - 1];
      return action === 'take' || action === 'complete' || action === 'release' || action === 'reopen';
    } catch (_err) {
      return false;
    }
  }

  function splitRootForId(id) {
    var value = String(id || '');
    var slash = value.indexOf('/');
    return slash === -1 ? value : value.slice(0, slash);
  }

  function splitRootFromForm(form) {
    if (!form || !form.action) return '';
    try {
      var parts = new URL(form.action, window.location.origin).pathname.split('/').filter(Boolean);
      if (parts.length < 2) return '';
      return splitRootForId(decodeURIComponent(parts[parts.length - 2]));
    } catch (_err) {
      return '';
    }
  }

  function afterListMutationSettled(form) {
    if (afterListMutationSettled._frame) {
      cancelAnimationFrame(afterListMutationSettled._frame);
    }
    afterListMutationSettled._frame = requestAnimationFrame(function () {
      afterListMutationSettled._frame = 0;
      if (typeof window.rhQueueSplitReunify === 'function') {
        window.rhQueueSplitReunify();
      } else if (typeof window.rhReunifySplitGroups === 'function') {
        window.rhReunifySplitGroups();
      }

      var rootId = splitRootFromForm(form);
      if (rootId && typeof window.rhQueueSplitFolderSync === 'function') {
        window.rhQueueSplitFolderSync(rootId);
      }

      var action = '';
      var requestId = '';
      try {
        var parts = new URL(form.action, window.location.origin).pathname.split('/').filter(Boolean);
        action = parts[parts.length - 1] || '';
        if (parts.length >= 2) requestId = decodeURIComponent(parts[parts.length - 2]);
      } catch (_err) {}

      if (typeof window.rhDesksSyncClones === 'function') {
        if (action === 'take') {
          window.rhDesksSyncClones();
        } else {
          var dataIds = [];
          if (requestId) dataIds.push(requestId);
          if (rootId && rootId !== requestId) dataIds.push(rootId);
          if (dataIds.length) {
            window.rhDesksSyncClones({ incremental: true, dataIds: dataIds });
          } else {
            window.rhDesksSyncClones();
          }
        }
      }

      refreshMobileNav();
    });
  }

  function reloadListFromUrl(params) {
    if (usesDeskCatalog()) {
      applyFiltersToLists();
      return;
    }

    if (typeof window.setRequestsListLoading === 'function') {
      window.setRequestsListLoading(true);
    }

    window.__rhAwaitingListSwap = true;

    if (!params) params = new URLSearchParams(window.location.search);
    var qs = params.toString();
    if (typeof htmx !== 'undefined' && document.getElementById('requests-main')) {
      htmx.ajax('GET', '/list' + (qs ? '?' + qs : ''), {
        target: '#requests-main',
        swap: 'innerHTML',
      });
      return;
    }
    window.__rhAwaitingListSwap = false;
    window.location.assign(urlFromParams(params));
  }

  function schedulePaginatedListRefresh() {
    if (usesDeskCatalog()) return;
    if (readListPage() !== 1) return;

    clearTimeout(paginatedRefreshTimer);
    paginatedRefreshTimer = setTimeout(function () {
      reloadListFromUrl();
    }, 350);
  }

  function defaultPerPageForViewport() {
    return isMobile() ? 25 : 50;
  }

  function readListPerPage() {
    var params = new URLSearchParams(window.location.search);
    var value = Number(params.get('per_page'));
    if ([10, 25, 50, 100].indexOf(value) !== -1) return value;
    return defaultPerPageForViewport();
  }

  function domExceedsPagination() {
    if (usesDeskCatalog()) return false;

    var perPage = readListPerPage();
    var tbody = document.getElementById('requests-body');
    var cards = document.getElementById('requests-cards-mobile');

    if (tbody) {
      var tbodyPerPage = Number(tbody.dataset.rhPerPage);
      var tbodyParentCount = Number(tbody.dataset.rhParentCount);
      if (tbodyPerPage === perPage && tbodyParentCount > 0) {
        if (tbodyParentCount > perPage) return true;
      } else {
        var topLevelRows = tbody.querySelectorAll('tr:not([data-is-subtask="1"])').length;
        if (topLevelRows > perPage) return true;
      }
    }

    if (cards) {
      var cardsPerPage = Number(cards.dataset.rhPerPage);
      var cardsParentCount = Number(cards.dataset.rhParentCount);
      if (cardsPerPage === perPage && cardsParentCount > 0) {
        if (cardsParentCount > perPage) return true;
      } else {
        var topLevelCards = cards.querySelectorAll('.rh-request-card:not([data-is-subtask="1"])').length;
        if (topLevelCards > perPage) return true;
      }
    }

    return false;
  }

  function pushParams(mutator) {
    var params = new URLSearchParams(window.location.search);
    mutator(params);
    var next = urlFromParams(params);
    if (next === currentUrl()) return false;
    history.pushState({ rhFilters: true }, '', next);
    return true;
  }

  function navigateWithParams(mutator) {
    var params = new URLSearchParams(window.location.search);
    mutator(params);
    window.location.assign(urlFromParams(params));
  }

  function ensurePerPageInUrl() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('per_page')) return false;

    params.set('per_page', String(defaultPerPageForViewport()));
    params.set('page', '1');
    history.replaceState({}, '', urlFromParams(params));
    return true;
  }

  function usesDeskNav() {
    return document.body.classList.contains('rh-aff-user') || document.body.classList.contains('rh-tl-user');
  }

  function readDeskFiltersFromUrl() {
    if (typeof window.rhDeskFiltersForKey === 'function') {
      var key =
        typeof window.rhDeskKeyFromUrl === 'function' ? window.rhDeskKeyFromUrl() : 'all';
      return window.rhDeskFiltersForKey(key);
    }

    var params = new URLSearchParams(window.location.search);
    return {
      assigned: params.get('assigned') || '',
      view: params.get('view') === 'mine' ? 'mine' : '',
    };
  }

  function readMenuFilters() {
    var params = new URLSearchParams(window.location.search);
    var form = document.getElementById('requests-filters');
    var statusField = form && form.querySelector('[name="status"]');
    var geoField = form && form.querySelector('[name="geo"]');
    var buyerField = form && form.querySelector('[name="buyer_id"]');
    var assignedField = form && form.querySelector('[name="assigned"]');

    var filters = {
      status: statusField ? statusField.value : params.get('status') || '',
      geo: geoField ? geoField.value : params.get('geo') || '',
      buyer_id: buyerField ? buyerField.value : params.get('buyer_id') || '',
      assigned: '',
    };

    if (assignedField) {
      filters.assigned = assignedField.value || '';
    } else {
      filters.assigned = params.get('assigned') || '';
    }

    return filters;
  }

  function readFilters() {
    var menu = readMenuFilters();
    var desk = readDeskFiltersFromUrl();
    var assigned = menu.assigned || '';
    if (!assigned && document.body.classList.contains('rh-aff-user') && usesDeskNav() && isMobile()) {
      assigned = desk.assigned || '';
    }
    return {
      status: menu.status || '',
      geo: menu.geo || '',
      buyer_id: menu.buyer_id || '',
      assigned: assigned,
      view: desk.view || '',
    };
  }

  function readFiltersFromForm() {
    return readMenuFilters();
  }

  function readSort() {
    var params = new URLSearchParams(window.location.search);
    if (!params.get('sort')) {
      return { column: 'created_at', dir: 'desc' };
    }
    return {
      column: params.get('sort'),
      dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
    };
  }

  function hasActiveMenuFilters(filters) {
    filters = filters || readMenuFilters();
    return !!(filters.status || filters.geo || filters.buyer_id || filters.assigned);
  }

  function hasActiveFilters(filters) {
    filters = filters || readFilters();
    return hasActiveMenuFilters(readMenuFilters()) || filters.view === 'mine';
  }

  function rowMatchesSearch(row, query) {
    if (!query) return true;

    var haystack = [
      row.dataset.id,
      row.dataset.displayId,
      row.dataset.status,
      row.dataset.stage,
      row.dataset.company,
      row.dataset.team,
      row.dataset.geo,
      row.dataset.language,
      row.dataset.quantity,
      row.dataset.remainingCap,
      row.dataset.funnel,
      row.dataset.comment,
      row.dataset.aff,
      row.dataset.partner,
      row.dataset.affGeo,
      row.dataset.affLanguage,
      row.dataset.affCap,
      row.dataset.affWh,
      row.dataset.affPrice,
      row.dataset.affStatus,
      row.dataset.aggregateResult,
      row.dataset.assignmentAffIds,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.indexOf(query) !== -1;
  }

  function aggregateResultForRow(row) {
    return row.dataset.aggregateResult || row.dataset.affStatus || '';
  }

  function rowMatchesApprovedFilter(row) {
    if (row.dataset.status !== 'done') return false;
    var agg = aggregateResultForRow(row);
    return agg === 'approved';
  }

  function rowMatchesRejectedFilter(row) {
    if (row.dataset.status !== 'done') return false;
    var agg = aggregateResultForRow(row);
    return agg === 'rejected';
  }

  function getSearchQuery() {
    var inputs = document.querySelectorAll('.rh-requests-search-input');
    for (var i = 0; i < inputs.length; i++) {
      var value = inputs[i].value.trim().toLowerCase();
      if (value) return value;
    }
    return '';
  }

  function hasActiveSearch() {
    return !!getSearchQuery();
  }

  function rowMatchesFilters(row, filters) {
    if (filters.status === 'open') {
      if (!['draft', 'new', 'in_progress'].includes(row.dataset.status)) return false;
    } else if (filters.status === 'approved') {
      if (!rowMatchesApprovedFilter(row)) return false;
    } else if (filters.status === 'rejected') {
      if (!rowMatchesRejectedFilter(row)) return false;
    } else if (filters.status && row.dataset.status !== filters.status) {
      return false;
    }
    if (filters.geo && row.dataset.geo !== filters.geo) return false;
    if (filters.buyer_id && row.dataset.buyerId !== filters.buyer_id) return false;
    if (filters.assigned === 'none') {
      if (row.dataset.status !== 'new' || row.dataset.assignedId) return false;
    } else if (filters.assigned && filters.assigned !== 'none') {
      var assignedFilter = String(filters.assigned);
      var affIds = (row.dataset.assignmentAffIds || '')
        .split(',')
        .map(function (id) { return id.trim(); })
        .filter(Boolean);
      if (row.dataset.assignedId !== assignedFilter && affIds.indexOf(assignedFilter) === -1) {
        return false;
      }
    }
    if (filters.view === 'mine' && !['new', 'in_progress'].includes(row.dataset.status)) {
      return false;
    }
    return true;
  }

  function rowSortValue(row, column) {
    switch (column) {
      case 'id': {
        var displayId = row.dataset.displayId || '';
        if (displayId.indexOf('/') !== -1) {
          var idParts = displayId.split('/');
          return Number(idParts[0]) + Number(idParts[1] || 0) / 1000;
        }
        return Number(row.dataset.id);
      }
      case 'stage':
        return (row.dataset.stage || '').toLowerCase();
      case 'company':
        return (row.dataset.company || '').toLowerCase();
      case 'team':
        return (row.dataset.team || '').toLowerCase();
      case 'geo':
        return (row.dataset.geo || '').toLowerCase();
      case 'language':
        return (row.dataset.language || '').toLowerCase();
      case 'quantity':
        return Number(row.dataset.quantity);
      case 'cap_agreed':
        return Number(row.dataset.capAgreed || 0);
      case 'funnel':
        return (row.dataset.funnel || '').toLowerCase();
      case 'comment':
        return (row.dataset.comment || '').toLowerCase();
      case 'aff':
        return row.dataset.assignedId ? (row.dataset.aff || '').toLowerCase() : null;
      case 'partner':
        return (row.dataset.partner || '').toLowerCase();
      case 'aff_geo':
        return (row.dataset.affGeo || row.dataset.geo || '').toLowerCase();
      case 'aff_language':
        return (row.dataset.affLanguage || '').toLowerCase();
      case 'aff_cap':
        return row.dataset.affCap === '' ? Number(row.dataset.quantity) : Number(row.dataset.affCap);
      case 'aff_wh':
        return (row.dataset.affWh || '').toLowerCase();
      case 'aff_price':
        return (row.dataset.affPrice || '').toLowerCase();
      case 'aff_status':
        return row.dataset.affStatus ? row.dataset.affStatus.toLowerCase() : null;
      case 'created_at':
        return row.dataset.created || '';
      default:
        return '';
    }
  }

  function compareRows(a, b, sort) {
    var mul = sort.dir === 'asc' ? 1 : -1;
    var av = rowSortValue(a, sort.column);
    var bv = rowSortValue(b, sort.column);

    if (sort.column === 'aff' || sort.column === 'partner' || sort.column === 'aff_status' || sort.column === 'aff_cap') {
      var aEmpty = av === null || av === '';
      var bEmpty = bv === null || bv === '';
      if (aEmpty !== bEmpty) {
        return (aEmpty ? 1 : -1) * mul;
      }
      if (aEmpty) return Number(a.dataset.id) - Number(b.dataset.id);
    }

    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * mul;
    }

    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return Number(a.dataset.id) - Number(b.dataset.id);
  }

  function splitItemPart(item) {
    var part = Number(item.getAttribute('data-split-part'));
    if (Number.isFinite(part) && part > 0) return part;
    var id = String(item.getAttribute('data-id') || '');
    var slash = id.lastIndexOf('/');
    if (slash === -1) return 0;
    var tail = Number(id.slice(slash + 1));
    return Number.isFinite(tail) ? tail : 0;
  }

  function compareSplitItems(a, b) {
    var partDiff = splitItemPart(a) - splitItemPart(b);
    if (partDiff !== 0) return partDiff;
    var aId = String(a.getAttribute('data-id') || '');
    var bId = String(b.getAttribute('data-id') || '');
    if (!aId.includes('/') && !bId.includes('/') && /^\d+$/.test(aId) && /^\d+$/.test(bId)) {
      return Number(aId) - Number(bId);
    }
    return aId.localeCompare(bId, undefined, { numeric: true });
  }

  function groupSplitRowItems(items) {
    var byId = new Map();
    items.forEach(function (item) {
      byId.set(String(item.getAttribute('data-id') || ''), item);
    });

    var placed = new Set();
    var groups = [];
    var childRootIds = new Set();

    items.forEach(function (item) {
      if (item.getAttribute('data-is-subtask') !== '1') return;
      var rootId = String(item.getAttribute('data-split-root') || '');
      if (rootId) childRootIds.add(rootId);
    });

    function appendSplitGroup(rootItem) {
      var rootId = String(rootItem.getAttribute('data-id') || '');
      if (!rootId || placed.has(rootId)) return;

      var group = [rootItem];
      placed.add(rootId);

      var children = items.filter(function (item) {
        var id = String(item.getAttribute('data-id') || '');
        return (
          !placed.has(id)
          && item.getAttribute('data-is-subtask') === '1'
          && String(item.getAttribute('data-split-root') || '') === rootId
        );
      });
      children.sort(compareSplitItems);
      children.forEach(function (child) {
        group.push(child);
        placed.add(String(child.getAttribute('data-id') || ''));
      });

      groups.push(group);
    }

    items.forEach(function (item) {
      var id = String(item.getAttribute('data-id') || '');
      if (placed.has(id)) return;

      if (item.getAttribute('data-is-subtask') === '1') {
        var rootId = String(item.getAttribute('data-split-root') || '');
        var root = rootId ? byId.get(rootId) : null;
        if (root) {
          appendSplitGroup(root);
          return;
        }
      }

      if (
        item.getAttribute('data-is-split-root') === '1'
        || childRootIds.has(id)
      ) {
        appendSplitGroup(item);
        return;
      }

      groups.push([item]);
      placed.add(id);
    });

    return groups;
  }

  function reunifySplitGroupsInContainer(containerId, itemSelector) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var items = Array.from(container.querySelectorAll(itemSelector)).filter(function (item) {
      return item.getAttribute('data-desk-clone') !== '1';
    });
    groupSplitRowItems(items).forEach(function (group) {
      if (group.length <= 1) return;
      for (var i = 1; i < group.length; i += 1) {
        group[i - 1].insertAdjacentElement('afterend', group[i]);
      }
    });
  }

  function reunifySplitGroups() {
    reunifySplitGroupsInContainer('requests-body', 'tr');
    reunifySplitGroupsInContainer('requests-cards-mobile', '.rh-request-card');
  }

  function reorderContainer(containerId, itemSelector) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var sort = readSort();
    var items = Array.from(container.querySelectorAll(itemSelector)).filter(function (item) {
      return item.getAttribute('data-desk-clone') !== '1';
    });
    var groups = groupSplitRowItems(items);

    groups.sort(function (a, b) {
      return compareRows(a[0], b[0], sort);
    });

    groups.forEach(function (group) {
      group.forEach(function (item) {
        container.appendChild(item);
      });
    });
  }

  function reorderItems() {
    reorderContainer('requests-body', 'tr');
    reorderContainer('requests-cards-mobile', '.rh-request-card');
  }

  function updateFilteredEmptyState() {
    var active = hasActiveSearch() || hasActiveMenuFilters();

    [
      { list: 'requests-body', hideTarget: 'requests-table-panel', empty: 'requests-filtered-empty', itemSelector: 'tr' },
      {
        list: 'requests-cards-mobile',
        hideTarget: 'requests-cards-mobile-panel',
        empty: 'requests-filtered-empty-mobile',
        itemSelector: '.rh-request-card',
      },
    ].forEach(function (cfg) {
      var list = document.getElementById(cfg.list);
      var hideTarget = document.getElementById(cfg.hideTarget);
      var filteredEmpty = document.getElementById(cfg.empty);
      if (!list || !hideTarget || !filteredEmpty) return;

      var visibleCount = 0;
      list.querySelectorAll(cfg.itemSelector).forEach(function (item) {
        if (item.style.display !== 'none') visibleCount++;
      });

      var showFilteredEmpty = active && visibleCount === 0;
      filteredEmpty.hidden = !showFilteredEmpty;
    });
  }

  function rowMatchesFiltersAndSearch(row) {
    return rowMatchesSearch(row, getSearchQuery()) && rowMatchesFilters(row, readFilters());
  }

  function rowMatchesFiltersAndSearchWith(row, filters) {
    return rowMatchesSearch(row, getSearchQuery()) && rowMatchesFilters(row, filters);
  }

  function splitGroupHasFilterMatch(rootId, filters, scope) {
    filters = filters || readFilters();
    var root = null;
    if (scope) {
      root = scope.querySelector('[data-id="' + rootId + '"][data-is-split-root="1"]')
        || scope.querySelector('[data-id="' + rootId + '"]');
    } else {
      var rootRow = requestRowElement(rootId);
      var rootCard = requestCardElement(rootId);
      root = rootRow || rootCard;
    }
    if (root && rowMatchesFiltersAndSearchWith(root, filters)) return true;

    var childSelector = '[data-split-root="' + rootId + '"][data-is-subtask="1"]';
    var children = scope ? scope.querySelectorAll(childSelector) : document.querySelectorAll(childSelector);
    for (var i = 0; i < children.length; i++) {
      if (rowMatchesFiltersAndSearchWith(children[i], filters)) return true;
    }
    return false;
  }

  function applyFiltersToRow(row, skipEmpty) {
    var matches = rowMatchesFiltersAndSearch(row);
    var isRoot = row.getAttribute('data-is-split-root') === '1';
    var isChild = row.getAttribute('data-is-subtask') === '1';
    var rootId = isRoot ? row.getAttribute('data-id') : row.getAttribute('data-split-root');

    if (rootId && (isRoot || isChild)) {
      var groupMatches = splitGroupHasFilterMatch(rootId);

      if (isRoot) {
        matches = groupMatches;
      } else if (!groupMatches) {
        matches = false;
      } else {
        // Visibility while collapsed/expanded is handled by split-folders.js only.
        matches = true;
      }
    }

    row.style.display = matches ? '' : 'none';
    if (!skipEmpty) updateFilteredEmptyState();
  }

  function applyFiltersToLists() {
    document.querySelectorAll('.rh-cards-list').forEach(function (container) {
      if (container.closest('.rh-desk-slider')) return;
      container.querySelectorAll('.rh-request-card').forEach(function (row) {
        applyFiltersToRow(row, true);
      });
    });
    document.querySelectorAll('#requests-body, tbody[data-rh-panel-id="requests-body"]').forEach(function (container) {
      container.querySelectorAll('tr').forEach(function (row) {
        applyFiltersToRow(row, true);
      });
    });
    if (typeof window.rhDesksApplyFilters === 'function') {
      window.rhDesksApplyFilters();
    } else {
      updateFilteredEmptyState();
    }
  }

  function refreshMobileNav() {
    if (typeof window.refreshAffNavCounts === 'function') {
      window.refreshAffNavCounts();
    }
    if (typeof window.refreshTlNavCounts === 'function') {
      window.refreshTlNavCounts();
    }
  }

  function syncFormFromUrl() {
    var form = document.getElementById('requests-filters');
    if (!form) return;

    var params = new URLSearchParams(window.location.search);
    var status = form.querySelector('#filter-status');
    var geo = form.querySelector('#filter-geo');
    var buyer = form.querySelector('#filter-buyer');
    var assigned = form.querySelector('#filter-assigned');

    if (status) status.value = params.get('status') || '';
    if (geo) geo.value = params.get('geo') || '';
    if (buyer) buyer.value = params.get('buyer_id') || '';
    if (assigned) assigned.value = params.get('assigned') || '';
    if (window.rhFilterCombo) window.rhFilterCombo.syncAll(form);
  }

  function updateFilterFieldStates() {
    var form = document.getElementById('requests-filters');
    if (!form) return;

    form.querySelectorAll('.rh-filter-field').forEach(function (field) {
      var select = field.querySelector('select');
      field.classList.toggle('rh-filter-field--active', !!(select && select.value));
    });

    if (window.rhFilterCombo) window.rhFilterCombo.syncAll(form);
    updateClearFiltersButton();
  }

  function updateClearFiltersButton() {
    var wrap = document.getElementById('requests-clear-filters-wrap');
    if (wrap) wrap.hidden = !hasActiveMenuFilters();

    var btn = document.getElementById('rh-mobile-filters-btn');
    var badge = document.getElementById('rh-mobile-filters-badge');
    var marked = hasActiveMenuFilters() || hasActiveSearch();
    if (btn) btn.classList.toggle('is-active', marked);
    if (badge) badge.hidden = !marked;
  }

  function relocateMobileSort() {
    var form = document.getElementById('requests-sort');
    var mobileBody = document.getElementById('rh-mobile-sort-body');
    var desktopSlot = document.getElementById('rh-desktop-sort-slot');
    if (!form) return;

    if (window.matchMedia('(max-width: 767px)').matches) {
      if (mobileBody && form.parentElement !== mobileBody) {
        mobileBody.appendChild(form);
      }
      return;
    }

    if (desktopSlot && form.parentElement !== desktopSlot) {
      desktopSlot.appendChild(form);
    }
  }

  function relocateMobileFilters() {
    if (!window.matchMedia('(max-width: 767px)').matches) return;

    var sheet = document.getElementById('rh-mobile-filters-body');
    if (!sheet) return;

    var live = document.getElementById('requests-filters');
    if (live && live.parentElement !== sheet) {
      sheet.appendChild(live);
    }

    document.querySelectorAll('form.rh-filters').forEach(function (form) {
      if (form === live || form.id === 'requests-sort') return;
      form.remove();
    });
  }

  var filtersMotion = null;
  var filtersPhase = '';

  function stopFiltersMotion() {
    if (filtersMotion && window.rhMotion) window.rhMotion.stop(filtersMotion);
    filtersMotion = null;
  }

  function finishCloseMobileFilters() {
    var sheet = document.getElementById('rh-mobile-filters-sheet');
    var btn = document.getElementById('rh-mobile-filters-btn');
    if (sheet) {
      if (window.rhMotion) window.rhMotion.reset(sheet);
      sheet.hidden = true;
      sheet.style.opacity = '';
      sheet.style.transform = '';
    }
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('rh-mobile-filters-open');
    filtersPhase = '';
    filtersMotion = null;
  }

  function closeMobileFilters(options) {
    options = options || {};
    if (window.rhFilterCombo) window.rhFilterCombo.closeOpen();
    if (options.discard) {
      syncFormFromUrl();
      updateFilterFieldStates();
    }

    var sheet = document.getElementById('rh-mobile-filters-sheet');
    if (!sheet || sheet.hidden || filtersPhase === 'closing') return;

    filtersPhase = 'closing';
    stopFiltersMotion();

    var motion = window.rhMotion;
    if (motion && !motion.reduced()) {
      filtersMotion = motion.closeOverlay(sheet, 'sheet-filters');
      Promise.resolve(filtersMotion && filtersMotion.finished)
        .then(function () {
          if (filtersPhase === 'closing') finishCloseMobileFilters();
        })
        .catch(function () {
          if (filtersPhase === 'closing') finishCloseMobileFilters();
        });
      return;
    }

    finishCloseMobileFilters();
  }

  function openMobileFilters() {
    closeMobileSort({ discard: true });
    relocateMobileFilters();
    syncFormFromUrl();
    updateFilterFieldStates();
    var sheet = document.getElementById('rh-mobile-filters-sheet');
    var btn = document.getElementById('rh-mobile-filters-btn');
    if (!sheet || !btn) return;

    stopFiltersMotion();
    filtersPhase = 'opening';
    if (typeof closeAccountDropdown === 'function') closeAccountDropdown();
    if (window.rhMotion) window.rhMotion.prepareSheetOpen(sheet);
    sheet.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('rh-mobile-filters-open');

    var motion = window.rhMotion;
    if (motion && !motion.reduced()) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (filtersPhase !== 'opening') return;
          filtersMotion = motion.openOverlay(sheet, 'sheet-filters');
          Promise.resolve(filtersMotion && filtersMotion.finished).then(function () {
            if (filtersPhase === 'opening') filtersPhase = '';
          });
        });
      });
      return;
    }

    filtersPhase = '';
  }

  function toggleMobileFilters() {
    if (isMobileFiltersOpen() && filtersPhase !== 'closing') {
      closeMobileFilters({ discard: true });
    } else {
      openMobileFilters();
    }
  }

  function isMobileSortOpen() {
    return document.body.classList.contains('rh-mobile-sort-open');
  }

  function hasActiveSort() {
    var sort = readSort();
    return !(sort.column === 'created_at' && sort.dir === 'desc');
  }

  function hasActiveSortSettings() {
    return hasActiveSort();
  }

  function updatePerPageControlState() {
    var field = document.getElementById('sort-per-page');
    var control = document.getElementById('requests-per-page-control');
    if (!field) return;
    var perPage = Number(field.value);
    var isActive = perPage !== defaultPerPageForViewport();
    if (control) control.classList.toggle('is-active', isActive);
  }

  function syncSortFormFromUrl() {
    var columnField = document.getElementById('sort-column');
    var dirField = document.getElementById('sort-dir');
    var perPageField = document.getElementById('sort-per-page');
    if (!columnField || !dirField) return;

    var sort = readSort();
    columnField.value = sort.column;
    dirField.value = sort.dir;
    if (perPageField) perPageField.value = String(readListPerPage());
    updateSortFieldStates();
    updatePerPageControlState();
  }

  function updateSortFieldStates() {
    var form = document.getElementById('requests-sort');
    if (!form) return;

    var columnField = form.querySelector('#sort-column');
    var dirField = form.querySelector('#sort-dir');
    var column = columnField ? columnField.value : 'created_at';
    var dir = dirField ? dirField.value : 'desc';

    form.querySelectorAll('.rh-filter-field').forEach(function (field) {
      var select = field.querySelector('select');
      if (!select) return;
      if (select.name === 'sort') {
        field.classList.toggle('rh-filter-field--active', column !== 'created_at');
      } else if (select.name === 'dir') {
        field.classList.toggle('rh-filter-field--active', dir !== 'desc');
      }
    });

    var wrap = document.getElementById('requests-clear-sort-wrap');
    if (wrap) wrap.hidden = !hasActiveSortSettings();

    var btn = document.getElementById('rh-mobile-sort-btn');
    var badge = document.getElementById('rh-mobile-sort-badge');
    if (btn) btn.classList.toggle('is-active', hasActiveSortSettings());
    if (badge) badge.hidden = !hasActiveSortSettings();
  }

  var sortMotion = null;
  var sortPhase = '';

  function stopSortMotion() {
    if (sortMotion && window.rhMotion) window.rhMotion.stop(sortMotion);
    sortMotion = null;
  }

  function finishCloseMobileSort() {
    var sheet = document.getElementById('rh-mobile-sort-sheet');
    var btn = document.getElementById('rh-mobile-sort-btn');
    if (sheet) {
      if (window.rhMotion) window.rhMotion.reset(sheet);
      sheet.hidden = true;
      sheet.style.opacity = '';
      sheet.style.transform = '';
    }
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('rh-mobile-sort-open');
    sortPhase = '';
    sortMotion = null;
  }

  function closeMobileSort(options) {
    options = options || {};
    if (options.discard) {
      syncSortFormFromUrl();
      updateSortFieldStates();
    }

    var sheet = document.getElementById('rh-mobile-sort-sheet');
    if (!sheet || sheet.hidden || sortPhase === 'closing') return;

    sortPhase = 'closing';
    stopSortMotion();

    var motion = window.rhMotion;
    if (motion && !motion.reduced()) {
      sortMotion = motion.closeOverlay(sheet, 'sheet-filters');
      Promise.resolve(sortMotion && sortMotion.finished)
        .then(function () {
          if (sortPhase === 'closing') finishCloseMobileSort();
        })
        .catch(function () {
          if (sortPhase === 'closing') finishCloseMobileSort();
        });
      return;
    }

    finishCloseMobileSort();
  }

  function openMobileSort() {
    closeMobileFilters({ discard: true });
    relocateMobileSort();
    syncSortFormFromUrl();
    updateSortFieldStates();
    var sheet = document.getElementById('rh-mobile-sort-sheet');
    var btn = document.getElementById('rh-mobile-sort-btn');
    if (!sheet || !btn) return;

    stopSortMotion();
    sortPhase = 'opening';
    if (typeof closeAccountDropdown === 'function') closeAccountDropdown();
    if (window.rhMotion) window.rhMotion.prepareSheetOpen(sheet);
    sheet.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('rh-mobile-sort-open');

    var motion = window.rhMotion;
    if (motion && !motion.reduced()) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (sortPhase !== 'opening') return;
          sortMotion = motion.openOverlay(sheet, 'sheet-filters');
          Promise.resolve(sortMotion && sortMotion.finished).then(function () {
            if (sortPhase === 'opening') sortPhase = '';
          });
        });
      });
      return;
    }

    sortPhase = '';
  }

  function toggleMobileSort() {
    if (isMobileSortOpen() && sortPhase !== 'closing') {
      closeMobileSort({ discard: true });
    } else {
      openMobileSort();
    }
  }

  function applySortFromForm() {
    var form = document.getElementById('requests-sort');
    if (!form) return;

    var columnField = form.querySelector('#sort-column');
    var dirField = form.querySelector('#sort-dir');
    if (!columnField || !dirField) return;

    applySortState({ column: columnField.value, dir: dirField.value });
    refreshMobileNav();
  }

  function applyPerPageFromSelect() {
    var perPageField = document.getElementById('sort-per-page');
    if (!perPageField) return;

    applySortState(readSort(), { perPage: Number(perPageField.value) });
    updatePerPageControlState();
    refreshMobileNav();
  }

  function resetSortForm() {
    var form = document.getElementById('requests-sort');
    if (!form) return;

    var columnField = form.querySelector('#sort-column');
    var dirField = form.querySelector('#sort-dir');
    if (columnField) columnField.value = 'created_at';
    if (dirField) dirField.value = 'desc';
    updateSortFieldStates();
  }

  function clearSort() {
    resetSortForm();
    applySortFromForm();
    if (isMobileSortOpen()) closeMobileSort();
  }

  function commitMobileSort() {
    applySortFromForm();
    closeMobileSort();
  }

  function bindSortControls() {
    if (document.body.dataset.rhSortSheetBound === '1') return;
    document.body.dataset.rhSortSheetBound = '1';

    document.body.addEventListener('change', function (evt) {
      if (evt.target.matches('#sort-per-page')) {
        updatePerPageControlState();
        applyPerPageFromSelect();
        return;
      }
      if (!evt.target.matches('#requests-sort select')) return;
      updateSortFieldStates();
      if (!isMobile()) applySortFromForm();
    });

    document.body.addEventListener('click', function (evt) {
      if (evt.target.closest('#rh-mobile-sort-btn')) {
        evt.preventDefault();
        toggleMobileSort();
        return;
      }
      if (evt.target.closest('.rh-mobile-sort-scrim')) {
        evt.preventDefault();
        closeMobileSort({ discard: true });
        return;
      }
      if (evt.target.closest('#rh-mobile-sort-close')) {
        evt.preventDefault();
        closeMobileSort({ discard: true });
        return;
      }
      if (evt.target.closest('#rh-mobile-sort-done')) {
        evt.preventDefault();
        commitMobileSort();
        return;
      }
      if (!evt.target.closest('#requests-clear-sort')) return;
      evt.preventDefault();
      clearSort();
    });
  }

  function preserveDeskParams(params) {
    if (!usesDeskNav() || !isMobile()) return;

    var deskKey =
      typeof window.rhDeskKeyFromUrl === 'function' ? window.rhDeskKeyFromUrl() : 'all';
    var desk =
      typeof window.rhDeskFiltersForKey === 'function'
        ? window.rhDeskFiltersForKey(deskKey)
        : { assigned: '', view: '' };

    if (document.body.classList.contains('rh-tl-user')) {
      params.delete('view');
      if (desk.view) params.set('view', desk.view);
    }
  }

  function writeFormFiltersToParams(params) {
    var form = document.getElementById('requests-filters');
    if (!form) return;

    ['status', 'geo', 'buyer_id', 'assigned'].forEach(function (name) {
      var field = form.querySelector('[name="' + name + '"]');
      if (!field) return;
      if (field.value) params.set(name, field.value);
      else params.delete(name);
    });

    if (document.body.classList.contains('rh-tl-user')) {
      preserveDeskParams(params);
    }

    params.delete('page');
  }

  function applyFiltersFromForm() {
    var form = document.getElementById('requests-filters');
    if (!form) return;

    pushParams(writeFormFiltersToParams);
    handleHistoryChange();
    refreshMobileNav();
  }

  function resetFormFilters() {
    var form = document.getElementById('requests-filters');
    if (!form) return;
    form.querySelectorAll('select').forEach(function (select) {
      select.value = '';
    });
    if (window.rhFilterCombo) window.rhFilterCombo.syncAll(form);
    updateFilterFieldStates();
  }

  function clearFilters() {
    resetFormFilters();
    applyFiltersFromForm();
    if (isMobileFiltersOpen()) closeMobileFilters();
  }

  function commitMobileFilters() {
    applyFiltersFromForm();
    closeMobileFilters();
  }

  function handleHistoryChange() {
    syncSortFormFromUrl();
    syncFormFromUrl();
    updateSortHeaders();
    updateFilterFieldStates();
    updateSortFieldStates();
    if (typeof window.rhSyncDeskFromUrl === 'function') {
      window.rhSyncDeskFromUrl();
    }
    if (usesDeskCatalog()) {
      applyFiltersToLists();
      return;
    }
    reloadListFromUrl();
  }

  function bindFilterControls() {
    if (document.body.dataset.rhFilterBound === '1') return;
    document.body.dataset.rhFilterBound = '1';

    document.body.addEventListener('change', function (evt) {
      if (!evt.target.matches('#requests-filters select')) return;
      updateFilterFieldStates();
      if (!isMobile()) applyFiltersFromForm();
    });

    document.body.addEventListener('keydown', function (evt) {
      if (evt.key !== 'Escape') return;
      if (window.rhFilterCombo && window.rhFilterCombo.closeOpen({ focusTrigger: true })) {
        evt.preventDefault();
        return;
      }
      if (isMobileSortOpen() && sortPhase !== 'opening') {
        evt.preventDefault();
        closeMobileSort({ discard: true });
        return;
      }
      if (!isMobileFiltersOpen() && filtersPhase !== 'opening') return;
      evt.preventDefault();
      closeMobileFilters({ discard: true });
    });

    document.body.addEventListener('click', function (evt) {
      if (evt.target.closest('#rh-mobile-filters-btn')) {
        evt.preventDefault();
        toggleMobileFilters();
        return;
      }
      if (evt.target.closest('.rh-mobile-filters-scrim')) {
        evt.preventDefault();
        closeMobileFilters({ discard: true });
        return;
      }
      if (evt.target.closest('#rh-mobile-filters-close')) {
        evt.preventDefault();
        closeMobileFilters({ discard: true });
        return;
      }
      if (evt.target.closest('#rh-mobile-filters-done')) {
        evt.preventDefault();
        commitMobileFilters();
        return;
      }
      if (!evt.target.closest('#requests-clear-filters, #requests-clear-filters-mobile, #requests-clear-filters-empty')) return;
      evt.preventDefault();
      clearFilters();
    });
  }

  function syncSearchClearButton() {
    var clearBtn = document.getElementById('requests-search-mobile-clear');
    if (!clearBtn) return;
    clearBtn.hidden = !getSearchQuery();
  }

  function bindSearchInput() {
    if (document.body.dataset.rhSearchBound === '1') return;
    document.body.dataset.rhSearchBound = '1';

    document.body.addEventListener('input', function (evt) {
      if (!evt.target.classList.contains('rh-requests-search-input')) return;

      document.querySelectorAll('.rh-requests-search-input').forEach(function (input) {
        if (input !== evt.target) input.value = evt.target.value;
      });
      syncSearchClearButton();
      applyFiltersToLists();
      updateClearFiltersButton();
    });

    document.body.addEventListener('click', function (evt) {
      var clearBtn = evt.target.closest('#requests-search-mobile-clear');
      if (!clearBtn) return;

      document.querySelectorAll('.rh-requests-search-input').forEach(function (input) {
        input.value = '';
      });
      syncSearchClearButton();
      applyFiltersToLists();
      updateClearFiltersButton();
      var mobile = document.getElementById('requests-search-mobile');
      if (mobile) mobile.focus();
    });
  }

  function buildSortUrl(column, dir) {
    var params = new URLSearchParams(window.location.search);

    if (column === 'created_at' && dir === 'desc') {
      params.delete('sort');
      params.delete('dir');
    } else {
      params.set('sort', column);
      params.set('dir', dir);
    }

    var qs = params.toString();
    return window.location.pathname + (qs ? '?' + qs : '');
  }

  function nextSortState(column) {
    var params = new URLSearchParams(window.location.search);
    var hasSortParam = params.has('sort');
    var activeColumn = hasSortParam ? params.get('sort') : 'created_at';
    var activeDir = hasSortParam ? (params.get('dir') === 'asc' ? 'asc' : 'desc') : 'desc';
    var nextDir = column === activeColumn && activeDir === 'asc' ? 'desc' : 'asc';

    return { column: column, dir: nextDir };
  }

  function applySortState(sort, options) {
    options = options || {};
    var params = new URLSearchParams(window.location.search);
    if (sort.column === 'created_at' && sort.dir === 'desc') {
      params.delete('sort');
      params.delete('dir');
    } else {
      params.set('sort', sort.column);
      params.set('dir', sort.dir);
    }

    if (options.perPage !== undefined) {
      if (Number(options.perPage) === defaultPerPageForViewport()) {
        params.delete('per_page');
      } else {
        params.set('per_page', String(options.perPage));
      }
    }

    params.delete('page');
    reloadListFromUrl(params);
  }

  function updateSortHeaders() {
    var sort = readSort();
    var thead = document.getElementById('requests-thead');
    if (!thead) return;

    thead.querySelectorAll('.rh-th-sort-link').forEach(function (link) {
      var column = link.dataset.sortKey;
      var th = link.closest('th');
      var active = sort.column === column;
      var indicator = link.querySelector('.rh-sort-indicator');

      if (th) {
        th.classList.toggle('rh-th-sorted', active);
      }
      if (indicator) {
        indicator.textContent = active ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      }
    });
  }

  function bindSortHeaders() {
    if (document.body.dataset.rhSortBound === '1') return;
    document.body.dataset.rhSortBound = '1';

    var sortPointer = { x: 0, y: 0, moved: false };

    document.body.addEventListener(
      'pointerdown',
      function (evt) {
        if (!evt.target.closest('.rh-th-sort-link')) return;
        sortPointer.x = evt.clientX;
        sortPointer.y = evt.clientY;
        sortPointer.moved = false;
      },
      true
    );

    document.body.addEventListener(
      'pointermove',
      function (evt) {
        if (sortPointer.moved) return;
        if (
          Math.abs(evt.clientX - sortPointer.x) > 8 ||
          Math.abs(evt.clientY - sortPointer.y) > 8
        ) {
          sortPointer.moved = true;
        }
      },
      true
    );

    document.body.addEventListener('click', function (evt) {
      if (evt.target.closest('.rh-col-resize-handle')) return;

      var link = evt.target.closest('.rh-th-sort-link');
      if (!link || !link.dataset.sortKey) return;

      if (sortPointer.moved) {
        evt.preventDefault();
        return;
      }

      evt.preventDefault();
      applySortState(nextSortState(link.dataset.sortKey));
    });

    window.addEventListener('popstate', handleHistoryChange);
  }

  function initRequestsList() {
    var awaitingSwap = false;

    try {
      ensurePerPageInUrl();
      if (domExceedsPagination()) {
        if (paginationReloadAttempts < MAX_PAGINATION_RELOADS) {
          paginationReloadAttempts += 1;
          reloadListFromUrl();
          awaitingSwap = true;
          return;
        }
        console.warn('[requests-sse] pagination reload cap reached, showing current list');
      } else {
        paginationReloadAttempts = 0;
      }

      relocateMobileSort();
      relocateMobileFilters();
      if (window.rhFilterCombo) window.rhFilterCombo.enhanceAll();
      syncSortFormFromUrl();
      syncFormFromUrl();
      updateSortHeaders();
      applyFiltersToLists();
      updateFilterFieldStates();
      updateSortFieldStates();
      bindSearchInput();
      syncSearchClearButton();
      bindSortHeaders();
      bindFilterControls();
      bindSortControls();

      if (!window.__rhSortRelocateBound) {
        window.__rhSortRelocateBound = true;
        window.addEventListener('resize', relocateMobileSort);
      }

      bindSplitLinks();
      handleSplitHash();
    } catch (err) {
      console.error('[requests-sse] initRequestsList failed', err);
    } finally {
      if (awaitingSwap || window.__rhAwaitingListSwap) return;

      if (typeof window.revealRequestsList === 'function') {
        window.revealRequestsList();
      } else if (typeof window.finishRequestsListLoading === 'function') {
        window.finishRequestsListLoading();
      } else if (typeof window.setRequestsListLoading === 'function') {
        window.setRequestsListLoading(false);
      }
    }
  }

  var splitTargetTimer = null;

  function findSplitTarget(id) {
    var row = requestRowElement(id);
    var card = requestCardElement(id);

    if (row && row.offsetParent !== null) return row;
    if (card && card.offsetParent !== null) return card;
    return row || card;
  }

  function highlightSplitTarget(node) {
    if (!node) return;

    node.classList.remove('rh-request-row--split-target', 'rh-request-card--split-target');
    void node.offsetWidth;
    node.classList.add(
      node.classList.contains('rh-request-card')
        ? 'rh-request-card--split-target'
        : 'rh-request-row--split-target'
    );

    clearTimeout(splitTargetTimer);
    splitTargetTimer = setTimeout(function () {
      node.classList.remove('rh-request-row--split-target', 'rh-request-card--split-target');
    }, 1700);
  }

  function highlightSplitGroup(rootId, primaryNode) {
    var nodes = [];
    if (rootId) {
      document.querySelectorAll('[data-split-root="' + rootId + '"][data-is-split-member="1"], [data-split-root="' + rootId + '"][data-is-subtask="1"]').forEach(function (node) {
        if (node.offsetParent !== null) nodes.push(node);
      });
    }
    if (!nodes.length && primaryNode) nodes = [primaryNode];
    if (!nodes.length) return;

    nodes.forEach(function (node) {
      node.classList.remove('rh-request-row--split-target', 'rh-request-card--split-target');
      void node.offsetWidth;
      node.classList.add(
        node.classList.contains('rh-request-card')
          ? 'rh-request-card--split-target'
          : 'rh-request-row--split-target'
      );
    });

    clearTimeout(splitTargetTimer);
    splitTargetTimer = setTimeout(function () {
      nodes.forEach(function (node) {
        node.classList.remove('rh-request-row--split-target', 'rh-request-card--split-target');
      });
    }, 1700);
  }

  function revealSplitTarget(id) {
    var inputs = document.querySelectorAll('.rh-requests-search-input');
    if (!inputs.length) return null;

    inputs.forEach(function (input) {
      input.value = String(id);
    });
    applyFiltersToLists();
    syncSearchClearButton();
    return findSplitTarget(id);
  }

  function goToSplitTarget(id, options) {
    options = options || {};
    if (!id) return false;

    var target = findSplitTarget(id);
    if (!target && options.trySearch !== false) {
      target = revealSplitTarget(id);
    }
    if (!target) return false;

    if (target.style.display === 'none') {
      target.style.display = '';
    }

    var groupId = target.getAttribute('data-split-root') || id;
    if (typeof window.rhExpandSplitFolder === 'function' && groupId) {
      window.rhExpandSplitFolder(groupId, target);
    }
    highlightSplitGroup(groupId, target);
    target.scrollIntoView({
      behavior: options.smooth === false ? 'auto' : 'smooth',
      block: 'center',
    });

    if (options.updateHash !== false) {
      var nextHash = '#request-row-' + requestDomSlug(id);
      if (window.location.hash !== nextHash) {
        history.replaceState(history.state, '', nextHash);
      }
    }

    return true;
  }

  function handleSplitHash() {
    var match = window.location.hash.match(/^#request-row-(.+)$/);
    if (!match) return;
    goToSplitTarget(window.rhRequestIdFromDomSlug(match[1]), { smooth: false });
  }

  function bindSplitLinks() {
    if (document.body.dataset.rhSplitLinksBound === '1') return;
    document.body.dataset.rhSplitLinksBound = '1';

    document.body.addEventListener('click', function (evt) {
      var link = evt.target.closest('.rh-request-split-link');
      if (!link) return;
      evt.preventDefault();
      goToSplitTarget(link.getAttribute('data-rh-split-target'));
    });
  }

  window.rhGoToSplitTarget = goToSplitTarget;

  window.applyRequestsSearch = applyFiltersToLists;
  window.relocateMobileFilters = relocateMobileFilters;
  window.relocateMobileSort = relocateMobileSort;
  window.handleRequestsHistoryChange = handleHistoryChange;
  window.rhMatchRequestRow = function (row, filters) {
    return rowMatchesSearch(row, getSearchQuery()) && rowMatchesFilters(row, filters);
  };
  window.rhSplitGroupMatchesFilters = function (rootId, filters, scope) {
    return splitGroupHasFilterMatch(rootId, filters, scope || null);
  };
  window.rhReadRequestFilters = readFilters;
  window.rhReadMenuFilters = readMenuFilters;

  function containerForItemId(itemId) {
    return itemId.indexOf('request-card-') === 0 ? 'requests-cards-mobile' : 'requests-body';
  }

  function finalizeInsertedTableRow(item) {
    if (item && item.tagName === 'TR' && typeof window.rhReorderRequestTableRow === 'function') {
      window.rhReorderRequestTableRow(item);
    }
  }

  function insertItemNode(item, container) {
    var splitRoot = item.getAttribute('data-split-root') || item.dataset.splitRoot || '';
    var isSubtask = item.getAttribute('data-is-subtask') === '1' || item.dataset.isSubtask === '1';
    if (splitRoot && isSubtask) {
      var isCard = item.id && item.id.indexOf('request-card-') === 0;
      var selector = isCard
        ? '.rh-request-card[data-is-subtask="1"][data-split-root="' + splitRoot + '"]:not([data-desk-clone="1"])'
        : 'tr[data-is-subtask="1"][data-split-root="' + splitRoot + '"]';
      var scope = container || document;
      var group = Array.prototype.slice.call(scope.querySelectorAll(selector));
      if (group.length) {
        group[group.length - 1].insertAdjacentElement('afterend', item);
        finalizeInsertedTableRow(item);
        return;
      }

      var prefix = isCard ? 'request-card-' : 'request-row-';
      var root =
        document.getElementById(prefix + requestDomSlug(splitRoot))
        || (isCard && container
          ? container.querySelector(
              '.rh-request-card[data-id="' + splitRoot + '"]:not([data-desk-clone="1"])'
            )
          : null);
      if (root && root.parentNode) {
        root.insertAdjacentElement('afterend', item);
        finalizeInsertedTableRow(item);
        return;
      }
    }

    container.appendChild(item);
    finalizeInsertedTableRow(item);
  }

  function applyItemHtml(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html.trim();

    tpl.content.querySelectorAll('tr, .rh-request-card').forEach(function (item) {
      if (item.classList.contains('rh-request-card') && typeof window.rhDesksSyncCard === 'function') {
        if (window.rhDesksSyncCard(item)) return;
      }

      if (!item.id) return;

      var existing = document.getElementById(item.id);
      if (existing) {
        existing.outerHTML = item.outerHTML;
      } else if (usesDeskCatalog()) {
        var container = document.getElementById(containerForItemId(item.id));
        if (container) {
          var node = item;
          insertItemNode(node, container);
        }
      } else {
        schedulePaginatedListRefresh();
        return;
      }

      var node = document.getElementById(item.id);
      if (node) {
        finalizeInsertedTableRow(node);
        applyFiltersToRow(node);
        if (typeof htmx !== 'undefined') {
          htmx.process(node);
        }
      }
    });

    if (!usesDeskCatalog()) {
      reunifySplitGroups();
      reorderItems();
    } else if (typeof window.rhQueueSplitReunify === 'function') {
      window.rhQueueSplitReunify();
    }

    var splitRootId = '';
    tpl.content.querySelectorAll('tr[data-split-root], .rh-request-card[data-split-root]').forEach(function (item) {
      if (!splitRootId) splitRootId = splitRootForId(item.getAttribute('data-split-root'));
    });
    tpl.content.querySelectorAll('[data-is-split-root="1"]').forEach(function (item) {
      if (!splitRootId) splitRootId = String(item.getAttribute('data-id') || '');
    });
    if (splitRootId && typeof window.rhQueueSplitFolderSync === 'function') {
      window.rhQueueSplitFolderSync(splitRootId);
    } else if (typeof window.rhSyncSplitFolders === 'function') {
      window.rhSyncSplitFolders();
    }
  }

  window.rhReunifySplitGroups = reunifySplitGroups;
  window.rhReorderRequestItems = reorderItems;
  window.rhInsertRequestItem = insertItemNode;

  function refreshRequestRow(id) {
    if (usesDeskCatalog()) return;

    fetch('/' + encodeURIComponent(String(id)) + '/row', {
      headers: { 'HX-Request': 'true' },
      credentials: 'same-origin',
    })
      .then(function (res) {
        if (res.status === 403 || res.status === 404) return null;
        return res.text();
      })
      .then(function (html) {
        if (!html) return;

        var empty = document.getElementById('requests-empty');
        var panel = document.getElementById('requests-table-panel');
        var panelMobile = document.getElementById('requests-cards-mobile-panel');
        var filtersWrap = document.getElementById('requests-filters-wrap');
        var table = document.getElementById('requests-table');
        var cardsList = document.getElementById('requests-cards-mobile');
        if (empty) empty.hidden = true;
        if (panel) panel.hidden = false;
        if (panelMobile) panelMobile.hidden = false;
        if (filtersWrap) filtersWrap.hidden = false;
        if (table) table.hidden = false;
        if (cardsList) cardsList.hidden = false;

        applyItemHtml(html);
        refreshMobileNav();
      })
      .catch(function () {});
  }

  document.addEventListener('htmx:sseMessage', function (evt) {
    if (!evt.detail || evt.detail.type !== 'request-updated') return;
    try {
      var payload = JSON.parse(evt.detail.data);
      if (payload && payload.id) {
        if (pendingListMutations > 0) return;
        refreshRequestRow(payload.splitRootId || payload.id);
      }
    } catch (e) {}
  });

  document.body.addEventListener('htmx:beforeRequest', function (evt) {
    var elt = evt.detail && evt.detail.elt;
    if (!elt || !elt.closest) return;
    var form = elt.closest('form');
    if (!form || !isListMutationForm(form)) return;
    pendingListMutations += 1;
  });

  document.body.addEventListener('htmx:afterSettle', function (evt) {
    var elt = evt.detail && evt.detail.elt;
    if (!elt || !elt.closest) return;
    var form = elt.closest('form');
    if (!form || !isListMutationForm(form)) return;
    if (pendingListMutations > 0) pendingListMutations -= 1;
    afterListMutationSettled(form);
  });

  document.body.addEventListener('htmx:responseError', function (evt) {
    var elt = evt.detail && evt.detail.elt;
    if (!elt || !elt.closest) return;
    var form = elt.closest('form');
    if (!form || !isListMutationForm(form)) return;
    if (pendingListMutations > 0) pendingListMutations -= 1;
  });

  window.initRequestsList = initRequestsList;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequestsList);
  } else {
    initRequestsList();
  }

  document.body.addEventListener('htmx:oobAfterSwap', function (evt) {
    var elt = (evt.detail && evt.detail.elt) || evt.target;
    if (elt && elt.tagName === 'TR') finalizeInsertedTableRow(elt);
  });

  document.body.addEventListener('htmx:oobErrorNoTarget', function (evt) {
    var item = evt.detail && evt.detail.content;
    if (!item || !item.id) return;

    var containerId = containerForItemId(item.id);
    var container = document.getElementById(containerId);
    if (!container) return;

    insertItemNode(item, container);
    var node = document.getElementById(item.id);
    if (node) {
      finalizeInsertedTableRow(node);
      applyFiltersToRow(node);
      if (typeof htmx !== 'undefined') htmx.process(node);
    }
  });

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    if (!evt.detail.target || !evt.detail.target.id) return;

    if (evt.detail.target.id === 'requests-main') {
      window.__rhAwaitingListSwap = false;
      initRequestsList();
      refreshMobileNav();
      handleSplitHash();
      return;
    }
  });
})();
