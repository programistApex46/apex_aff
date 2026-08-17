(function () {
  var GAP = 32;
  var LOCK_RATIO = 1.15;
  var COMMIT_RATIO = 0.18;
  var FLICK_VELOCITY = 0.42;
  var SETTLE_MS = 420;
  var RUBBER = 0.28;
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

  function paginatePanel(panel, matching, resetPage) {
    var total = matching.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    var page = resetPage ? 1 : getPanelPage(panel);
    if (page > totalPages) page = totalPages;
    panel.setAttribute('data-rh-page', String(page));

    var start = (page - 1) * PAGE_SIZE;
    var end = start + PAGE_SIZE;
    matching.forEach(function (card, i) {
      if (i >= start && i < end) card.removeAttribute('data-rh-page-hide');
      else card.setAttribute('data-rh-page-hide', '');
    });

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

  function applyDeskFilters(options) {
    if (!sliderReady) return;
    options = options || {};

    getPanels().forEach(function (panel) {
      var key = panel.getAttribute('data-desk');
      var filters = filtersForDesk(key);
      var list = panel.querySelector('.rh-cards-list');
      var empty = panel.querySelector('.rh-filtered-empty');
      if (!list) return;

      var matching = [];
      list.querySelectorAll('.rh-request-card').forEach(function (card) {
        card.style.display = '';
        var show = cardMatches(card, filters);
        if (show) {
          card.removeAttribute('data-rh-desk-hide');
          matching.push(card);
        } else {
          card.setAttribute('data-rh-desk-hide', '');
          card.removeAttribute('data-rh-page-hide');
        }
      });

      if (empty) empty.hidden = matching.length > 0;
      paginatePanel(panel, matching, !!options.resetPage);
    });
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
    var slider = getSlider();
    if (!track) return;
    track.classList.toggle('is-dragging', mode === 'drag');
    track.classList.toggle('is-settling', mode === 'settle');
    if (slider) slider.classList.toggle('is-dragging', mode === 'drag');
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
    });
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
    commitDesk(index, options);
    applyDeskFilters({ resetPage: !!options.resetPage });

    if (animate) {
      window.setTimeout(function () {
        var track = getTrack();
        if (track) track.classList.remove('is-settling');
      }, SETTLE_MS + 30);
    }
  }

  function cloneCard(card) {
    var clone = card.cloneNode(true);
    clone.removeAttribute('id');
    clone.setAttribute('data-desk-clone', '1');
    return clone;
  }

  function syncClones() {
    var allPanel = document.querySelector('.rh-desk-slider-panel[data-desk="all"] .rh-cards-list');
    if (!allPanel) return;

    var cards = Array.prototype.slice.call(allPanel.querySelectorAll('.rh-request-card'));
    deskKeys.forEach(function (key) {
      if (key === 'all') return;
      var list = document.querySelector('.rh-desk-slider-panel[data-desk="' + key + '"] .rh-cards-list');
      if (!list) return;
      list.replaceChildren();
      cards.forEach(function (card) {
        list.appendChild(cloneCard(card));
      });
      if (typeof htmx !== 'undefined') htmx.process(list);
    });

    applyDeskFilters();
  }

  function buildSlider() {
    var host = document.getElementById('requests-cards-mobile-panel');
    var sourceList = document.getElementById('requests-cards-mobile');
    if (!host || !sourceList || sliderReady) {
      if (sliderReady) {
        layoutPanels();
        syncClones();
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
    syncClones();
    bindSwipe();
  }

  function bindSwipe() {
    var slider = getSlider();
    if (!slider || swipeBound) return;
    swipeBound = true;

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
    var moved = false;

    function applyDrag() {
      dragFrame = 0;
      var offset = rubberOffset(pendingOffset);
      setTrackX(offsetToX(offset), 'drag');
      syncTabOffset(offset, true);
    }

    slider.addEventListener(
      'touchstart',
      function (evt) {
        if (!sliderReady || evt.touches.length !== 1) return;
        if (document.body.classList.contains('rh-quiz-open')) return;
        if (evt.target.closest('input, textarea, select, [data-no-desk-swipe]')) return;

        var track = getTrack();
        if (track && track.classList.contains('is-settling')) {
          baseOffset = readTrackOffset();
          track.classList.remove('is-settling');
        } else {
          baseOffset = currentIndex;
        }

        tracking = true;
        axis = null;
        moved = false;
        startX = evt.touches[0].clientX;
        startY = evt.touches[0].clientY;
        lastX = startX;
        lastT = performance.now();
        velocityX = 0;
        pendingOffset = baseOffset;
      },
      { passive: true }
    );

    slider.addEventListener(
      'touchmove',
      function (evt) {
        if (!tracking) return;

        var x = evt.touches[0].clientX;
        var y = evt.touches[0].clientY;
        var dx = x - startX;
        var dy = y - startY;

        if (!axis) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          axis = Math.abs(dx) > Math.abs(dy) * LOCK_RATIO ? 'x' : 'y';
          if (axis === 'y') {
            tracking = false;
            return;
          }
        }

        if (axis !== 'x') return;

        evt.preventDefault();
        moved = true;
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

    function finish(evt) {
      if (!tracking) return;
      tracking = false;

      if (dragFrame) {
        cancelAnimationFrame(dragFrame);
        dragFrame = 0;
      }

      if (axis !== 'x') {
        axis = null;
        return;
      }
      axis = null;

      var dx = (evt.changedTouches && evt.changedTouches[0] ? evt.changedTouches[0].clientX : lastX) - startX;
      var offset = rubberOffset(baseOffset - dx / getStep());
      var max = deskKeys.length - 1;
      var target = Math.round(offset);

      if (velocityX <= -FLICK_VELOCITY && baseOffset < max) {
        target = Math.min(max, Math.floor(baseOffset) + 1);
      } else if (velocityX >= FLICK_VELOCITY && baseOffset > 0) {
        target = Math.max(0, Math.ceil(baseOffset) - 1);
      } else if (dx <= -getPanelWidth() * COMMIT_RATIO && baseOffset < max) {
        target = Math.min(max, Math.floor(baseOffset) + 1);
      } else if (dx >= getPanelWidth() * COMMIT_RATIO && baseOffset > 0) {
        target = Math.max(0, Math.ceil(baseOffset) - 1);
      }

      target = Math.max(0, Math.min(max, target));
      goTo(target, { animate: true, push: true, syncHistory: true });

      window.setTimeout(function () {
        suppressClick = false;
      }, 80);
    }

    slider.addEventListener('touchend', finish, { passive: true });
    slider.addEventListener(
      'touchcancel',
      function () {
        if (!tracking) return;
        tracking = false;
        axis = null;
        if (dragFrame) {
          cancelAnimationFrame(dragFrame);
          dragFrame = 0;
        }
        goTo(currentIndex, { animate: true, push: false, syncHistory: false });
        suppressClick = false;
      },
      { passive: true }
    );

    slider.addEventListener(
      'click',
      function (evt) {
        if (!suppressClick) return;
        evt.preventDefault();
        evt.stopPropagation();
      },
      true
    );

    window.addEventListener('resize', function () {
      if (!sliderReady) return;
      layoutPanels();
      setTrackX(offsetToX(currentIndex), 'snap');
    });
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
      syncClones();
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
      goTo(index, { animate: true, push: false, syncHistory: false });
      return;
    }

    if (sliderReady) {
      goTo(index, { animate: true, push: true });
    } else {
      commitDesk(index, { animate: true, push: true });
    }
    ensureCatalog();
  }

  function syncCard(incoming) {
    if (!incoming || !incoming.classList.contains('rh-request-card')) return false;
    if (!sliderReady) return false;

    var dataId = incoming.getAttribute('data-id');
    if (!dataId) return false;

    var copies = document.querySelectorAll('.rh-request-card[data-id="' + dataId + '"]');
    if (copies.length) {
      copies.forEach(function (existing) {
        var next = incoming.cloneNode(true);
        if (existing.id) next.id = existing.id;
        else {
          next.removeAttribute('id');
          next.setAttribute('data-desk-clone', '1');
        }
        existing.replaceWith(next);
        if (typeof htmx !== 'undefined') htmx.process(next);
      });
      applyDeskFilters();
      return true;
    }

    var allList = document.querySelector('.rh-desk-slider-panel[data-desk="all"] .rh-cards-list');
    if (!allList) return false;
    allList.insertAdjacentElement('afterbegin', incoming);
    if (typeof htmx !== 'undefined') htmx.process(incoming);
    syncClones();
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
    hideDeskPagination();
    buildSlider();
    currentIndex = indexFromKey(deskFromUrl());
    if (sliderReady) {
      goTo(currentIndex, { animate: false, push: false, replace: true, syncHistory: false });
    } else if (typeof window.syncMobileDeskTabs === 'function') {
      window.syncMobileDeskTabs(deskFromUrl(), false);
    }

    ensureCatalog().then(function () {
      if (!usesDesks()) return;
      if (!sliderReady) {
        buildSlider();
        currentIndex = indexFromKey(deskFromUrl());
        goTo(currentIndex, { animate: false, push: false, replace: true, syncHistory: false });
        return;
      }
      layoutPanels();
      setTrackX(offsetToX(currentIndex), 'snap');
    });
  }

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
  window.rhDesksApplyFilters = function () {
    applyDeskFilters({ resetPage: true });
  };
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
