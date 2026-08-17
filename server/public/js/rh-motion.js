(function (global) {
  var RUNNING_CLASS = 'rh-motion-running';

  // iOS-like sheet presets — profile: slightly slower and softer; filters: slightly faster.
  var SHEET_PROFILE = {
    open: { duration: 0.45, ease: [0.32, 0.72, 0, 1] },
    close: { duration: 0.3, ease: [0.32, 0, 0.67, 0] },
  };
  var SHEET_FILTERS = {
    open: { duration: 0.38, ease: [0.25, 0.1, 0.25, 1] },
    close: { duration: 0.26, ease: [0.4, 0, 1, 1] },
  };
  // Buyer/tl quiz — horizontal push, like iOS navigation.
  var SHEET_QUIZ = {
    open: { duration: 0.42, ease: [0.32, 0.72, 0, 1] },
    close: { duration: 0.32, ease: [0.32, 0, 0.67, 0] },
  };

  var EASE_MENU_OPEN = [0.22, 1, 0.36, 1];
  var EASE_MENU_CLOSE = [0.4, 0, 0.2, 1];

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function canWaapi() {
    return typeof Element !== 'undefined' && Element.prototype && typeof Element.prototype.animate === 'function';
  }

  function noopCtrl() {
    return {
      stop: function () {},
      finished: Promise.resolve(),
    };
  }

  function panelOf(el) {
    return (el && el.querySelector && el.querySelector('[data-rh-motion-panel]')) || null;
  }

  function motionNodes(el) {
    var nodes = [];
    if (el) nodes.push(el);
    var panel = panelOf(el);
    if (panel && panel !== el) nodes.push(panel);
    return nodes;
  }

  function sheetPreset(variant) {
    if (variant === 'sheet-filters') return SHEET_FILTERS;
    return SHEET_PROFILE;
  }

  function clearInline(nodes) {
    nodes.forEach(function (node) {
      node.style.opacity = '';
      node.style.transform = '';
    });
  }

  function settle(nodes) {
    nodes.forEach(function (node) {
      node.classList.remove(RUNNING_CLASS);
    });
  }

  function easingOf(ease) {
    if (Array.isArray(ease)) return 'cubic-bezier(' + ease.join(', ') + ')';
    return ease || 'ease-out';
  }

  function waRun(el, keyframes, options) {
    if (!el || !canWaapi()) return noopCtrl();

    var anim = el.animate(keyframes, {
      duration: (options.duration || 0.4) * 1000,
      easing: easingOf(options.ease),
      fill: 'both',
    });

    return {
      stop: function () {
        try {
          anim.cancel();
        } catch (e) {}
      },
      finished: anim.finished.catch(function () {}),
    };
  }

  function control(nodes, ctrl) {
    var settled = false;

    function done() {
      if (settled) return;
      settled = true;
      settle(nodes);
    }

    return {
      stop: function () {
        if (ctrl && typeof ctrl.stop === 'function') ctrl.stop();
        done();
        clearInline(nodes);
      },
      finished: Promise.resolve(ctrl && ctrl.finished).then(done, done),
    };
  }

  function stop(ctrl) {
    if (ctrl && typeof ctrl.stop === 'function') ctrl.stop();
  }

  /** Initial frame before showing sheet — avoids flicker. */
  function prepareSheetOpen(el) {
    var panel = panelOf(el);
    if (panel) panel.style.transform = 'translate3d(0, 100%, 0)';
  }

  /** Quiz — slide in from the right. */
  function prepareQuizOpen(el) {
    if (el) el.style.transform = 'translate3d(100%, 0, 0)';
  }

  function slideQuiz(el, direction) {
    var timing = direction === 'open' ? SHEET_QUIZ.open : SHEET_QUIZ.close;
    var keyframes =
      direction === 'open'
        ? [
            { transform: 'translate3d(100%, 0, 0)' },
            { transform: 'translate3d(0, 0, 0)' },
          ]
        : [
            { transform: 'translate3d(0, 0, 0)' },
            { transform: 'translate3d(100%, 0, 0)' },
          ];

    if (direction === 'open') {
      el.style.transform = 'translate3d(100%, 0, 0)';
    }

    var nodes = motionNodes(el);
    nodes.forEach(function (node) {
      node.classList.add(RUNNING_CLASS);
    });

    if (reduced() || !canWaapi()) return control(nodes, noopCtrl());

    return control(nodes, waRun(el, keyframes, timing));
  }

  function slideSheet(el, direction, preset) {
    var panel = panelOf(el) || el;
    var nodes = motionNodes(el);
    var timing = direction === 'open' ? preset.open : preset.close;
    var keyframes =
      direction === 'open'
        ? [
            { transform: 'translate3d(0, 100%, 0)' },
            { transform: 'translate3d(0, 0, 0)' },
          ]
        : [
            { transform: 'translate3d(0, 0, 0)' },
            { transform: 'translate3d(0, 100%, 0)' },
          ];

    if (direction === 'open') {
      panel.style.transform = 'translate3d(0, 100%, 0)';
    }

    nodes.forEach(function (node) {
      node.classList.add(RUNNING_CLASS);
    });

    if (reduced() || !canWaapi()) return control(nodes, noopCtrl());

    return control(nodes, waRun(panel, keyframes, timing));
  }

  function openOverlay(el, variant) {
    if (!el) return noopCtrl();

    if (variant === 'sheet' || variant === 'sheet-profile' || variant === 'sheet-filters') {
      return slideSheet(el, 'open', sheetPreset(variant));
    }

    if (variant === 'sheet-quiz') {
      return slideQuiz(el, 'open');
    }

    var nodes = motionNodes(el);
    clearInline(nodes);
    nodes.forEach(function (node) {
      node.classList.add(RUNNING_CLASS);
    });

    return control(
      nodes,
      waRun(
        el,
        [
          { opacity: 0, transform: 'translate3d(0, -0.375rem, 0) scale(0.96)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        { duration: 0.26, ease: EASE_MENU_OPEN }
      )
    );
  }

  function closeOverlay(el, variant) {
    if (!el) return noopCtrl();

    if (variant === 'sheet' || variant === 'sheet-profile' || variant === 'sheet-filters') {
      return slideSheet(el, 'close', sheetPreset(variant));
    }

    if (variant === 'sheet-quiz') {
      return slideQuiz(el, 'close');
    }

    var nodes = motionNodes(el);
    nodes.forEach(function (node) {
      node.classList.add(RUNNING_CLASS);
    });

    return control(
      nodes,
      waRun(
        el,
        [
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          { opacity: 0, transform: 'translate3d(0, -0.25rem, 0) scale(0.96)' },
        ],
        { duration: 0.22, ease: EASE_MENU_CLOSE }
      )
    );
  }

  function reset(el) {
    var nodes = motionNodes(el);
    clearInline(nodes);
    settle(nodes);
  }

  global.rhMotion = {
    reduced: reduced,
    stop: stop,
    reset: reset,
    prepareSheetOpen: prepareSheetOpen,
    prepareQuizOpen: prepareQuizOpen,
    openOverlay: openOverlay,
    closeOverlay: closeOverlay,
  };
})(window);
