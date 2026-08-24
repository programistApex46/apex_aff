(function () {
  if (window.__rhRequestsTableResizeBound) {
    if (typeof window.initRequestsTableResize === 'function') window.initRequestsTableResize();
    return;
  }
  window.__rhRequestsTableResizeBound = true;

  var STORAGE_KEY = 'rh-requests-col-widths-v14';
  var LEGACY_STORAGE_KEYS = ['rh-requests-col-widths-v13', 'rh-requests-col-widths-v12', 'rh-requests-col-widths-v11', 'rh-requests-col-widths-v10', 'rh-requests-col-widths-v9', 'rh-requests-col-widths-v8', 'rh-requests-col-widths-v7', 'rh-requests-col-widths-v6', 'rh-requests-col-widths-v5', 'rh-requests-col-widths-v4', 'rh-requests-col-widths-v3', 'rh-requests-col-widths-v2', 'rh-requests-col-widths'];
  var MIN_WIDTH = 40;
  var DESKTOP_QUERY = '(min-width: 768px)';
  var DEFAULT_WIDTHS = {
    id: 88,
    created_at: 104,
    company: 56,
    team: 50,
    stage: 57,
    geo: 112,
    language: 40,
    quantity: 52,
    funnel: 68,
    comment: 84,
    aff: 128,
    partner: 88,
    aff_cap: 52,
    aff_wh: 52,
    aff_price: 64,
    actions: 72,
  };

  function sanitizeWidths(widths) {
    if (!widths || !widths.id) return widths;
    if (widths.id > DEFAULT_WIDTHS.id) {
      widths.id = DEFAULT_WIDTHS.id;
    }
    if (widths.id < DEFAULT_WIDTHS.id) {
      widths.id = DEFAULT_WIDTHS.id;
    }
    if (widths.stage && widths.stage < DEFAULT_WIDTHS.stage) {
      widths.stage = DEFAULT_WIDTHS.stage;
    }
    if (widths.company && widths.company < DEFAULT_WIDTHS.company) {
      widths.company = DEFAULT_WIDTHS.company;
    }
    return widths;
  }

  function loadWidths() {
    try {
      var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (Object.keys(stored).length) return sanitizeWidths(stored);
    } catch (e) {
      /* ignore */
    }

    for (var i = 0; i < LEGACY_STORAGE_KEYS.length; i += 1) {
      try {
        var legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEYS[i]) || '{}');
        if (!Object.keys(legacy).length) continue;
        legacy = sanitizeWidths(legacy);
        saveWidths(legacy);
        return legacy;
      } catch (e) {
        /* ignore */
      }
    }

    return {};
  }

  function saveWidths(widths) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  }

  function getColKey(th) {
    return th.getAttribute('data-col-key') || String(Array.prototype.indexOf.call(th.parentElement.children, th));
  }

  function ensureColgroup(table) {
    var ths = table.querySelectorAll('thead tr th');
    var colgroup = table.querySelector('colgroup');

    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      table.insertBefore(colgroup, table.firstChild);
    }

    while (colgroup.children.length < ths.length) {
      colgroup.appendChild(document.createElement('col'));
    }
    while (colgroup.children.length > ths.length) {
      colgroup.removeChild(colgroup.lastChild);
    }

    return colgroup;
  }

  function setColumnWidth(table, th, width) {
    var index = Array.prototype.indexOf.call(th.parentElement.children, th);
    var cols = table.querySelectorAll('colgroup col');

    if (cols[index]) {
      cols[index].style.width = width + 'px';
    }

    th.style.width = width + 'px';
    th.style.minWidth = width + 'px';
    th.style.maxWidth = width + 'px';
  }

  function captureAllWidths(table) {
    var widths = {};
    table.querySelectorAll('thead tr th').forEach(function (th) {
      widths[getColKey(th)] = th.offsetWidth;
    });
    return widths;
  }

  function applyWidths(table, widths) {
    if (!widths || !Object.keys(widths).length) return;

    ensureColgroup(table);
    table.classList.add('rh-data-table--resizable');
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';

    table.querySelectorAll('thead tr th').forEach(function (th) {
      var key = getColKey(th);
      var width = widths[key];
      if (!width) return;
      setColumnWidth(table, th, Math.max(MIN_WIDTH, width));
    });
  }

  function ensureHandles(table) {
    table.querySelectorAll('thead tr th').forEach(function (th) {
      if (th.querySelector('.rh-col-resize-handle')) return;

      th.classList.add('rh-th-resizable');

      var handle = document.createElement('span');
      handle.className = 'rh-col-resize-handle';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize column');
      handle.addEventListener('pointerdown', function (evt) {
        startResize(table, th, handle, evt);
      });
      th.appendChild(handle);
    });
  }

  function startResize(table, th, handle, evt) {
    if (!window.matchMedia(DESKTOP_QUERY).matches) return;
    if (evt.button !== 0) return;

    evt.preventDefault();
    evt.stopPropagation();

    var key = getColKey(th);
    var widths = loadWidths();

    if (table.style.tableLayout !== 'fixed') {
      widths = captureAllWidths(table);
      applyWidths(table, widths);
    } else {
      ensureColgroup(table);
    }

    handle.setPointerCapture(evt.pointerId);

    var startX = evt.clientX;
    var startWidth = th.offsetWidth;

    function onMove(e) {
      if (e.pointerId !== evt.pointerId) return;
      var width = Math.max(MIN_WIDTH, startWidth + (e.clientX - startX));
      setColumnWidth(table, th, width);
      widths[key] = width;
    }

    function onUp(e) {
      if (e.pointerId !== evt.pointerId) return;
      saveWidths(widths);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('rh-col-resizing');
    }

    document.body.classList.add('rh-col-resizing');
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function initRequestsTableResize() {
    var table = document.getElementById('requests-table');
    if (!table || !window.matchMedia(DESKTOP_QUERY).matches) return;

    ensureHandles(table);

    var widths = loadWidths();
    if (!Object.keys(widths).length) {
      widths = DEFAULT_WIDTHS;
    }

    applyWidths(table, widths);
  }

  window.initRequestsTableResize = initRequestsTableResize;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequestsTableResize);
  } else {
    initRequestsTableResize();
  }

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    if (evt.detail.target && evt.detail.target.id === 'requests-main') {
      initRequestsTableResize();
    }
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(initRequestsTableResize, 120);
  });
})();
