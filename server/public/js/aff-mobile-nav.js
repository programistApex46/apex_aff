(function () {
  var TAB_KEYS = ['all', 'mine', 'available'];

  function getTabsEl() {
    return document.querySelector('.rh-mobile-aff-tabs');
  }

  function getIndicator(tabsEl) {
    return tabsEl ? tabsEl.querySelector('.rh-mobile-aff-tab-indicator') : null;
  }

  function tabIndexFromKey(key) {
    var idx = TAB_KEYS.indexOf(key);
    return idx >= 0 ? idx : 0;
  }

  function syncTabVisuals(tabsEl, offset) {
    var nearest = Math.max(0, Math.min(TAB_KEYS.length - 1, Math.round(offset)));
    tabsEl.querySelectorAll('.rh-mobile-aff-tab').forEach(function (item, i) {
      var active = i === nearest;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function setIndicatorOffset(tabsEl, offset, animate) {
    var indicator = getIndicator(tabsEl);
    if (!indicator || !tabsEl) return;

    if (animate === false) {
      indicator.classList.add('is-instant');
    } else {
      indicator.classList.remove('is-dragging');
    }

    tabsEl.style.setProperty('--rh-aff-indicator-x', String(offset));
    tabsEl.setAttribute('data-filter-active', TAB_KEYS[Math.round(offset)] || 'all');
    tabsEl.setAttribute('data-active', TAB_KEYS[Math.round(offset)] || 'all');
    syncTabVisuals(tabsEl, offset);

    if (animate === false) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          indicator.classList.remove('is-instant');
        });
      });
    }
  }

  function setActiveTab(key, animate) {
    var tabsEl = getTabsEl();
    if (!tabsEl) return;
    setIndicatorOffset(tabsEl, tabIndexFromKey(key), animate !== false);
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
    syncTabVisuals(tabsEl, offset);
    if (indicator && !dragging) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          indicator.classList.remove('is-instant');
        });
      });
    }
  };

  function deskFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var assigned = params.get('assigned');
    var tabsEl = getTabsEl();
    var userId = tabsEl ? tabsEl.getAttribute('data-user-id') : '';
    if (assigned === 'none') return 'available';
    if (assigned && userId && assigned === userId) return 'mine';
    if (assigned && /^\d+$/.test(assigned)) return 'mine';
    return 'all';
  }

  function initAffNavPosition() {
    setActiveTab(deskFromUrl(), false);
  }

  function refreshAffNavCounts() {
    var wrap = document.getElementById('rh-mobile-aff-nav');
    if (!wrap) return Promise.resolve();

    return fetch('/aff-nav' + window.location.search, {
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
        var incoming = tpl.content.querySelector('.rh-mobile-aff-tabs');
        var current = wrap.querySelector('.rh-mobile-aff-tabs');
        if (!incoming || !current) return;

        incoming.querySelectorAll('.rh-mobile-aff-tab').forEach(function (incomingTab, i) {
          var tab = current.querySelectorAll('.rh-mobile-aff-tab')[i];
          if (!tab) return;

          var iconWrap = tab.querySelector('.rh-mobile-aff-tab-icon-wrap');
          if (!iconWrap) return;

          var badge = iconWrap.querySelector('.rh-mobile-aff-tab-badge');
          var incomingBadge = incomingTab.querySelector('.rh-mobile-aff-tab-badge');

          if (incomingBadge) {
            if (badge) {
              badge.textContent = incomingBadge.textContent;
            } else {
              iconWrap.insertAdjacentHTML('beforeend', incomingBadge.outerHTML);
            }
          } else if (badge) {
            badge.remove();
          }
        });
      })
      .catch(function () {});
  }

  window.refreshAffNavCounts = refreshAffNavCounts;
  window.initAffMobileNav = initAffNavPosition;
  window.syncMobileDeskTabs = function (key, animate) {
    if (!document.body.classList.contains('rh-aff-user')) return;
    setActiveTab(key, animate);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAffNavPosition);
  } else {
    initAffNavPosition();
  }
})();
