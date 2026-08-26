(function () {
  var LEGACY_STORAGE_KEY = 'rh-split-folders-collapsed';
  var splitEffectsFrame = 0;
  var pendingSplitRoots = new Set();
  var pendingSplitReunify = false;
  var fullSyncFrame = 0;

  function storageKey() {
    var userId = document.body.getAttribute('data-rh-user-id') || '0';
    return 'rh-split-folders-collapsed:' + userId;
  }

  function readAllScopes() {
    try {
      var raw = sessionStorage.getItem(storageKey());
      if (!raw) {
        var legacy = sessionStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          var legacyIds = JSON.parse(legacy);
          if (Array.isArray(legacyIds)) {
            return { all: legacyIds };
          }
        }
        return {};
      }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  function readCollapsed(scope) {
    var all = readAllScopes();
    var ids = all[scope];
    return Array.isArray(ids) ? ids : [];
  }

  function writeCollapsed(scope, ids) {
    var all = readAllScopes();
    all[scope] = ids;
    sessionStorage.setItem(storageKey(), JSON.stringify(all));
  }

  function folderChildSelector(rootId) {
    return '[data-split-root="' + rootId + '"][data-is-subtask="1"]';
  }

  function domNode(prefix, id, container) {
    var slug =
      typeof window.rhRequestDomSlug === 'function' ? window.rhRequestDomSlug(id) : String(id);
    var nodeId = prefix + slug;

    if (container) {
      var byId = container.querySelector('#' + nodeId);
      if (byId) return byId;
      var tag = prefix === 'request-row-' ? 'tr' : '.rh-request-card';
      return container.querySelector(tag + '[data-id="' + id + '"]');
    }

    return document.getElementById(nodeId);
  }

  function getViewScope(node) {
    if (!node) return 'default';
    var panel = node.closest('.rh-desk-slider-panel[data-desk]');
    if (panel) return panel.getAttribute('data-desk') || 'all';
    if (node.closest('#requests-body')) return 'table';
    if (node.closest('#requests-cards-mobile')) return 'cards';
    return 'default';
  }

  function getActiveScopes() {
    var scopes = [];
    var seen = new Set();

    function add(scope) {
      if (!scope || seen.has(scope)) return;
      seen.add(scope);
      scopes.push(scope);
    }

    if (document.getElementById('requests-body')) add('table');
    if (document.getElementById('rh-desk-slider')) {
      document.querySelectorAll('.rh-desk-slider-panel[data-desk]').forEach(function (panel) {
        add(panel.getAttribute('data-desk') || 'all');
      });
    } else if (document.getElementById('requests-cards-mobile')) {
      add('cards');
    }

    if (!scopes.length) add('default');
    return scopes;
  }

  function containerForScope(scope) {
    if (scope === 'table') {
      return { container: document.getElementById('requests-body'), row: true };
    }

    if (scope === 'cards') {
      return { container: document.getElementById('requests-cards-mobile'), row: false };
    }

    var panel = document.querySelector('.rh-desk-slider-panel[data-desk="' + scope + '"]');
    if (panel) {
      return { container: panel.querySelector('.rh-cards-list'), row: false };
    }

    if (scope === 'default' || scope === 'all') {
      return { container: document.getElementById('requests-cards-mobile'), row: false };
    }

    return { container: null, row: false };
  }

  function scopeHasRoot(scope, rootId) {
    var cfg = containerForScope(scope);
    if (!cfg.container) return false;
    var prefix = cfg.row ? 'request-row-' : 'request-card-';
    return !!domNode(prefix, rootId, cfg.container);
  }

  function applyFolderStateToNode(node, expanded) {
    if (!node) return;
    node.classList.toggle('rh-split-folder--collapsed', !expanded);
    var toggle = node.querySelector('.rh-split-folder-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function applyFolderStateToChild(node, expanded) {
    if (!node) return;
    node.classList.toggle('rh-split-folder-child--hidden', !expanded);
    if (!expanded) node.setAttribute('hidden', '');
    else node.removeAttribute('hidden');
  }

  function markFolderGroupEdges(rootId, scope) {
    var cfg = containerForScope(scope);
    var container = cfg.container;
    if (!container) return;

    var prefix = cfg.row ? 'request-row-' : 'request-card-';
    var rootNode = domNode(prefix, rootId, container);
    if (!rootNode) return;

    var members = [rootNode];
    container.querySelectorAll(folderChildSelector(rootId)).forEach(function (child) {
      members.push(child);
    });

    members.forEach(function (node) {
      node.classList.remove('rh-split-folder-edge-first', 'rh-split-folder-edge-last');
    });

    var visibleMembers = members.filter(function (node) {
      if (node === rootNode) {
        return node.offsetParent !== null || !node.classList.contains('rh-split-folder-child--hidden');
      }
      if (node.hidden || node.classList.contains('rh-split-folder-child--hidden')) return false;
      return !(node.offsetParent === null && node.style.display === 'none');
    });

    if (!visibleMembers.length) return;
    visibleMembers[0].classList.add('rh-split-folder-edge-first');
    visibleMembers[visibleMembers.length - 1].classList.add('rh-split-folder-edge-last');
  }

  function setFolderExpanded(rootId, expanded, options) {
    options = options || {};
    if (!rootId || !options.scope) return;

    var cfg = containerForScope(options.scope);
    var container = cfg.container;
    if (!container) return;

    var prefix = cfg.row ? 'request-row-' : 'request-card-';
    var root = domNode(prefix, rootId, container);
    if (!root) return;

    applyFolderStateToNode(root, expanded);
    container.querySelectorAll(folderChildSelector(rootId)).forEach(function (child) {
      applyFolderStateToChild(child, expanded);
    });

    if (options.markEdges !== false) markFolderGroupEdges(rootId, options.scope);
  }

  function syncSplitFolderForRoot(rootId) {
    if (!rootId) return;
    getActiveScopes().forEach(function (scope) {
      if (!scopeHasRoot(scope, rootId)) return;
      var collapsed = readCollapsed(scope);
      setFolderExpanded(String(rootId), collapsed.indexOf(String(rootId)) === -1, {
        scope: scope,
        markEdges: true,
      });
    });
  }

  function syncSplitFolderFilters() {
    if (typeof window.applyRequestsSearch === 'function') {
      window.applyRequestsSearch();
    }
  }

  function syncSplitFolders() {
    var seenRoots = new Set();

    getActiveScopes().forEach(function (scope) {
      var cfg = containerForScope(scope);
      var container = cfg.container;
      if (!container) return;

      var collapsed = readCollapsed(scope);
      container.querySelectorAll('[data-is-split-root="1"]').forEach(function (root) {
        var rootId = String(root.getAttribute('data-id') || '');
        if (!rootId) return;
        seenRoots.add(rootId + ':' + scope);
        setFolderExpanded(rootId, collapsed.indexOf(rootId) === -1, { scope: scope, markEdges: false });
      });
    });

    seenRoots.forEach(function (key) {
      var parts = key.split(':');
      markFolderGroupEdges(parts[0], parts.slice(1).join(':'));
    });
  }

  function scheduleFullSplitSync() {
    if (fullSyncFrame) return;
    fullSyncFrame = requestAnimationFrame(function () {
      fullSyncFrame = 0;
      syncSplitFolders();
    });
  }

  function scheduleSplitEffects() {
    if (splitEffectsFrame) return;
    splitEffectsFrame = requestAnimationFrame(function () {
      splitEffectsFrame = 0;
      if (pendingSplitReunify && typeof window.rhReunifySplitGroups === 'function') {
        window.rhReunifySplitGroups();
      }
      pendingSplitReunify = false;
      pendingSplitRoots.forEach(function (rootId) {
        syncSplitFolderForRoot(rootId);
      });
      pendingSplitRoots.clear();
    });
  }

  function queueSplitFolderSync(rootId) {
    if (!rootId) return;
    var id = String(rootId);
    var slash = id.indexOf('/');
    if (slash !== -1) id = id.slice(0, slash);
    pendingSplitRoots.add(id);
    scheduleSplitEffects();
  }

  function queueSplitReunify() {
    pendingSplitReunify = true;
    scheduleSplitEffects();
  }

  function expandSplitFolder(rootId, contextNode) {
    if (!rootId) return;

    var scopes = [];
    if (contextNode) {
      scopes.push(getViewScope(contextNode));
    } else {
      scopes = getActiveScopes().filter(function (scope) {
        return scopeHasRoot(scope, rootId);
      });
    }

    scopes.forEach(function (scope) {
      if (!scopeHasRoot(scope, rootId)) return;
      var collapsed = readCollapsed(scope);
      var idx = collapsed.indexOf(String(rootId));
      if (idx === -1) return;
      collapsed.splice(idx, 1);
      writeCollapsed(scope, collapsed);
      setFolderExpanded(String(rootId), true, { scope: scope });
    });

    syncSplitFolderFilters();
  }

  document.addEventListener('click', function (evt) {
    var toggle = evt.target.closest('.rh-split-folder-toggle');
    if (!toggle) return;

    evt.preventDefault();
    evt.stopPropagation();

    var rootId = toggle.getAttribute('data-rh-split-folder');
    if (!rootId) return;

    var scope = getViewScope(toggle);
    var collapsed = readCollapsed(scope);
    var idx = collapsed.indexOf(String(rootId));
    if (idx === -1) {
      collapsed.push(String(rootId));
      writeCollapsed(scope, collapsed);
      setFolderExpanded(String(rootId), false, { scope: scope });
      return;
    }

    collapsed.splice(idx, 1);
    writeCollapsed(scope, collapsed);
    setFolderExpanded(String(rootId), true, { scope: scope });
    syncSplitFolderFilters();
  });

  window.rhSyncSplitFolders = scheduleFullSplitSync;
  window.rhSyncSplitFolderForRoot = syncSplitFolderForRoot;
  window.rhQueueSplitFolderSync = queueSplitFolderSync;
  window.rhQueueSplitReunify = queueSplitReunify;
  window.rhExpandSplitFolder = expandSplitFolder;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncSplitFolders);
  } else {
    syncSplitFolders();
  }

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    var target = evt.detail && evt.detail.target;
    if (!target) return;
    if (target.id === 'modal-body') return;
    if (
      target.id === 'requests-main'
      || target.id === 'requests-cards-mobile'
      || target.id === 'requests-body'
      || target.id === 'rh-page'
    ) {
      scheduleFullSplitSync();
    }
  });

  document.body.addEventListener('htmx:oobAfterSwap', function () {
    if (document.getElementById('rh-desk-slider')) {
      scheduleFullSplitSync();
      return;
    }
    queueSplitReunify();
    scheduleFullSplitSync();
  });
})();
