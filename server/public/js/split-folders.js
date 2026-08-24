(function () {
  var STORAGE_KEY = 'rh-split-folders-collapsed';

  function readCollapsed() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    } catch (_err) {
      return [];
    }
  }

  function writeCollapsed(ids) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  function splitFolderRootId(node) {
    if (!node) return null;
    if (node.getAttribute('data-is-split-root') === '1') {
      return String(node.getAttribute('data-id') || '');
    }
    var splitRoot = node.getAttribute('data-split-root');
    return splitRoot ? String(splitRoot) : null;
  }

  function folderChildSelector(rootId) {
    return '[data-split-root="' + rootId + '"][data-is-subtask="1"]';
  }

  function setFolderExpanded(rootId, expanded) {
    if (!rootId) return;

    var rootRow = document.getElementById('request-row-' + rootId);
    var rootCard = document.getElementById('request-card-' + rootId);
    [rootRow, rootCard].forEach(function (node) {
      if (!node) return;
      node.classList.toggle('rh-split-folder--collapsed', !expanded);
      var toggle = node.querySelector('.rh-split-folder-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });

    document.querySelectorAll(folderChildSelector(rootId)).forEach(function (child) {
      child.classList.toggle('rh-split-folder-child--hidden', !expanded);
      if (!expanded) {
        child.setAttribute('hidden', '');
      } else {
        child.removeAttribute('hidden');
      }
    });

    markFolderGroupEdges(rootId);
  }

  function markFolderGroupEdges(rootId) {
    var members = [];
    var rootRow = document.getElementById('request-row-' + rootId);
    var rootCard = document.getElementById('request-card-' + rootId);
    if (rootRow) members.push(rootRow);
    if (rootCard) members.push(rootCard);
    document.querySelectorAll(folderChildSelector(rootId)).forEach(function (child) {
      members.push(child);
    });

    members.forEach(function (node) {
      node.classList.remove('rh-split-folder-edge-first', 'rh-split-folder-edge-last');
    });

    ['requests-body', 'requests-cards-mobile'].forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var isTable = containerId === 'requests-body';
      var rootNode = document.getElementById((isTable ? 'request-row-' : 'request-card-') + rootId);
      if (!rootNode || !container.contains(rootNode)) return;

      var visibleMembers = [];
      if (rootNode.offsetParent !== null || !rootNode.classList.contains('rh-split-folder-child--hidden')) {
        visibleMembers.push(rootNode);
      }

      container.querySelectorAll(folderChildSelector(rootId)).forEach(function (child) {
        if (child.hidden || child.classList.contains('rh-split-folder-child--hidden')) return;
        if (child.offsetParent === null && child.style.display === 'none') return;
        visibleMembers.push(child);
      });

      if (!visibleMembers.length) return;
      visibleMembers[0].classList.add('rh-split-folder-edge-first');
      visibleMembers[visibleMembers.length - 1].classList.add('rh-split-folder-edge-last');
    });
  }

  function syncSplitFolders() {
    var collapsed = readCollapsed();
    document.querySelectorAll('[data-is-split-root="1"]').forEach(function (root) {
      var rootId = String(root.getAttribute('data-id') || '');
      if (!rootId) return;
      setFolderExpanded(rootId, collapsed.indexOf(rootId) === -1);
    });
  }

  function expandSplitFolder(rootId) {
    if (!rootId) return;
    var collapsed = readCollapsed();
    var idx = collapsed.indexOf(String(rootId));
    if (idx === -1) return;
    collapsed.splice(idx, 1);
    writeCollapsed(collapsed);
    setFolderExpanded(String(rootId), true);
  }

  document.addEventListener('click', function (evt) {
    var toggle = evt.target.closest('.rh-split-folder-toggle');
    if (!toggle) return;

    evt.preventDefault();
    evt.stopPropagation();

    var rootId = toggle.getAttribute('data-rh-split-folder');
    if (!rootId) return;

    var collapsed = readCollapsed();
    var idx = collapsed.indexOf(String(rootId));
    if (idx === -1) {
      collapsed.push(String(rootId));
      writeCollapsed(collapsed);
      setFolderExpanded(String(rootId), false);
      return;
    }

    collapsed.splice(idx, 1);
    writeCollapsed(collapsed);
    setFolderExpanded(String(rootId), true);
  });

  window.rhSyncSplitFolders = syncSplitFolders;
  window.rhExpandSplitFolder = expandSplitFolder;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncSplitFolders);
  } else {
    syncSplitFolders();
  }

  document.body.addEventListener('htmx:afterSwap', syncSplitFolders);
  document.body.addEventListener('htmx:oobAfterSwap', syncSplitFolders);
})();
