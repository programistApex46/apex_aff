(function () {
  var SAFETY_REVEAL_MS = 8000;

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

  function finishLoading() {
    setRequestsListLoading(false);
  }

  function revealRequestsList() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          if (typeof window.initRequestsTableResize === 'function') {
            window.initRequestsTableResize();
          }
          if (typeof window.rhSyncSplitFolders === 'function') {
            window.rhSyncSplitFolders();
          }
        } catch (err) {
          console.error('[requests-list-loader] reveal failed', err);
        }
        finishLoading();
      });
    });
  }

  window.setRequestsListLoading = setRequestsListLoading;
  window.revealRequestsList = revealRequestsList;
  window.finishRequestsListLoading = finishLoading;

  document.body.addEventListener('htmx:beforeRequest', function (evt) {
    var elt = evt.detail && evt.detail.elt;
    var target = evt.detail && evt.detail.target;
    if (!getStage()) return;
    if (target && target.id === 'requests-main') {
      window.__rhAwaitingListSwap = true;
      setRequestsListLoading(true);
      return;
    }
    if (
      elt &&
      (elt.getAttribute('hx-target') === '#requests-main' ||
        elt.getAttribute('data-hx-target') === '#requests-main')
    ) {
      window.__rhAwaitingListSwap = true;
      setRequestsListLoading(true);
    }
  });

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    if (!evt.detail.target || evt.detail.target.id !== 'requests-main') return;
    window.__rhAwaitingListSwap = false;
  });

  document.body.addEventListener('htmx:responseError', function (evt) {
    if (!evt.detail.target || evt.detail.target.id !== 'requests-main') return;
    window.__rhAwaitingListSwap = false;
    finishLoading();
  });

  function scheduleSafetyReveal() {
    window.setTimeout(function () {
      var stage = getStage();
      if (stage && stage.classList.contains('rh-is-loading')) {
        console.warn('[requests-list-loader] safety reveal after timeout');
        finishLoading();
      }
    }, SAFETY_REVEAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSafetyReveal);
  } else {
    scheduleSafetyReveal();
  }
})();
