(function () {
  function getCreateTab() {
    return document.querySelector('.rh-mobile-buyer-create-tab');
  }

  function setCreateActive(active) {
    var create = getCreateTab();
    if (!create) return;
    create.classList.toggle('is-active', !!active);
    create.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  function initBuyerNavPosition() {
    setCreateActive(document.body.classList.contains('rh-quiz-open'));
  }

  function patchGlobal(fnName, beforeFn) {
    var original = window[fnName];
    if (typeof original !== 'function') return;

    window[fnName] = function () {
      if (beforeFn) beforeFn();
      return original.apply(this, arguments);
    };
  }

  patchGlobal('openRequestCreate', function () {
    setCreateActive(true);
  });

  patchGlobal('closeRequestQuiz', function () {
    setCreateActive(false);
  });

  window.initBuyerMobileNav = initBuyerNavPosition;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBuyerNavPosition);
  } else {
    initBuyerNavPosition();
  }
})();
