(function () {
  if (window.__rhRequestRowTooltipBound) return;
  window.__rhRequestRowTooltipBound = true;

  var tipEl = null;
  var hoverRow = null;
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

  function showForRow(row, clientX, clientY) {
    var label = row.getAttribute('data-status-label');
    if (!label) {
      hideTip();
      return;
    }

    hoverRow = row;
    var tip = getTip();
    var statusKey = row.getAttribute('data-status-key') || 'sent';
    tip.textContent = label;
    tip.className = 'rh-request-status-cursor-tip rh-request-status-cursor-tip--' + statusKey;
    tip.hidden = false;
    schedulePosition(clientX, clientY);
  }

  document.body.addEventListener('mouseover', function (evt) {
    if (!evt.target.closest('.rh-table-desktop, .rh-cards-mobile')) return;

    var row = findHoverRow(evt.target);
    if (!row) return;
    if (row === hoverRow) return;

    showForRow(row, evt.clientX, evt.clientY);
  });

  document.body.addEventListener('mousemove', function (evt) {
    if (!hoverRow) return;

    var row = findHoverRow(evt.target);
    if (row !== hoverRow) return;

    schedulePosition(evt.clientX, evt.clientY);
  });

  document.body.addEventListener('mouseout', function (evt) {
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
