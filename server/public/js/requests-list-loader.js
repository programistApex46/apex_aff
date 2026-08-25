(function () {
  function getStage() {
    return document.getElementById('requests-stage');
  }

  function setRequestsListLoading(loading) {
    var stage = getStage();
    if (!stage) return;
    if (loading && !document.getElementById('requests-loader')) {
      stage.insertAdjacentHTML(
        'afterbegin',
        '<div class="rh-requests-loader" id="requests-loader" role="status" aria-live="polite" aria-label="Loading requests">' +
          '<div class="rh-requests-loader-inner">' +
          '<span class="rh-requests-loader-spinner" aria-hidden="true"></span>' +
          '</div></div>'
      );
    }
    stage.classList.toggle('rh-is-loading', !!loading);
    stage.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function revealRequestsList() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (typeof window.initRequestsTableResize === 'function') {
          window.initRequestsTableResize();
        }
        if (typeof window.rhSyncSplitFolders === 'function') {
          window.rhSyncSplitFolders();
        }
        setRequestsListLoading(false);
      });
    });
  }

  window.setRequestsListLoading = setRequestsListLoading;
  window.revealRequestsList = revealRequestsList;

  document.body.addEventListener('htmx:beforeRequest', function (evt) {
    var elt = evt.detail && evt.detail.elt;
    var target = evt.detail && evt.detail.target;
    if (!getStage()) return;
    if (target && target.id === 'requests-main') {
      setRequestsListLoading(true);
      return;
    }
    if (elt && (elt.getAttribute('hx-target') === '#requests-main' || elt.getAttribute('data-hx-target') === '#requests-main')) {
      setRequestsListLoading(true);
    }
  });
})();
