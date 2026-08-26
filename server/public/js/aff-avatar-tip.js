(function () {
  if (window.__rhAffAvatarTipBound) return;
  window.__rhAffAvatarTipBound = true;

  var tipEl = null;
  var openAff = null;

  function prefersTouchTip() {
    return window.matchMedia('(hover: none), (pointer: coarse)').matches;
  }

  function getTip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'rh-request-status-cursor-tip rh-request-status-cursor-tip--action';
      tipEl.setAttribute('role', 'tooltip');
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function findAff(target) {
    return target && target.closest ? target.closest('.rh-aff-user--avatar-only[data-aff-name]') : null;
  }

  function positionTip(aff) {
    var tip = getTip();
    var rect = aff.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top - 8;
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(y) + 'px';
    tip.style.transform = 'translate(-50%, -100%)';
  }

  function showTip(aff) {
    var name = aff.getAttribute('data-aff-name');
    if (!name) return;

    var tip = getTip();
    tip.textContent = name;
    tip.hidden = false;
    openAff = aff;
    positionTip(aff);
  }

  function hideTip() {
    if (tipEl) {
      tipEl.hidden = true;
      tipEl.style.transform = '';
    }
    if (openAff) {
      openAff.classList.remove('is-tip-open');
      openAff = null;
    }
  }

  document.body.addEventListener(
    'click',
    function (evt) {
      if (!prefersTouchTip()) return;
      var aff = findAff(evt.target);
      if (aff) {
        evt.preventDefault();
        evt.stopPropagation();
        if (openAff === aff) {
          hideTip();
        } else {
          hideTip();
          aff.classList.add('is-tip-open');
          showTip(aff);
        }
        return;
      }
      hideTip();
    },
    true
  );

  window.addEventListener(
    'scroll',
    function () {
      hideTip();
    },
    true
  );
  window.addEventListener('resize', hideTip);
})();
