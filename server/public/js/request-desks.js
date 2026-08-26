(function () {
  var GAP = 32;
  var LOCK_RATIO = 1.2;
  var COMMIT_RATIO = 0.38;
  var FLICK_VELOCITY = 0.65;
  var SETTLE_MS = 360;
  var RUBBER = 0.22;
  var PAGE_SIZE = 10;
  var CHEVRON_LEFT =
    '<svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>';
  var CHEVRON_RIGHT =
    '<svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';

  var catalogReady = false;
  var catalogPromise = null;
  var sliderReady = false;
  var swipeBound = false;
  var currentIndex = 0;
  var deskKeys = [];
  var suppressClick = false;
  var heightObserver = null;
  var heightSyncFrame = 0;

  function isMobile() {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  function isAff() {
    return document.body.classList.contains('rh-aff-user');
  }

  function isTl() {
    return document.body.classList.contains('rh-tl-user');
  }

  function usesDesks() {
    return isMobile() && (isAff() || isTl()) && !!document.getElementById('requests-main');
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function getTabsEl() {
    if (isAff()) return document.querySelector('.rh-mobile-aff-tabs');
    if (isTl()) return document.querySelector('.rh-mobile-tl-tabs');
    return null;
  }

  function getAffUserId() {
    var tabsEl = getTabsEl();
    if (tabsEl && tabsEl.getAttribute('data-user-id')) {
      return tabsEl.getAttribute('data-user-id');
    }
    var mine = document.querySelector('.rh-mobile-aff-tab[data-tab-key="mine"]');
    if (!mine) return '';
    return new URL(mine.getAttribute('href') || '/', window.location.origin).searchParams.get('assigned') || '';
  }

  function getDeskKeys() {
    return isTl() ? ['all', 'mine'] : ['all', 'mine', 'available'];
  }

  function deskFromUrl() {
    var params = new URLSearchParams(window.location.search);
    if (isAff()) {
      var assigned = params.get('assigned');
      if (assigned === 'none') return 'available';
      if (assigned && assigned === getAffUserId()) return 'mine';
      return 'all';
    }
    return params.get('view') === 'mine' ? 'mine' : 'all';
  }

  function indexFromKey(key) {
    var idx = deskKeys.indexOf(key);
    return idx >= 0 ? idx : 0;
  }

  function urlForDesk(key) {
    var params = new URLSearchParams(window.location.search);
    var desk = deskFiltersForKey(key);

    params.delete('view');
    if (desk.view) params.set('view', desk.view);

    if (isAff()) {
      params.delete('assigned');
      if (desk.assigned) params.set('assigned', desk.assigned);
    }

    params.delete('page');
    var qs = params.toString();
    return window.location.pathname + (qs ? '?' + qs : '');
  }

  function catalogUrl() {
    var params = new URLSearchParams(window.location.search);
    params.delete('assigned');
    params.delete('view');
    params.delete('status');
    params.delete('geo');
    params.delete('buyer_id');
    params.delete('page');
    params.delete('per_page');
    params.set('catalog', '1');
    return '/list?' + params.toString();
  }

  function getSlider() {
    return document.getElementById('rh-desk-slider');
  }

  function getTrack() {
    return document.getElementById('rh-desk-track');
  }

  function getPanels() {
    var track = getTrack();
    return track ? Array.prototype.slice.call(track.querySelectorAll('.rh-desk-slider-panel')) : [];
  }

  function getPanelWidth() {
    var host = document.getElementById('requests-cards-mobile-panel');
    if (host) {
      var hostWidth = host.getBoundingClientRect().width;
      if (hostWidth > 1) return hostWidth;
    }
    var slider = getSlider();
    if (slider) {
      var sliderWidth = slider.getBoundingClientRect().width;
      if (sliderWidth > 1) return sliderWidth;
    }
    return Math.max(window.innerWidth - 24, 280);
  }

  function getStep() {
    return getPanelWidth() + GAP;
  }

  function hideDeskPagination() {
    document.querySelectorAll('#requests-main .rh-pagination:not(.rh-card-pager)').forEach(function (el) {
      el.hidden = true;
    });
  }

  function getPanelPage(panel) {
    return Math.max(1, Number(panel.getAttribute('data-rh-page')) || 1);
  }

  function scrollDeskCardsTop() {
    var host = document.getElementById('requests-cards-mobile-panel');
    if (!host) return;
    var top = host.getBoundingClientRect().top + window.scrollY - 16;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function renderDeskPager(panel, page, totalPages, total, from, to) {
    var pager = panel.querySelector('.rh-card-pager');
    if (!pager) {
      pager = document.createElement('nav');
      pager.className = 'rh-pagination rh-card-pager';
      pager.setAttribute('aria-label', 'Pagination');
      pager.setAttribute('data-no-desk-swipe', '');
      panel.appendChild(pager);
    }

    if (totalPages <= 1) {
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }

    pager.hidden = false;
    var prevDisabled = page <= 1 ? ' is-disabled' : '';
    var nextDisabled = page >= totalPages ? ' is-disabled' : '';
    pager.innerHTML =
      '<p class="rh-pagination-summary">' +
      from +
      '–' +
      to +
      ' of ' +
      total +
      '</p>' +
      '<div class="rh-pagination-bar">' +
      '<button type="button" class="rh-pagination-nav' +
      prevDisabled +
      '" data-rh-page-delta="-1" aria-label="Previous page"' +
      (page <= 1 ? ' disabled' : '') +
      '>' +
      CHEVRON_LEFT +
      '</button>' +
      '<span class="rh-pagination-status">' +
      page +
      ' / ' +
      totalPages +
      '</span>' +
      '<button type="button" class="rh-pagination-nav' +
      nextDisabled +
      '" data-rh-page-delta="1" aria-label="Next page"' +
      (page >= totalPages ? ' disabled' : '') +
      '>' +
      CHEVRON_RIGHT +
      '</button>' +
      '</div>';
  }

  function shouldPaginateSplitAsOne(filters) {
    if (filters.assigned) return false;
    if (filters.status === 'approved' || filters.status === 'rejected') return false;
    return true;
  }

  function paginationUnits(matching, filters) {
    if (!shouldPaginateSplitAsOne(filters)) return matching;

    var rootIds = new Set();
    matching.forEach(function (card) {
      if (card.getAttribute('data-is-subtask') !== '1') {
        rootIds.add(card.getAttribute('data-id'));
      }
    });

    return matching.filter(function (card) {
      if (card.getAttribute('data-is-subtask') !== '1') return true;
      var rootId = card.getAttribute('data-split-root');
      return !rootId || !rootIds.has(rootId);
    });
  }

  function showPaginationSlice(allMatching, units, start, end) {
    allMatching.forEach(function (card) {
      card.setAttribute('data-rh-page-hide', '');
    });

    units.slice(start, end).forEach(function (unit) {
      unit.removeAttribute('data-rh-page-hide');
      if (unit.getAttribute('data-is-subtask') === '1') return;
      var rootId = unit.getAttribute('data-id');
      allMatching.forEach(function (card) {
        if (
          card.getAttribute('data-is-subtask') === '1' &&
          card.getAttribute('data-split-root') === rootId
        ) {
          card.removeAttribute('data-rh-page-hide');
        }
      });
    });
  }

  function paginatePanel(panel, matching, filters, resetPage) {
    var units = paginationUnits(matching, filters);
    var total = units.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    var page = resetPage ? 1 : getPanelPage(panel);
    if (page > totalPages) page = totalPages;
    panel.setAttribute('data-rh-page', String(page));

    var start = (page - 1) * PAGE_SIZE;
    var end = start + PAGE_SIZE;
    showPaginationSlice(matching, units, start, end);

    renderDeskPager(
      panel,
      page,
      totalPages,
      total,
      total === 0 ? 0 : start + 1,
      Math.min(end, total)
    );
  }

  function deskFiltersForKey(key) {
    var desk = { assigned: '', view: '' };
    if (isAff()) {
      if (key === 'mine' && getAffUserId()) desk.assigned = getAffUserId();
      else if (key === 'available') desk.assigned = 'none';
    } else if (isTl() && key === 'mine') {
      desk.view = 'mine';
    }
    return desk;
  }

  function readMenuFilters() {
    if (typeof window.rhReadMenuFilters === 'function') {
      return window.rhReadMenuFilters();
    }
    return { status: '', geo: '', buyer_id: '', assigned: '' };
  }

  function filtersForDesk(key) {
    var menu = readMenuFilters();
    var desk = deskFiltersForKey(key);
    return {
      status: menu.status || '',
      geo: menu.geo || '',
      buyer_id: menu.buyer_id || '',
      assigned: desk.assigned || menu.assigned || '',
      view: desk.view || '',
    };
  }

  function cardMatches(card, filters) {
    if (typeof window.rhMatchRequestRow === 'function') {
      return window.rhMatchRequestRow(card, filters);
    }
    return true;
  }

  function syncSliderHeight() {
    var slider = getSlider();
    var panels = getPanels();
    if (!slider || !panels.length) return;

    var track = getTrack();
    if (track && track.classList.contains('is-dragging')) return;

    var active = panels[currentIndex];
    if (!active) return;

    var height = active.getBoundingClientRect().height;
    if (height > 0) slider.style.height = Math.ceil(height) + 'px';
  }

  function queueSliderHeightSync() {
    if (heightSyncFrame) return;
    heightSyncFrame = requestAnimationFrame(function () {
      heightSyncFrame = 0;
      syncSliderHeight();
    });
  }

  function observeActivePanelHeight() {
    if (heightObserver) {
      heightObserver.disconnect();
      heightObserver = null;
    }
    if (typeof ResizeObserver === 'undefined') return;

    var panels = getPanels();
    var active = panels[currentIndex];
    if (!active) return;

    heightObserver = new ResizeObserver(function () {
      queueSliderHeightSync();
    });
    heightObserver.observe(active);
  }

  function applyDeskFilters(options) {
    if (!sliderReady) return;
    options = options || {};

    getPanels().forEach(function (panel) {
      var key = panel.getAttribute('data-desk');
      var filters = filtersForDesk(key);
      var list = panel.querySelector('.rh-cards-list');
      var empty = panel.querySelector('.rh-filtered-empty');
      if (!list) return;

      var groupCache = new Map();
      function groupMatches(rootId) {
        if (!groupCache.has(rootId)) {
          groupCache.set(
            rootId,
            typeof window.rhSplitGroupMatchesFilters === 'function'
              ? window.rhSplitGroupMatchesFilters(rootId, filters, list)
              : false
          );
        }
        return groupCache.get(rootId);
      }

      var matching = [];
      list.querySelectorAll('.rh-request-card').forEach(function (card) {
        if (card.style.display === 'none') card.style.removeProperty('display');
        var show = cardMatches(card, filters);
        var isRoot = card.getAttribute('data-is-split-root') === '1';
        var isChild = card.getAttribute('data-is-subtask') === '1';
        var rootId = isRoot ? card.getAttribute('data-id') : card.getAttribute('data-split-root');

        if (rootId && (isRoot || isChild)) {
          var matchesGroup = groupMatches(rootId);
          if (isRoot) show = matchesGroup;
          else if (!matchesGroup) show = false;
          else show = true;
        }

        if (show) {
          card.removeAttribute('data-rh-desk-hide');
          matching.push(card);
        } else {
          card.setAttribute('data-rh-desk-hide', '');
          card.removeAttribute('data-rh-page-hide');
        }
      });

      if (empty) empty.hidden = matching.length > 0;
      paginatePanel(panel, matching, filters, !!options.resetPage);
    });

    queueSliderHeightSync();
  }

  function layoutPanels() {
    var width = getPanelWidth();
    getPanels().forEach(function (panel) {
      panel.style.width = width + 'px';
      panel.style.flexBasis = width + 'px';
    });
  }

  function setTrackX(x, mode) {
    var track = getTrack();
    if (!track) return;
    track.classList.toggle('is-dragging', mode === 'drag');
    track.classList.toggle('is-settling', mode === 'settle');
    track.style.transform = 'translate3d(' + x + 'px, 0, 0)';
  }

  function offsetToX(offset) {
    return -offset * getStep();
  }

  function readTrackOffset() {
    var track = getTrack();
    if (!track) return currentIndex;
    var transform = getComputedStyle(track).transform;
    if (!transform || transform === 'none') return currentIndex;
    var match = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
    if (!match) return currentIndex;
    var parts = match[1].split(',');
    var x = parseFloat(parts.length === 16 ? parts[12] : parts[4]) || 0;
    var step = getStep();
    return step ? -x / step : currentIndex;
  }

  function rubberOffset(raw) {
    var max = deskKeys.length - 1;
    if (raw < 0) return raw * RUBBER;
    if (raw > max) return max + (raw - max) * RUBBER;
    return raw;
  }

  function syncTabOffset(offset, dragging) {
    if (typeof window.syncMobileDeskTabOffset === 'function') {
      window.syncMobileDeskTabOffset(offset, dragging);
      return;
    }
    if (typeof window.syncMobileDeskTabs === 'function') {
      var nearest = deskKeys[Math.max(0, Math.min(deskKeys.length - 1, Math.round(offset)))];
      window.syncMobileDeskTabs(nearest, !dragging);
    }
  }

  function setActivePanel(index) {
    getPanels().forEach(function (panel, i) {
      var active = i === index;
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      panel.classList.toggle('is-active-desk-panel', active);
    });
    observeActivePanelHeight();
  }

  function commitDesk(index, options) {
    options = options || {};
    var key = deskKeys[index] || 'all';
    currentIndex = index;
    setActivePanel(index);

    if (typeof window.syncMobileDeskTabs === 'function') {
      window.syncMobileDeskTabs(key, options.animate !== false);
    } else {
      syncTabOffset(index, false);
    }

    var next = urlForDesk(key);
    var current = window.location.pathname + window.location.search;
    if (options.push !== false && next !== current) {
      history.pushState({ rhDesk: key }, '', next);
    } else if (options.replace && next !== current) {
      history.replaceState({ rhDesk: key }, '', next);
    }

    if (typeof window.handleRequestsHistoryChange === 'function' && options.syncHistory !== false) {
      window.handleRequestsHistoryChange();
    }
  }

  function goTo(index, options) {
    options = options || {};
    index = Math.max(0, Math.min(deskKeys.length - 1, index));
    layoutPanels();

    var animate = options.animate !== false && !prefersReducedMotion();
    setTrackX(offsetToX(index), animate ? 'settle' : 'snap');
    syncTabOffset(index, false);

    if (index !== currentIndex || options.forceCommit) {
      commitDesk(
        index,
        Object.assign({ syncHistory: false }, options)
      );
    }

    queueSliderHeightSync();

    if (animate) {
      window.setTimeout(function () {
        var track = getTrack();
        if (track) track.classList.remove('is-settling');
        queueSliderHeightSync();
      }, SETTLE_MS + 20);
    }
  }

  function cloneCard(card) {
    var clone = card.cloneNode(true);
    clone.removeAttribute('id');
    clone.setAttribute('data-desk-clone', '1');
    return clone;
  }

  function dedupeCanonicalCards() {
    var allList = document.getElementById('requests-cards-mobile');
    if (!allList) return;

    var groups = new Map();
    allList.querySelectorAll('.rh-request-card:not([data-desk-clone="1"])').forEach(function (card) {
      var dataId = card.getAttribute('data-id');
      if (!dataId) return;
      if (!groups.has(dataId)) groups.set(dataId, []);
      groups.get(dataId).push(card);
    });

    groups.forEach(function (cards, dataId) {
      if (cards.length <= 1) return;

      cards.forEach(function (card) {
        if (card.getAttribute('data-is-subtask') !== '1') return;
        var splitRoot = card.getAttribute('data-split-root');
        if (!splitRoot || typeof window.rhRequestDomSlug !== 'function') return;
        var root = document.getElementById('request-card-' + window.rhRequestDomSlug(splitRoot));
        if (!root) return;
        if (root.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING) {
          card.remove();
        }
      });

      var remaining = allList.querySelectorAll(
        '.rh-request-card[data-id="' + dataId + '"]:not([data-desk-clone="1"])'
      );
      for (var i = 0; i < remaining.length - 1; i += 1) {
        remaining[i].remove();
      }
    });
  }

  function removeCloneByDataId(dataId) {
    document
      .querySelectorAll(
        '.rh-desk-slider-panel:not([data-desk="all"]) .rh-request-card[data-id="' + dataId + '"]'
      )
      .forEach(function (card) {
        card.remove();
      });
  }

  function syncOneClone(canonical, dataId) {
    deskKeys.forEach(function (key) {
      if (key === 'all') return;
      var list = document.querySelector('.rh-desk-slider-panel[data-desk="' + key + '"] .rh-cards-list');
      if (!list) return;

      var existing = list.querySelector('.rh-request-card[data-id="' + dataId + '"]');
      var next = cloneCard(canonical);
      if (existing) {
        existing.replaceWith(next);
      } else {
        var allList = document.getElementById('requests-cards-mobile');
        var canonCards = allList
          ? allList.querySelectorAll('.rh-request-card:not([data-desk-clone="1"])')
          : [];
        var idx = -1;
        for (var i = 0; i < canonCards.length; i += 1) {
          if (canonCards[i].getAttribute('data-id') === dataId) {
            idx = i;
            break;
          }
        }
        var cloneCards = list.querySelectorAll('.rh-request-card');
        if (idx >= 0 && idx < cloneCards.length) cloneCards[idx].replaceWith(next);
        else if (idx >= cloneCards.length) list.appendChild(next);
        else list.insertBefore(next, cloneCards[idx] || null);
      }
      if (typeof htmx !== 'undefined') htmx.process(next);
    });
  }

  function syncClonesFull() {
    dedupeCanonicalCards();
    if (typeof window.rhReunifySplitGroups === 'function') window.rhReunifySplitGroups();
    var allPanel = document.querySelector('.rh-desk-slider-panel[data-desk="all"] .rh-cards-list');
    if (!allPanel) return;

    var cards = Array.prototype.slice.call(allPanel.querySelectorAll('.rh-request-card'));
    deskKeys.forEach(function (key) {
      if (key === 'all') return;
      var list = document.querySelector('.rh-desk-slider-panel[data-desk="' + key + '"] .rh-cards-list');
      if (!list) return;
      list.replaceChildren();
      cards.forEach(function (card) {
        var clone = cloneCard(card);
        list.appendChild(clone);
        if (typeof htmx !== 'undefined') htmx.process(clone);
      });
    });

    applyDeskFilters();
    scheduleSplitFolderSync();
  }

  var syncClonesFrame = 0;

  function syncClones(options) {
    options = options || {};
    if (options.incremental && options.dataIds && options.dataIds.length) {
      dedupeCanonicalCards();
      options.dataIds.forEach(function (dataId) {
        var canonical = findCanonicalCard(dataId);
        if (canonical) syncOneClone(canonical, dataId);
        else removeCloneByDataId(dataId);
      });
      if (options.removeIds) {
        options.removeIds.forEach(removeCloneByDataId);
      }
      applyDeskFilters();
      scheduleSplitFolderSync();
      return;
    }

    if (options.immediate) {
      if (syncClonesFrame) {
        cancelAnimationFrame(syncClonesFrame);
        syncClonesFrame = 0;
      }
      syncClonesFull();
      return;
    }

    if (syncClonesFrame) return;
    syncClonesFrame = requestAnimationFrame(function () {
      syncClonesFrame = 0;
      syncClonesFull();
    });
  }

  function buildSlider() {
    var host = document.getElementById('requests-cards-mobile-panel');
    var sourceList = document.getElementById('requests-cards-mobile');
    if (!host || !sourceList || sliderReady) {
      if (sliderReady) {
        layoutPanels();
        syncClones({ immediate: true });
      }
      return;
    }

    deskKeys = getDeskKeys();
    var cards = Array.prototype.slice.call(sourceList.querySelectorAll('.rh-request-card'));
    var emptySource = document.getElementById('requests-filtered-empty-mobile');

    var slider = document.createElement('div');
    slider.id = 'rh-desk-slider';
    slider.className = 'rh-desk-slider';

    var track = document.createElement('div');
    track.id = 'rh-desk-track';
    track.className = 'rh-desk-slider-track';

    deskKeys.forEach(function (key, index) {
      var panel = document.createElement('div');
      panel.className = 'rh-desk-slider-panel';
      panel.setAttribute('data-desk', key);
      panel.setAttribute('role', 'tabpanel');

      var empty = document.createElement('div');
      empty.className = 'rh-filtered-empty';
      empty.id = 'rh-desk-empty-' + key;
      empty.hidden = true;
      empty.innerHTML =
        '<p class="rh-secondary mb-1">No requests on this desk</p>';

      var list = document.createElement('div');
      list.className = 'rh-cards-list';
      if (key === 'all') list.id = 'requests-cards-mobile';

      if (key === 'all') {
        cards.forEach(function (card) {
          card.style.display = '';
          list.appendChild(card);
        });
      }

      panel.appendChild(empty);
      panel.appendChild(list);
      track.appendChild(panel);
    });

    slider.appendChild(track);

    host.querySelectorAll('.rh-pagination:not(.rh-card-pager)').forEach(function (el) {
      el.hidden = true;
    });

    if (emptySource) emptySource.hidden = true;
    sourceList.remove();
    host.hidden = false;
    host.removeAttribute('hidden');

    host.insertBefore(slider, host.firstChild);
    sliderReady = true;
    layoutPanels();
    syncClones({ immediate: true });
    bindSwipe();
  }

  function isDeskSwipeBlocked(target) {
    return !!target.closest('input, textarea, select, [data-no-desk-swipe], .rh-split-folder-toggle');
  }

  function scheduleSplitFolderSync() {
    if (typeof window.rhSyncSplitFolders !== 'function') return;
    requestAnimationFrame(function () {
      window.rhSyncSplitFolders();
    });
  }

  function bindSwipe() {
    var slider = getSlider();
    if (!slider || swipeBound) return;
    swipeBound = true;

    var activePointerId = null;
    var tracking = false;
    var axis = null;
    var startX = 0;
    var startY = 0;
    var lastX = 0;
    var lastT = 0;
    var velocityX = 0;
    var baseOffset = 0;
    var dragFrame = 0;
    var pendingOffset = 0;

    function applyDrag() {
      dragFrame = 0;
      var offset = rubberOffset(pendingOffset);
      setTrackX(offsetToX(offset), 'drag');
      syncTabOffset(offset, true);
    }

    function snapBack() {
      goTo(currentIndex, { animate: true, push: false, syncHistory: false });
    }

    function releasePointer(evt) {
      if (!evt || !slider.releasePointerCapture) return;
      try {
        slider.releasePointerCapture(evt.pointerId);
      } catch (_err) {
        /* ignore */
      }
    }

    function resetPointerState(evt) {
      releasePointer(evt);
      activePointerId = null;
      tracking = false;
      axis = null;
      if (dragFrame) {
        cancelAnimationFrame(dragFrame);
        dragFrame = 0;
      }
    }

    function finishDrag(evt) {
      if (!tracking) {
        suppressClick = false;
        return;
      }

      var wasHorizontal = axis === 'x';
      tracking = false;
      axis = null;

      if (dragFrame) {
        cancelAnimationFrame(dragFrame);
        dragFrame = 0;
      }

      if (!wasHorizontal) {
        suppressClick = false;
        return;
      }

      var endX = evt && typeof evt.clientX === 'number' ? evt.clientX : lastX;
      var dx = endX - startX;
      var max = deskKeys.length - 1;
      var target = currentIndex;

      if (velocityX <= -FLICK_VELOCITY && currentIndex < max) {
        target = currentIndex + 1;
      } else if (velocityX >= FLICK_VELOCITY && currentIndex > 0) {
        target = currentIndex - 1;
      } else if (dx <= -getPanelWidth() * COMMIT_RATIO && currentIndex < max) {
        target = currentIndex + 1;
      } else if (dx >= getPanelWidth() * COMMIT_RATIO && currentIndex > 0) {
        target = currentIndex - 1;
      }

      window.setTimeout(function () {
        suppressClick = false;
      }, 80);

      if (target === currentIndex) {
        snapBack();
        return;
      }

      goTo(target, { animate: true, push: true, syncHistory: false });
    }

    slider.addEventListener(
      'pointerdown',
      function (evt) {
        if (activePointerId !== null) return;
        if (!sliderReady) return;
        if (document.body.classList.contains('rh-quiz-open')) return;
        if (isDeskSwipeBlocked(evt.target)) return;
        if (evt.pointerType === 'mouse' && evt.button !== 0) return;

        var track = getTrack();
        if (track && track.classList.contains('is-settling')) {
          baseOffset = readTrackOffset();
          track.classList.remove('is-settling');
        } else {
          baseOffset = currentIndex;
        }

        activePointerId = evt.pointerId;
        tracking = true;
        axis = null;
        startX = evt.clientX;
        startY = evt.clientY;
        lastX = startX;
        lastT = performance.now();
        velocityX = 0;
        pendingOffset = baseOffset;
        suppressClick = false;

        if (slider.setPointerCapture) {
          try {
            slider.setPointerCapture(evt.pointerId);
          } catch (_err) {
            /* ignore */
          }
        }
      },
      { passive: true }
    );

    slider.addEventListener(
      'pointermove',
      function (evt) {
        if (evt.pointerId !== activePointerId || !tracking) return;

        var x = evt.clientX;
        var y = evt.clientY;
        var dx = x - startX;
        var dy = y - startY;

        if (!axis) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          axis = Math.abs(dx) > Math.abs(dy) * LOCK_RATIO ? 'x' : 'y';
          if (axis === 'y') {
            resetPointerState(evt);
            return;
          }
        }

        if (axis !== 'x') return;

        if (evt.cancelable) evt.preventDefault();
        suppressClick = true;

        var now = performance.now();
        var dt = Math.max(now - lastT, 1);
        velocityX = (x - lastX) / dt;
        lastX = x;
        lastT = now;
        pendingOffset = baseOffset - dx / getStep();

        if (!dragFrame) dragFrame = requestAnimationFrame(applyDrag);
      },
      { passive: false }
    );

    function onPointerEnd(evt) {
      if (evt.pointerId !== activePointerId) return;
      releasePointer(evt);
      finishDrag(evt);
      activePointerId = null;
    }

    slider.addEventListener('pointerup', onPointerEnd, { passive: true });
    slider.addEventListener('pointercancel', function (evt) {
      if (evt.pointerId !== activePointerId) return;
      resetPointerState(evt);
      suppressClick = false;
      snapBack();
    });

    slider.addEventListener(
      'click',
      function (evt) {
        if (!suppressClick) return;
        if (isDeskSwipeBlocked(evt.target)) return;
        evt.preventDefault();
        evt.stopPropagation();
      },
      true
    );
  }

  function mergeCatalog(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html.trim();

    var incomingCards = tpl.content.querySelector('#requests-cards-mobile');
    var incomingRows = tpl.content.querySelector('#requests-body');
    var allList = document.getElementById('requests-cards-mobile');
    var body = document.getElementById('requests-body');

    if (incomingRows && body) {
      body.replaceChildren();
      incomingRows.querySelectorAll('tr').forEach(function (row) {
        body.appendChild(row);
      });
      if (typeof htmx !== 'undefined') htmx.process(body);
    }

    if (incomingCards && allList) {
      allList.replaceChildren();
      incomingCards.querySelectorAll('.rh-request-card').forEach(function (card) {
        allList.appendChild(card);
      });
      if (typeof htmx !== 'undefined') htmx.process(allList);
    }

    hideDeskPagination();
    catalogReady = true;

    if (sliderReady) {
      syncClones({ immediate: true });
      layoutPanels();
      setTrackX(offsetToX(currentIndex), 'snap');
    } else if (typeof window.applyRequestsSearch === 'function') {
      window.applyRequestsSearch();
    }

    if (typeof window.relocateMobileFilters === 'function') {
      window.relocateMobileFilters();
    }
  }

  function ensureCatalog() {
    if (!usesDesks()) return Promise.resolve();
    if (catalogReady) return Promise.resolve();
    if (catalogPromise) return catalogPromise;

    catalogPromise = fetch(catalogUrl(), { credentials: 'same-origin' })
      .then(function (res) {
        return res.ok ? res.text() : '';
      })
      .then(function (html) {
        if (html) mergeCatalog(html);
      })
      .catch(function () {})
      .finally(function () {
        catalogPromise = null;
      });

    return catalogPromise;
  }

  function onTabClick(evt) {
    if (!usesDesks()) return;

    var tab = evt.target.closest(
      '#rh-mobile-aff-nav .rh-mobile-aff-tab[data-tab-key], #rh-mobile-tl-nav .rh-mobile-aff-tab[data-tab-key]'
    );
    if (!tab || !tab.getAttribute('href')) return;

    var key = tab.getAttribute('data-tab-key');
    if (!key || key === 'create' || key === 'profile') return;

    evt.preventDefault();
    evt.stopPropagation();

    if (document.body.classList.contains('rh-account-open') && typeof window.closeAccountDropdown === 'function') {
      window.closeAccountDropdown();
    }

    var index = indexFromKey(key);
    if (index === currentIndex && sliderReady) {
      applyDeskFilters({ resetPage: true });
      scrollDeskCardsTop();
      return;
    }

    if (sliderReady) {
      goTo(index, { animate: true, push: true, syncHistory: false });
    } else {
      commitDesk(index, { animate: true, push: true, syncHistory: false });
    }
    ensureCatalog();
  }

  function findCanonicalCard(dataId, preferredId) {
    if (preferredId) {
      var byId = document.getElementById(preferredId);
      if (byId && byId.getAttribute('data-id') === dataId && !byId.hasAttribute('data-desk-clone')) {
        return byId;
      }
    }

    var allList = document.getElementById('requests-cards-mobile');
    if (!allList) return null;

    var match = allList.querySelector('.rh-request-card[data-id="' + dataId + '"]:not([data-desk-clone="1"])');
    return match || null;
  }

  function syncCard(incoming) {
    if (!incoming || !incoming.classList.contains('rh-request-card')) return false;
    if (!sliderReady) return false;

    var dataId = incoming.getAttribute('data-id');
    if (!dataId) return false;

    var allList = document.getElementById('requests-cards-mobile');
    if (!allList) return false;

    var canonical = findCanonicalCard(dataId, incoming.id || '');

    if (canonical) {
      var next = incoming.cloneNode(true);
      next.id = canonical.id;
      canonical.replaceWith(next);
      if (typeof htmx !== 'undefined') htmx.process(next);
      syncClones({ incremental: true, dataIds: [dataId] });
      return true;
    }

    var node = incoming.cloneNode(true);
    if (typeof window.rhInsertRequestItem === 'function') {
      window.rhInsertRequestItem(node, allList);
    } else {
      allList.appendChild(node);
    }
    if (typeof htmx !== 'undefined') htmx.process(node);
    syncClones({ incremental: true, dataIds: [dataId] });
    return true;
  }

  function initRequestDesks(options) {
    options = options || {};
    if (!usesDesks()) return;

    if (options.reset) {
      catalogReady = false;
      catalogPromise = null;
      sliderReady = false;
      swipeBound = false;
    }

    deskKeys = getDeskKeys();
    currentIndex = indexFromKey(deskFromUrl());
    hideDeskPagination();
    buildSlider();
    if (sliderReady) {
      goTo(currentIndex, {
        animate: false,
        push: false,
        replace: true,
        syncHistory: false,
        forceCommit: true,
      });
    } else if (typeof window.syncMobileDeskTabs === 'function') {
      window.syncMobileDeskTabs(deskFromUrl(), false);
    }

    ensureCatalog().then(function () {
      if (!usesDesks()) return;
      if (!sliderReady) {
        currentIndex = indexFromKey(deskFromUrl());
        buildSlider();
        goTo(currentIndex, {
          animate: false,
          push: false,
          replace: true,
          syncHistory: false,
          forceCommit: true,
        });
        return;
      }
      layoutPanels();
      setTrackX(offsetToX(currentIndex), 'snap');
    });
  }

  window.addEventListener('resize', function () {
    if (!sliderReady) return;
    layoutPanels();
    setTrackX(offsetToX(currentIndex), 'snap');
    queueSliderHeightSync();
  });

  document.body.addEventListener('click', function (evt) {
    var btn = evt.target.closest('.rh-card-pager [data-rh-page-delta]');
    if (!btn || btn.disabled || btn.classList.contains('is-disabled')) return;
    var panel = btn.closest('.rh-desk-slider-panel');
    if (!panel) return;
    evt.preventDefault();
    var delta = Number(btn.getAttribute('data-rh-page-delta')) || 0;
    panel.setAttribute('data-rh-page', String(getPanelPage(panel) + delta));
    applyDeskFilters();
    scrollDeskCardsTop();
  });

  document.body.addEventListener('click', onTabClick, true);

  window.addEventListener('popstate', function () {
    if (!usesDesks() || !sliderReady) return;
    goTo(indexFromKey(deskFromUrl()), { animate: true, push: false, syncHistory: false });
  });

  window.ensureRequestDesks = ensureCatalog;
  window.initRequestDesks = initRequestDesks;
  window.rhDeskKeyFromUrl = deskFromUrl;
  window.rhDeskFiltersForKey = deskFiltersForKey;
  window.rhSyncDeskFromUrl = function () {
    if (!usesDesks()) return;
    var key = deskFromUrl();
    if (typeof window.syncMobileDeskTabs === 'function') {
      window.syncMobileDeskTabs(key, false);
    }
    if (!sliderReady) return;
    var index = indexFromKey(key);
    if (index !== currentIndex) {
      goTo(index, { animate: false, push: false, syncHistory: false, forceCommit: true });
      return;
    }
    layoutPanels();
    setTrackX(offsetToX(index), 'snap');
    syncTabOffset(index, false);
  };
  window.rhDesksApplyFilters = function () {
    applyDeskFilters({ resetPage: true });
  };
  window.rhDesksSyncClones = syncClones;
  window.rhDesksSyncCard = syncCard;

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    var id = evt.detail && evt.detail.target && evt.detail.target.id;
    if (id === 'requests-main' || id === 'rh-page') {
      initRequestDesks({ reset: true });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequestDesks);
  } else {
    initRequestDesks();
  }
})();
