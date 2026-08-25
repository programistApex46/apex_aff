(function () {
  if (window.__rhRequestsSseBound) {
    if (typeof window.initRequestsList === 'function') window.initRequestsList();
    return;
  }
  window.__rhRequestsSseBound = true;

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

  function reloadListFromUrl(params) {
    if (usesDeskCatalog()) {
      applyFiltersToLists();
      return;
    }

    if (typeof window.setRequestsListLoading === 'function') {
      window.setRequestsListLoading(true);
    }

    if (!params) params = new URLSearchParams(window.location.search);
    var qs = params.toString();
    if (typeof htmx !== 'undefined' && document.getElementById('requests-main')) {
      htmx.ajax('GET', '/list' + (qs ? '?' + qs : ''), {
        target: '#requests-main',
        swap: 'innerHTML',
      });
      return;
    }
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

    if (document.body.classList.contains('rh-aff-user')) {
      return filters;
    }

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
    return {
      status: menu.status || '',
      geo: menu.geo || '',
      buyer_id: menu.buyer_id || '',
      assigned: desk.assigned || menu.assigned || '',
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
      if (row.dataset.assignedId !== String(filters.assigned)) return false;
    }
    if (filters.view === 'mine' && !['new', 'in_progress'].includes(row.dataset.status)) {
      return false;
    }
    return true;
  }

  function rowSortValue(row, column) {
    switch (column) {
      case 'id':
        return Number(row.dataset.id);
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

  function groupSplitRowItems(items) {
    var groups = [];
    var i = 0;

    while (i < items.length) {
      var item = items[i];
      if (item.getAttribute('data-is-split-root') === '1') {
        var rootId = item.getAttribute('data-id');
        var group = [item];
        i += 1;
        while (
          i < items.length
          && items[i].getAttribute('data-is-subtask') === '1'
          && items[i].getAttribute('data-split-root') === rootId
        ) {
          group.push(items[i]);
          i += 1;
        }
        groups.push(group);
        continue;
      }

      groups.push([item]);
      i += 1;
    }

    return groups;
  }

  function reorderContainer(containerId, itemSelector) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var sort = readSort();
    var items = Array.from(container.querySelectorAll(itemSelector));
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

  function splitGroupHasFilterMatch(rootId) {
    var rootRow = document.getElementById('request-row-' + rootId);
    var rootCard = document.getElementById('request-card-' + rootId);
    var root = rootRow || rootCard;
    if (root && rowMatchesFiltersAndSearch(root)) return true;

    var children = document.querySelectorAll(
      '[data-split-root="' + rootId + '"][data-is-subtask="1"]'
    );
    for (var i = 0; i < children.length; i++) {
      if (rowMatchesFiltersAndSearch(children[i])) return true;
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

    var filters = readMenuFilters();
    var status = form.querySelector('#filter-status');
    var geo = form.querySelector('#filter-geo');
    var buyer = form.querySelector('#filter-buyer');
    var assigned = form.querySelector('#filter-assigned');

    if (status) status.value = filters.status;
    if (geo) geo.value = filters.geo;
    if (buyer) buyer.value = filters.buyer_id;
    if (assigned) assigned.value = filters.assigned;
  }

  function updateGeoFilterDisplay() {
    var select = document.getElementById('filter-geo');
    var display = document.getElementById('filter-geo-display');
    if (!select || !display) return;

    var option = select.options[select.selectedIndex];

    if (!select.value) {
      display.innerHTML = '<span class="rh-filter-geo-placeholder">All GEOs</span>';
      return;
    }

    var name = option.getAttribute('data-name');
    var code = option.getAttribute('data-code') || select.value;
    var flagUrl = option.getAttribute('data-flag-url');
    var textHtml = name
      ? name + ' | <span class="rh-geo-cell-code">' + code + '</span>'
      : '<span class="rh-geo-cell-code">' + code + '</span>';
    var flagHtml = flagUrl
      ? '<img src="' + flagUrl + '" alt="" class="rh-geo-flag" width="16" height="12" loading="lazy" decoding="async">'
      : '';

    display.innerHTML =
      '<span class="rh-geo-cell">' + flagHtml + '<span class="rh-geo-cell-text">' + textHtml + '</span></span>';
  }

  function updateFilterFieldStates() {
    var form = document.getElementById('requests-filters');
    if (!form) return;

    form.querySelectorAll('.rh-filter-field').forEach(function (field) {
      var select = field.querySelector('select');
      field.classList.toggle('rh-filter-field--active', !!(select && select.value));
    });

    updateGeoFilterDisplay();
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

  function hasActivePerPage() {
    return readListPerPage() !== defaultPerPageForViewport();
  }

  function hasActiveSortSettings() {
    return hasActiveSort() || hasActivePerPage();
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
  }

  function updateSortFieldStates() {
    var form = document.getElementById('requests-sort');
    if (!form) return;

    var columnField = form.querySelector('#sort-column');
    var dirField = form.querySelector('#sort-dir');
    var perPageField = form.querySelector('#sort-per-page');
    var column = columnField ? columnField.value : 'created_at';
    var dir = dirField ? dirField.value : 'desc';
    var perPage = perPageField ? Number(perPageField.value) : readListPerPage();

    form.querySelectorAll('.rh-filter-field').forEach(function (field) {
      var select = field.querySelector('select');
      if (!select) return;
      if (select.name === 'sort') {
        field.classList.toggle('rh-filter-field--active', column !== 'created_at');
      } else if (select.name === 'dir') {
        field.classList.toggle('rh-filter-field--active', dir !== 'desc');
      } else if (select.name === 'per_page') {
        field.classList.toggle('rh-filter-field--active', perPage !== defaultPerPageForViewport());
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
    var perPageField = form.querySelector('#sort-per-page');
    if (!columnField || !dirField) return;

    var perPage = perPageField ? Number(perPageField.value) : readListPerPage();
    applySortState(
      { column: columnField.value, dir: dirField.value },
      { perPage: perPage }
    );
    refreshMobileNav();
  }

  function resetSortForm() {
    var form = document.getElementById('requests-sort');
    if (!form) return;

    var columnField = form.querySelector('#sort-column');
    var dirField = form.querySelector('#sort-dir');
    var perPageField = form.querySelector('#sort-per-page');
    if (columnField) columnField.value = 'created_at';
    if (dirField) dirField.value = 'desc';
    if (perPageField) perPageField.value = String(defaultPerPageForViewport());
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

    params.delete('view');
    if (desk.view) params.set('view', desk.view);

    if (document.body.classList.contains('rh-aff-user')) {
      params.delete('assigned');
      if (desk.assigned) params.set('assigned', desk.assigned);
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

    if (document.body.classList.contains('rh-aff-user')) {
      params.delete('assigned');
    }

    preserveDeskParams(params);
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
      if (Number(options.perPage) === 50) {
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
    ensurePerPageInUrl();
    if (domExceedsPagination()) {
      reloadListFromUrl();
      return;
    }

    relocateMobileSort();
    relocateMobileFilters();
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

    if (typeof window.revealRequestsList === 'function') {
      window.revealRequestsList();
    }
  }

  var splitTargetTimer = null;

  function findSplitTarget(id) {
    var row = document.getElementById('request-row-' + id);
    var card = document.getElementById('request-card-' + id);

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
      window.rhExpandSplitFolder(groupId);
    }
    highlightSplitGroup(groupId, target);
    target.scrollIntoView({
      behavior: options.smooth === false ? 'auto' : 'smooth',
      block: 'center',
    });

    if (options.updateHash !== false) {
      var nextHash = '#request-row-' + id;
      if (window.location.hash !== nextHash) {
        history.replaceState(history.state, '', nextHash);
      }
    }

    return true;
  }

  function handleSplitHash() {
    var match = window.location.hash.match(/^#request-row-(\d+)$/);
    if (!match) return;
    goToSplitTarget(match[1], { smooth: false });
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
  window.rhReadRequestFilters = readFilters;
  window.rhReadMenuFilters = readMenuFilters;

  function containerForItemId(itemId) {
    return itemId.indexOf('request-card-') === 0 ? 'requests-cards-mobile' : 'requests-body';
  }

  function insertItemNode(item, container) {
    var splitRoot = item.dataset.splitRoot;
    if (splitRoot && item.dataset.isSubtask === '1') {
      var isCard = item.id.indexOf('request-card-') === 0;
      var selector = isCard
        ? '.rh-request-card[data-split-root="' + splitRoot + '"]'
        : 'tr[data-split-root="' + splitRoot + '"]';
      var group = Array.prototype.slice.call(document.querySelectorAll(selector));
      if (group.length) {
        group[group.length - 1].insertAdjacentElement('afterend', item);
        return;
      }

      var prefix = isCard ? 'request-card-' : 'request-row-';
      var root = document.getElementById(prefix + splitRoot);
      if (root && root.parentNode) {
        root.insertAdjacentElement('afterend', item);
        return;
      }
    }

    container.appendChild(item);
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
        applyFiltersToRow(node);
        if (typeof htmx !== 'undefined') {
          htmx.process(node);
        }
      }
    });

    if (!usesDeskCatalog()) {
      reorderItems();
    }

    if (typeof window.rhSyncSplitFolders === 'function') {
      window.rhSyncSplitFolders();
    }
  }

  function refreshRequestRow(id) {
    fetch('/' + id + '/row', {
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
        refreshRequestRow(payload.id);
      }
    } catch (e) {}
  });

  window.initRequestsList = initRequestsList;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequestsList);
  } else {
    initRequestsList();
  }

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    if (!evt.detail.target || !evt.detail.target.id) return;

    if (evt.detail.target.id === 'requests-main') {
      initRequestsList();
      refreshMobileNav();
      handleSplitHash();
      var empty = document.getElementById('requests-empty');
      if (empty) {
        empty.hidden = !!document.querySelector(
          '#requests-body tr, #requests-cards-mobile .rh-request-card'
        );
      }
      return;
    }
  });
})();
