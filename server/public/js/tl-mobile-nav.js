(function () {
  var TRACK_KEYS = ['all', 'mine'];
  var currentOffset = 0;

  function getDock() {
    return document.querySelector('.rh-mobile-tl-dock');
  }

  function getTabsEl() {
    return document.querySelector('.rh-mobile-tl-tabs');
  }

  function getIndicator(tabsEl) {
    return tabsEl ? tabsEl.querySelector('.rh-mobile-aff-tab-indicator') : null;
  }

  function getTrackTabs(tabsEl) {
    return tabsEl ? tabsEl.querySelectorAll('.rh-mobile-aff-tab') : [];
  }

  function keyFromUrl() {
    return new URLSearchParams(window.location.search).get('view') === 'mine' ? 'mine' : 'all';
  }

  function trackIndexFromKey(key) {
    var idx = TRACK_KEYS.indexOf(key);
    return idx >= 0 ? idx : 0;
  }

  function syncTrackVisuals(tabsEl, offset) {
    var nearest = Math.max(0, Math.min(TRACK_KEYS.length - 1, Math.round(offset)));
    getTrackTabs(tabsEl).forEach(function (item, i) {
      var active = i === nearest;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function syncCreateSize() {
    var dock = getDock();
    var nav = document.getElementById('rh-mobile-tl-nav');
    if (!dock || !nav) return;
    var h = nav.getBoundingClientRect().height;
    if (h <= 0) return;
    dock.style.setProperty('--rh-tl-create-size', Math.round(h) + 'px');
  }

  function setTrackIndicator(tabsEl, index, animate) {
    var indicator = getIndicator(tabsEl);
    if (!indicator || !tabsEl) return;

    currentOffset = index;

    if (animate === false) {
      indicator.classList.add('is-instant');
    } else {
      indicator.classList.remove('is-dragging');
    }

    tabsEl.style.setProperty('--rh-aff-indicator-x', String(index));
    tabsEl.setAttribute('data-active', TRACK_KEYS[index] || 'all');
    tabsEl.setAttribute('data-filter-active', TRACK_KEYS[index] || 'all');
    syncTrackVisuals(tabsEl, index);

    if (animate === false) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          indicator.classList.remove('is-instant');
        });
      });
    }
  }

  function setTrackActive(key, animate) {
    var tabsEl = getTabsEl();
    if (!tabsEl) return;
    setTrackIndicator(tabsEl, trackIndexFromKey(key), animate !== false);
  }

  window.syncMobileDeskTabOffset = function (offset, dragging) {
    var tabsEl = getTabsEl();
    if (!tabsEl) return;
    var indicator = getIndicator(tabsEl);
    if (indicator) {
      indicator.classList.toggle('is-dragging', !!dragging);
      if (!dragging) {
        indicator.classList.add('is-instant');
      }
    }
    tabsEl.style.setProperty('--rh-aff-indicator-x', String(offset));
    syncTrackVisuals(tabsEl, offset);
    if (indicator && !dragging) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          indicator.classList.remove('is-instant');
        });
      });
    }
  };

  function syncFromUrl(animate) {
    setTrackActive(keyFromUrl(), animate !== false);
  }

  function refreshTlNavCounts() {
    var wrap = document.getElementById('rh-mobile-tl-nav');
    if (!wrap) return Promise.resolve();

    return fetch('/tl-nav' + window.location.search, {
      credentials: 'same-origin',
      headers: { 'HX-Request': 'true' },
    })
      .then(function (res) {
        return res.ok ? res.text() : null;
      })
      .then(function (html) {
        if (!html) return;

        var tpl = document.createElement('template');
        tpl.innerHTML = html.trim();
        var incoming = tpl.content.querySelector('.rh-mobile-tl-tabs');
        var current = wrap.querySelector('.rh-mobile-tl-tabs');
        if (!incoming || !current) return;

        var incomingMine = incoming.querySelector('[data-tab-key="mine"]');
        var currentMine = current.querySelector('[data-tab-key="mine"]');
        if (!incomingMine || !currentMine) return;

        var iconWrap = currentMine.querySelector('.rh-mobile-aff-tab-icon-wrap');
        if (!iconWrap) return;

        var badge = iconWrap.querySelector('.rh-mobile-aff-tab-badge');
        var incomingBadge = incomingMine.querySelector('.rh-mobile-aff-tab-badge');

        if (incomingBadge) {
          if (badge) {
            badge.textContent = incomingBadge.textContent;
          } else {
            iconWrap.insertAdjacentHTML('beforeend', incomingBadge.outerHTML);
          }
        } else if (badge) {
          badge.remove();
        }
      })
      .catch(function () {});
  }

  function patchGlobal(fnName, afterFn) {
    var original = window[fnName];
    if (typeof original !== 'function') return;

    window[fnName] = function () {
      var result = original.apply(this, arguments);
      if (afterFn) afterFn();
      return result;
    };
  }

  patchGlobal('closeRequestQuiz', function () {
    if (typeof window.ensureRequestDesks === 'function') {
      window.ensureRequestDesks();
    }
    syncFromUrl(true);
  });

  window.refreshTlNavCounts = refreshTlNavCounts;
  window.initTlMobileNav = function () {
    syncCreateSize();
    syncFromUrl(false);
    requestAnimationFrame(function () {
      syncCreateSize();
    });
  };
  window.syncMobileDeskTabs = function (key, animate) {
    if (!document.body.classList.contains('rh-tl-user')) return;
    setTrackActive(TRACK_KEYS.indexOf(key) >= 0 ? key : 'all', animate);
  };

  window.addEventListener('resize', function () {
    if (!getDock()) return;
    syncCreateSize();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initTlMobileNav);
  } else {
    window.initTlMobileNav();
  }
})();
