(function () {
  if (window.__rhRequestsColumnsBound) {
    if (typeof window.initRequestsColumns === 'function') window.initRequestsColumns();
    return;
  }
  window.__rhRequestsColumnsBound = true;

  var VISIBILITY_KEY = 'rh-requests-col-visibility-v1';
  var ORDER_KEY = 'rh-requests-col-order-v1';
  var FIXED_START = ['id'];
  var FIXED_END = ['actions'];
  var TOGGLE_KEYS = [
    'created_at',
    'company',
    'team',
    'stage',
    'geo',
    'language',
    'quantity',
    'cap_agreed',
    'funnel',
    'comment',
    'aff',
    'partner',
    'aff_cap',
    'aff_wh',
    'aff_price',
  ];
  var DEFAULT_ORDER = TOGGLE_KEYS.slice();

  var pendingHideKey = '';
  var sortableInstance = null;

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
      var stored = JSON.parse(localStorage.getItem(VISIBILITY_KEY) || '{}');
      TOGGLE_KEYS.forEach(function (key) {
        if (typeof stored[key] === 'boolean') vis[key] = stored[key];
      });
    } catch (e) {
      /* ignore */
    }
    return vis;
  }

  function saveVisibility(vis) {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(vis));
  }

  function loadOrder() {
    try {
      var stored = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
      if (!Array.isArray(stored) || !stored.length) return DEFAULT_ORDER.slice();
      var order = [];
      stored.forEach(function (key) {
        if (DEFAULT_ORDER.indexOf(key) !== -1 && order.indexOf(key) === -1) order.push(key);
      });
      DEFAULT_ORDER.forEach(function (key) {
        if (order.indexOf(key) === -1) order.push(key);
      });
      return order;
    } catch (e) {
      return DEFAULT_ORDER.slice();
    }
  }

  function saveOrder(order) {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  }

  function fullColumnOrder(order) {
    return FIXED_START.concat(order).concat(FIXED_END);
  }

  function hiddenCount(vis) {
    return TOGGLE_KEYS.reduce(function (count, key) {
      return vis[key] === false ? count + 1 : count;
    }, 0);
  }

  function orderIsDefault(order) {
    return DEFAULT_ORDER.every(function (key, index) {
      return order[index] === key;
    });
  }

  function applyToTable(table, vis) {
    if (!table) return;
    TOGGLE_KEYS.forEach(function (key) {
      table.classList.toggle('rh-col-off-' + key, vis[key] === false);
    });
  }

  function reorderRowCells(row, keys) {
    if (!row) return;
    keys.forEach(function (key) {
      var cell = row.querySelector(':scope > td[data-col-key="' + key + '"]');
      if (cell) row.appendChild(cell);
    });
  }

  function applyColumnOrder(table, order) {
    if (!table) return;
    var keys = fullColumnOrder(order);
    var theadRow = table.querySelector('thead tr');
    if (!theadRow) return;

    keys.forEach(function (key) {
      var th = theadRow.querySelector('th[data-col-key="' + key + '"]');
      if (th) theadRow.appendChild(th);
    });

    table.querySelectorAll('tbody tr').forEach(function (row) {
      reorderRowCells(row, keys);
    });
  }

  function relayout() {
    if (typeof window.initRequestsTableResize === 'function') {
      window.initRequestsTableResize();
    }
  }

  function readPickerOrder() {
    var list = document.getElementById('requests-col-order-list');
    if (!list) return DEFAULT_ORDER.slice();
    return Array.prototype.map
      .call(list.querySelectorAll('.rh-col-picker-row'), function (row) {
        return row.getAttribute('data-col-key');
      })
      .filter(Boolean);
  }

  function syncPickerOrder(order) {
    var list = document.getElementById('requests-col-order-list');
    if (!list) return;
    order.forEach(function (key) {
      var row = list.querySelector('.rh-col-picker-row[data-col-key="' + key + '"]');
      if (row) list.appendChild(row);
    });
  }

  function syncChips(picker, vis, order) {
    if (!picker) return;
    picker.querySelectorAll('.rh-col-picker-row').forEach(function (row) {
      var key = row.getAttribute('data-col-key');
      var on = vis[key] !== false;
      row.classList.toggle('is-on', on);
      row.classList.toggle('is-off', !on);

      var chip = row.querySelector('.rh-col-chip');
      if (chip) chip.classList.toggle('is-on', on);

      var btn = row.querySelector('.rh-col-visibility-btn');
      if (!btn) return;
      var label = chip ? chip.textContent.trim() : key;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', (on ? 'Hide ' : 'Show ') + label + ' column');
      btn.setAttribute('data-rh-tip', (on ? 'Hide ' : 'Show ') + label + ' column');

      var shown = btn.querySelector('.rh-col-visibility-icon--shown');
      var hidden = btn.querySelector('.rh-col-visibility-icon--hidden');
      if (shown) shown.hidden = !on;
      if (hidden) hidden.hidden = on;
    });
    var reset = document.getElementById('requests-col-reset');
    var needsReset = hiddenCount(vis) > 0 || !orderIsDefault(order);
    if (reset) reset.hidden = !needsReset;
    var btn = document.getElementById('requests-col-btn');
    var dot = document.getElementById('requests-col-btn-dot');
    var hasHidden = hiddenCount(vis) > 0;
    if (btn) btn.classList.toggle('is-active', hasHidden || !orderIsDefault(order));
    if (dot) dot.hidden = !(hasHidden || !orderIsDefault(order));
  }

  function commitState(vis, order) {
    saveVisibility(vis);
    saveOrder(order);
    var table = document.getElementById('requests-table');
    applyColumnOrder(table, order);
    applyToTable(table, vis);
    syncPickerOrder(order);
    syncChips(document.getElementById('requests-col-picker'), vis, order);
    relayout();
  }

  function commitVisibility(vis) {
    commitState(vis, loadOrder());
  }

  function commitOrder(order) {
    commitState(loadVisibility(), order);
  }

  function applyAll() {
    var vis = loadVisibility();
    var order = loadOrder();
    var table = document.getElementById('requests-table');
    applyColumnOrder(table, order);
    applyToTable(table, vis);
    syncPickerOrder(order);
    syncChips(document.getElementById('requests-col-picker'), vis, order);
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

  function resetColumns() {
    commitState(defaultVisibility(), DEFAULT_ORDER.slice());
  }

  function colModal() {
    return document.getElementById('requests-col-modal');
  }

  function isPickerOpen() {
    var modal = colModal();
    return !!(modal && modal.open);
  }

  function closePicker() {
    var modal = colModal();
    var btn = document.getElementById('requests-col-btn');
    if (modal && modal.open) modal.close();
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function openPicker() {
    var modal = colModal();
    var btn = document.getElementById('requests-col-btn');
    if (!modal) return;
    modal.showModal();
    if (btn) btn.setAttribute('aria-expanded', 'true');
    initSortable();
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

  function initSortable() {
    var list = document.getElementById('requests-col-order-list');
    if (!list || typeof Sortable === 'undefined') return;
    if (sortableInstance) sortableInstance.destroy();
    sortableInstance = Sortable.create(list, {
      draggable: '.rh-col-picker-row',
      filter: '.rh-col-visibility-btn',
      preventOnFilter: true,
      animation: 160,
      ghostClass: 'rh-col-picker-row--ghost',
      chosenClass: 'rh-col-picker-row--chosen',
      dragClass: 'rh-col-picker-row--drag',
      onEnd: function () {
        commitOrder(readPickerOrder());
      },
    });
  }

  function bindColModal() {
    var modal = colModal();
    if (!modal || modal.dataset.rhColModalBound) return;
    modal.dataset.rhColModalBound = '1';
    modal.addEventListener('close', function () {
      var btn = document.getElementById('requests-col-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function initRequestsColumns() {
    bindColModal();
    applyAll();
    initSortable();
  }

  window.initRequestsColumns = initRequestsColumns;
  window.rhReorderRequestTableRow = function (row) {
    if (!row || row.tagName !== 'TR') return;
    reorderRowCells(row, fullColumnOrder(loadOrder()));
  };

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

    if (evt.target.closest('#requests-col-modal-close')) {
      evt.preventDefault();
      closePicker();
      return;
    }

    var toggleBtn = evt.target.closest('[data-col-toggle]');
    if (toggleBtn && toggleBtn.closest('#requests-col-picker')) {
      var vis = loadVisibility();
      var key = toggleBtn.getAttribute('data-col-toggle');
      setKey(vis, key, vis[key] === false);
      commitVisibility(vis);
      return;
    }

    if (evt.target.closest('#requests-col-reset')) {
      resetColumns();
      return;
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
