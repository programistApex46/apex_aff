(function () {
  if (window.__rhRequestRowTooltipBound) return;
  window.__rhRequestRowTooltipBound = true;

  var tipEl = null;
  var hoverRow = null;
  var hoverActionBtn = null;
  var hoverAff = null;
  var rafId = null;
  var pendingX = 0;
  var pendingY = 0;

  function getTip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'rh-request-status-cursor-tip';
      tipEl.setAttribute('role', 'tooltip');
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function hideTip() {
    hoverRow = null;
    hoverActionBtn = null;
    hoverAff = null;
    if (tipEl) tipEl.hidden = true;
  }

  function positionTip(clientX, clientY) {
    var tip = getTip();
    if (tip.hidden) return;

    var offset = 14;
    var width = tip.offsetWidth;
    var height = tip.offsetHeight;
    var x = clientX + offset;
    var y = clientY + offset;

    if (x + width > window.innerWidth - 8) {
      x = clientX - width - offset;
    }
    if (y + height > window.innerHeight - 8) {
      y = clientY - height - offset;
    }

    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
    tip.style.transform = '';
  }

  function schedulePosition(clientX, clientY) {
    pendingX = clientX;
    pendingY = clientY;
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(function () {
      rafId = null;
      positionTip(pendingX, pendingY);
    });
  }

  function findHoverRow(target) {
    return target.closest('.rh-request-row[data-status-label], .rh-request-card[data-status-label]');
  }

  function findAff(target) {
    return target.closest('.rh-aff-user--avatar-only[data-aff-name]');
  }

  function findActionBtn(target) {
    return target.closest('.rh-table-action-btn[data-rh-cursor-tip]');
  }

  function actionTipClass(btn) {
    if (btn.classList.contains('rh-table-action-take')) return 'rh-request-status-cursor-tip--sent';
    if (btn.classList.contains('rh-table-action-complete')) return 'rh-request-status-cursor-tip--approved';
    if (
      btn.classList.contains('rh-table-action-danger') ||
      btn.classList.contains('rh-table-action-release')
    ) {
      return 'rh-request-status-cursor-tip--rejected';
    }
    if (btn.classList.contains('rh-table-action-reopen')) return 'rh-request-status-cursor-tip--in_progress';
    return 'rh-request-status-cursor-tip--action';
  }

  function showForAff(aff, clientX, clientY) {
    var label = aff.getAttribute('data-aff-name');
    if (!label) {
      hideTip();
      return;
    }

    hoverRow = null;
    hoverActionBtn = null;
    hoverAff = aff;
    var tip = getTip();
    tip.textContent = label;
    tip.className = 'rh-request-status-cursor-tip rh-request-status-cursor-tip--action';
    tip.hidden = false;
    schedulePosition(clientX, clientY);
  }

  function showForActionBtn(btn, clientX, clientY) {
    var label = btn.getAttribute('data-rh-cursor-tip');
    if (!label) {
      hideTip();
      return;
    }

    hoverRow = null;
    hoverActionBtn = btn;
    hoverAff = null;
    var tip = getTip();
    tip.textContent = label;
    tip.className = 'rh-request-status-cursor-tip ' + actionTipClass(btn);
    tip.hidden = false;
    schedulePosition(clientX, clientY);
  }

  function showForRow(row, clientX, clientY) {
    var label = row.getAttribute('data-status-label');
    if (!label) {
      hideTip();
      return;
    }

    hoverActionBtn = null;
    hoverAff = null;
    hoverRow = row;
    var tip = getTip();
    var statusKey = row.getAttribute('data-status-key') || 'sent';
    tip.textContent = label;
    tip.className = 'rh-request-status-cursor-tip rh-request-status-cursor-tip--' + statusKey;
    tip.hidden = false;
    schedulePosition(clientX, clientY);
  }

  document.body.addEventListener('mouseover', function (evt) {
    var aff = findAff(evt.target);
    if (aff) {
      if (aff === hoverAff) return;
      showForAff(aff, evt.clientX, evt.clientY);
      return;
    }

    var actionBtn = findActionBtn(evt.target);
    if (actionBtn) {
      if (actionBtn === hoverActionBtn) return;
      showForActionBtn(actionBtn, evt.clientX, evt.clientY);
      return;
    }

    if (!evt.target.closest('.rh-table-desktop, .rh-cards-mobile')) return;
    if (evt.target.closest('.rh-table-actions')) return;

    var row = findHoverRow(evt.target);
    if (!row) return;
    if (row === hoverRow) return;

    showForRow(row, evt.clientX, evt.clientY);
  });

  document.body.addEventListener('mousemove', function (evt) {
    if (hoverAff) {
      var aff = findAff(evt.target);
      if (aff !== hoverAff && !hoverAff.contains(evt.target)) return;
      schedulePosition(evt.clientX, evt.clientY);
      return;
    }

    if (hoverActionBtn) {
      if (findActionBtn(evt.target) !== hoverActionBtn) return;
      schedulePosition(evt.clientX, evt.clientY);
      return;
    }

    if (!hoverRow) return;

    var row = findHoverRow(evt.target);
    if (row !== hoverRow) return;

    schedulePosition(evt.clientX, evt.clientY);
  });

  document.body.addEventListener('mouseout', function (evt) {
    if (hoverAff) {
      if (findAff(evt.target) !== hoverAff) return;
      var affRelated = evt.relatedTarget;
      if (affRelated && hoverAff.contains(affRelated)) return;
      hideTip();
      return;
    }

    if (hoverActionBtn) {
      if (findActionBtn(evt.target) !== hoverActionBtn) return;
      var related = evt.relatedTarget;
      if (related && hoverActionBtn.contains(related)) return;
      hideTip();
      return;
    }

    if (!hoverRow) return;

    var row = findHoverRow(evt.target);
    if (row !== hoverRow) return;

    var related = evt.relatedTarget;
    if (related && hoverRow.contains(related)) return;

    hideTip();
  });

  document.body.addEventListener('scroll', hideTip, true);
  window.addEventListener('blur', hideTip);
})();
