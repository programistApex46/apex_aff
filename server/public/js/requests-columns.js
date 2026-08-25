(function () {
  if (window.__rhRequestsColumnsBound) {
    if (typeof window.initRequestsColumns === 'function') window.initRequestsColumns();
    return;
  }
  window.__rhRequestsColumnsBound = true;

  var STORAGE_KEY = 'rh-requests-col-visibility-v1';
  var TOGGLE_KEYS = [
    'created_at',
    'company',
    'team',
    'stage',
    'geo',
    'language',
    'quantity',
    'funnel',
    'comment',
    'aff',
    'partner',
    'aff_cap',
    'aff_wh',
    'aff_price',
  ];

  var pendingHideKey = '';

  function defaultVisibility() {
    var vis = {};
    TOGGLE_KEYS.forEach(function (key) {
      vis[key] = true;
    });
    return vis;
  }

  function loadVisibility() {
    var vis = defaultVisibility();
    try {
      var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      TOGGLE_KEYS.forEach(function (key) {
        if (typeof stored[key] === 'boolean') vis[key] = stored[key];
      });
    } catch (e) {
      /* ignore */
    }
    return vis;
  }

  function saveVisibility(vis) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vis));
  }

  function hiddenCount(vis) {
    return TOGGLE_KEYS.reduce(function (count, key) {
      return vis[key] === false ? count + 1 : count;
    }, 0);
  }

  function applyToTable(table, vis) {
    if (!table) return;
    TOGGLE_KEYS.forEach(function (key) {
      table.classList.toggle('rh-col-off-' + key, vis[key] === false);
    });
  }

  function relayout() {
    if (typeof window.initRequestsTableResize === 'function') {
      window.initRequestsTableResize();
    }
  }

  function syncChips(picker, vis) {
    if (!picker) return;
    picker.querySelectorAll('[data-col-toggle]').forEach(function (chip) {
      var key = chip.getAttribute('data-col-toggle');
      var on = vis[key] !== false;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    picker.querySelectorAll('[data-col-group]').forEach(function (group) {
      var chips = group.querySelectorAll('[data-col-toggle]');
      var onCount = 0;
      chips.forEach(function (chip) {
        if (vis[chip.getAttribute('data-col-toggle')] !== false) onCount += 1;
      });
      var label = group.querySelector('[data-col-group-toggle]');
      if (label) {
        label.classList.toggle('is-mixed', onCount > 0 && onCount < chips.length);
        label.classList.toggle('is-off', onCount === 0);
      }
    });
    var reset = document.getElementById('requests-col-reset');
    if (reset) reset.hidden = hiddenCount(vis) === 0;
    var btn = document.getElementById('requests-col-btn');
    var dot = document.getElementById('requests-col-btn-dot');
    var hasHidden = hiddenCount(vis) > 0;
    if (btn) btn.classList.toggle('is-active', hasHidden);
    if (dot) dot.hidden = !hasHidden;
  }

  function commitVisibility(vis) {
    saveVisibility(vis);
    applyToTable(document.getElementById('requests-table'), vis);
    syncChips(document.getElementById('requests-col-picker'), vis);
    relayout();
  }

  function applyAll() {
    var vis = loadVisibility();
    applyToTable(document.getElementById('requests-table'), vis);
    syncChips(document.getElementById('requests-col-picker'), vis);
    relayout();
  }

  function setKey(vis, key, on) {
    if (TOGGLE_KEYS.indexOf(key) === -1) return vis;
    vis[key] = !!on;
    return vis;
  }

  function hideColumn(key) {
    if (TOGGLE_KEYS.indexOf(key) === -1) return;
    var vis = loadVisibility();
    setKey(vis, key, false);
    commitVisibility(vis);
  }

  function isPickerOpen() {
    var picker = document.getElementById('requests-col-picker');
    return !!(picker && !picker.hidden);
  }

  function closePicker() {
    var picker = document.getElementById('requests-col-picker');
    var btn = document.getElementById('requests-col-btn');
    if (picker) picker.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function openPicker() {
    var picker = document.getElementById('requests-col-picker');
    var btn = document.getElementById('requests-col-btn');
    if (!picker) return;
    picker.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function togglePicker() {
    if (isPickerOpen()) closePicker();
    else openPicker();
  }

  function closeContextMenu() {
    var menu = document.getElementById('requests-col-menu');
    if (menu) menu.hidden = true;
    pendingHideKey = '';
  }

  function openContextMenu(evt, key) {
    var menu = document.getElementById('requests-col-menu');
    if (!menu) return;
    pendingHideKey = key;
    menu.hidden = false;
    menu.style.left = '0px';
    menu.style.top = '0px';
    var x = evt.clientX;
    var y = evt.clientY;
    var rect = menu.getBoundingClientRect();
    var maxX = window.innerWidth - rect.width - 8;
    var maxY = window.innerHeight - rect.height - 8;
    menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';
  }

  function headerColKey(target) {
    var th = target && target.closest ? target.closest('#requests-table thead th[data-col-key]') : null;
    if (!th) return '';
    return th.getAttribute('data-col-key') || '';
  }

  function initRequestsColumns() {
    applyAll();
  }

  window.initRequestsColumns = initRequestsColumns;

  document.addEventListener('click', function (evt) {
    if (evt.target.closest('#requests-col-hide')) {
      if (pendingHideKey) hideColumn(pendingHideKey);
      closeContextMenu();
      return;
    }

    closeContextMenu();

    if (evt.target.closest('#requests-col-btn')) {
      evt.preventDefault();
      togglePicker();
      return;
    }

    var chip = evt.target.closest('[data-col-toggle]');
    if (chip && chip.closest('#requests-col-picker')) {
      var vis = loadVisibility();
      var key = chip.getAttribute('data-col-toggle');
      setKey(vis, key, vis[key] === false);
      commitVisibility(vis);
      return;
    }

    var groupBtn = evt.target.closest('[data-col-group-toggle]');
    if (groupBtn && groupBtn.closest('#requests-col-picker')) {
      var group = groupBtn.closest('[data-col-group]');
      if (!group) return;
      var visGroup = loadVisibility();
      var keys = [];
      group.querySelectorAll('[data-col-toggle]').forEach(function (el) {
        keys.push(el.getAttribute('data-col-toggle'));
      });
      var allOn = keys.every(function (key) {
        return visGroup[key] !== false;
      });
      keys.forEach(function (key) {
        setKey(visGroup, key, allOn ? false : true);
      });
      commitVisibility(visGroup);
      return;
    }

    if (evt.target.closest('#requests-col-reset')) {
      commitVisibility(defaultVisibility());
      return;
    }

    if (!evt.target.closest('#requests-col-picker') && !evt.target.closest('#requests-col-btn')) {
      closePicker();
    }
  });

  document.addEventListener('contextmenu', function (evt) {
    var key = headerColKey(evt.target);
    if (!key) {
      closeContextMenu();
      return;
    }
    if (TOGGLE_KEYS.indexOf(key) === -1) {
      closeContextMenu();
      return;
    }
    evt.preventDefault();
    openContextMenu(evt, key);
  });

  document.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape') {
      closeContextMenu();
      closePicker();
    }
  });

  window.addEventListener('scroll', closeContextMenu, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequestsColumns);
  } else {
    initRequestsColumns();
  }

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    if (!evt.detail || !evt.detail.target) return;
    var id = evt.detail.target.id;
    if (id === 'requests-main' || id === 'requests-list' || id === 'requests-table') {
      initRequestsColumns();
    }
  });
})();
