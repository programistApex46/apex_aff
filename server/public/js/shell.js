(function () {
  var modal = document.getElementById('modal');
  var noteModal = document.getElementById('note-modal');
  var colModal = document.getElementById('requests-col-modal');
  window.modal = modal;

  function isDialogActive(el) {
    return !!(el && el.open && el.dataset.rhDialogClosing !== '1');
  }

  function syncRhDialogOpen() {
    var crop = document.getElementById('avatar-crop-modal');
    var colModalEl = document.getElementById('requests-col-modal');
    var open =
      isDialogActive(modal) ||
      isDialogActive(noteModal) ||
      isDialogActive(colModalEl) ||
      isDialogActive(crop);
    var closing =
      (modal && modal.dataset.rhDialogClosing === '1') ||
      (noteModal && noteModal.dataset.rhDialogClosing === '1') ||
      (colModalEl && colModalEl.dataset.rhDialogClosing === '1') ||
      (crop && crop.dataset.rhDialogClosing === '1');
    document.body.classList.toggle('rh-dialog-open', open);
    document.body.classList.toggle('rh-dialog-closing', closing);
  }

  function beginDialogClose(el) {
    el.dataset.rhDialogClosing = '1';
    el.classList.add('rh-dialog-closing');
    syncRhDialogOpen();
  }

  function finishDialogClose(el) {
    delete el.dataset.rhDialogClosing;
    el.classList.remove('rh-dialog-closing', 'rh-dialog-exiting');
    syncRhDialogOpen();
  }

  function bindDialogChrome(el) {
    if (!el || el.dataset.rhDialogBound) return;
    el.dataset.rhDialogBound = '1';
    var nativeShow = el.showModal.bind(el);
    var nativeClose = el.close.bind(el);
    var closeMotion = null;
    var closing = false;

    function motionVariant() {
      return window.matchMedia('(max-width: 767px)').matches ? 'sheet-filters' : 'menu';
    }

    function stopCloseMotion() {
      if (closeMotion && window.rhMotion) window.rhMotion.stop(closeMotion);
      closeMotion = null;
    }

    el.showModal = function () {
      if (closing) {
        stopCloseMotion();
        closing = false;
        finishDialogClose(el);
        if (window.rhMotion) window.rhMotion.reset(el);
      }
      nativeShow();
      syncRhDialogOpen();
    };

    el.close = function (returnValue, instant) {
      if (!el.open) {
        if (instant) finishDialogClose(el);
        return;
      }
      if (closing && !instant) return;

      var motion = window.rhMotion;
      if (instant || !motion || motion.reduced()) {
        stopCloseMotion();
        closing = false;
        finishDialogClose(el);
        if (motion) motion.reset(el);
        nativeClose(returnValue);
        return;
      }

      closing = true;
      stopCloseMotion();
      beginDialogClose(el);
      el.classList.add('rh-dialog-exiting');
      nativeClose(returnValue);

      closeMotion = motion.closeOverlay(el, motionVariant());
      Promise.resolve(closeMotion && closeMotion.finished)
        .then(function () {
          if (!closing) return;
          stopCloseMotion();
          motion.reset(el);
          closing = false;
          finishDialogClose(el);
        })
        .catch(function () {
          if (!closing) return;
          stopCloseMotion();
          motion.reset(el);
          closing = false;
          finishDialogClose(el);
        });
    };

    el.addEventListener('cancel', function (e) {
      if (!el.open) return;
      e.preventDefault();
      el.close();
    });

    el.addEventListener('close', syncRhDialogOpen);
  }

  bindDialogChrome(modal);
  bindDialogChrome(noteModal);
  bindDialogChrome(colModal);
  bindDialogChrome(document.getElementById('avatar-crop-modal'));

  window.closeRequestModal = function (instant) {
    if (modal) modal.close('', !!instant);
  };

  function modalSearchRoot(el) {
    return el && el.closest ? el.closest('.users-modal-shell, .teams-modal-shell') : null;
  }

  function applyModalSearch(root) {
    if (!root) return;
    var input = root.querySelector('[data-rh-modal-search]');
    var clearBtn = root.querySelector('[data-rh-modal-search-clear]');
    var query = ((input && input.value) || '').trim().toLowerCase();
    var items = root.querySelectorAll('[data-rh-search]');
    var visible = 0;

    items.forEach(function (item) {
      var haystack = (item.getAttribute('data-rh-search') || '').toLowerCase();
      var match = !query || haystack.indexOf(query) !== -1;
      item.hidden = !match;
      if (match) visible += 1;
    });

    if (clearBtn) clearBtn.hidden = !query;
    var empty = root.querySelector('[data-rh-search-empty]');
    if (empty) empty.hidden = !query || visible > 0;
    root.querySelectorAll('.rh-table-panel, .rh-cards-list').forEach(function (el) {
      el.hidden = !!query && visible === 0;
    });
  }

  document.body.addEventListener('input', function (e) {
    var input = e.target.closest('[data-rh-modal-search]');
    if (!input) return;
    applyModalSearch(modalSearchRoot(input));
  });

  document.body.addEventListener('click', function (e) {
    var clearBtn = e.target.closest('[data-rh-modal-search-clear]');
    if (!clearBtn) return;
    var root = modalSearchRoot(clearBtn);
    var input = root && root.querySelector('[data-rh-modal-search]');
    if (!input) return;
    input.value = '';
    applyModalSearch(root);
    input.focus();
  });

  function openRequestNoteModal(requestId) {
    if (!noteModal) return;

    var row =
      document.getElementById('request-row-' + window.rhRequestDomSlug(requestId)) ||
      document.getElementById('request-card-' + window.rhRequestDomSlug(requestId));
    var text = row && row.dataset.comment ? row.dataset.comment : '';
    var textEl = document.getElementById('note-modal-text');
    var metaEl = document.getElementById('note-modal-request');

    if (textEl) textEl.textContent = text || '—';
    if (metaEl) metaEl.textContent = requestId ? '#' + requestId : '';
    noteModal.showModal();
  }

  window.openRequestNoteModal = openRequestNoteModal;

  function isMobileRequestView() {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  var quizMotion = null;
  var quizPhase = '';
  var quizScrollY = 0;

  function stopQuizMotion() {
    if (quizMotion && window.rhMotion) window.rhMotion.stop(quizMotion);
    quizMotion = null;
  }

  function lockQuizPage() {
    quizScrollY = document.body.scrollTop || window.scrollY || 0;
    document.body.classList.add('rh-quiz-open');
  }

  function unlockQuizPage() {
    document.body.classList.remove('rh-quiz-open');
    requestAnimationFrame(function () {
      document.body.scrollTop = quizScrollY;
    });
  }

  function finishCloseQuiz() {
    var quiz = document.getElementById('request-quiz');
    var body = document.getElementById('request-quiz-body');
    if (quiz) {
      if (window.rhMotion) window.rhMotion.reset(quiz);
      quiz.hidden = true;
      quiz.style.opacity = '';
      quiz.style.transform = '';
    }
    if (body) body.innerHTML = '';
    unlockQuizPage();
    quizPhase = '';
    quizMotion = null;
  }

  window.closeRequestQuiz = function () {
    var quiz = document.getElementById('request-quiz');
    if (!quiz || quiz.hidden || quizPhase === 'closing') {
      if (quiz && quiz.hidden) finishCloseQuiz();
      return Promise.resolve();
    }

    quizPhase = 'closing';
    stopQuizMotion();

    var motion = window.rhMotion;
    if (motion && !motion.reduced()) {
      quizMotion = motion.closeOverlay(quiz, 'sheet-quiz');
      return Promise.resolve(quizMotion && quizMotion.finished)
        .then(function () {
          if (quizPhase === 'closing') finishCloseQuiz();
        })
        .catch(function () {
          if (quizPhase === 'closing') finishCloseQuiz();
        });
    }

    finishCloseQuiz();
    return Promise.resolve();
  };

  window.refreshRequestsList = function () {
    var main = document.getElementById('requests-main');
    if (!main || typeof htmx === 'undefined') return;
    htmx.ajax('GET', window.location.pathname + window.location.search || '/', {
      target: '#requests-main',
      swap: 'innerHTML',
    });
  };

  window.openRequestCreate = function () {
    if (isMobileRequestView()) {
      var quiz = document.getElementById('request-quiz');
      if (!quiz) return;

      var alreadyOpen = !quiz.hidden && quizPhase !== 'closing';
      stopQuizMotion();
      quizPhase = 'opening';
      lockQuizPage();

      var motion = window.rhMotion;
      if (!alreadyOpen && motion) motion.prepareQuizOpen(quiz);

      quiz.hidden = false;
      htmx.ajax('GET', '/new', { target: '#request-quiz-body', swap: 'innerHTML' });

      if (!alreadyOpen && motion && !motion.reduced()) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (quizPhase !== 'opening') return;
            quizMotion = motion.openOverlay(quiz, 'sheet-quiz');
            Promise.resolve(quizMotion && quizMotion.finished).then(function () {
              if (quizPhase === 'opening') quizPhase = '';
            });
          });
        });
        return;
      }

      quiz.style.opacity = '';
      quiz.style.transform = '';
      quizPhase = '';
      return;
    }

    htmx.ajax('GET', '/new', { target: '#modal-body', swap: 'innerHTML' });
    if (modal) modal.showModal();
  };

  function getAccountTrigger() {
    if (isMobileRequestView()) {
      return (
        document.getElementById('rh-mobile-account-trigger') ||
        document.querySelector('.rh-account-trigger--mobile') ||
        document.getElementById('rh-account-trigger')
      );
    }
    return document.getElementById('rh-account-trigger') || document.querySelector('.rh-account-trigger');
  }

  var accountMotion = null;
  var accountPhase = '';

  function stopAccountMotion() {
    if (accountMotion && window.rhMotion) window.rhMotion.stop(accountMotion);
    accountMotion = null;
  }

  function finishCloseAccount() {
    var dropdown = document.getElementById('rh-account-dropdown');
    var backdrop = document.getElementById('rh-account-backdrop');
    if (dropdown) {
      if (window.rhMotion) window.rhMotion.reset(dropdown);
      dropdown.hidden = true;
      dropdown.style.opacity = '';
      dropdown.style.transform = '';
      var panel = dropdown.querySelector('[data-rh-motion-panel]');
      if (panel) {
        panel.style.opacity = '';
        panel.style.transform = '';
      }
      var frost = dropdown.querySelector('[data-rh-motion-backdrop]');
      if (frost) {
        frost.style.opacity = '';
      }
    }
    if (backdrop) backdrop.hidden = true;
    document.querySelectorAll('.rh-account-trigger').forEach(function (el) {
      el.setAttribute('aria-expanded', 'false');
    });
    document.body.classList.remove('rh-account-open');
    clearAccountDropdownPosition();
    accountPhase = '';
    accountMotion = null;
  }

  function closeAccountDropdown() {
    var dropdown = document.getElementById('rh-account-dropdown');
    if (!dropdown || dropdown.hidden || accountPhase === 'closing') return;

    accountPhase = 'closing';
    stopAccountMotion();

    var variant = document.body.classList.contains('rh-account-open') ? 'sheet-profile' : 'menu';
    var motion = window.rhMotion;
    if (motion && !motion.reduced()) {
      accountMotion = motion.closeOverlay(dropdown, variant);
      Promise.resolve(accountMotion && accountMotion.finished)
        .then(function () {
          if (accountPhase === 'closing') finishCloseAccount();
        })
        .catch(function () {
          if (accountPhase === 'closing') finishCloseAccount();
        });
      return;
    }

    finishCloseAccount();
  }

  window.closeAccountDropdown = closeAccountDropdown;

  function clearAccountDropdownPosition() {
    var dropdown = document.getElementById('rh-account-dropdown');
    if (!dropdown) return;

    dropdown.style.position = '';
    dropdown.style.top = '';
    dropdown.style.bottom = '';
    dropdown.style.left = '';
    dropdown.style.right = '';
    dropdown.style.minWidth = '';
    dropdown.style.width = '';
  }

  function positionAccountDropdown() {
    var dropdown = document.getElementById('rh-account-dropdown');
    var trigger = getAccountTrigger();
    if (!dropdown || !trigger || dropdown.hidden) return;
    if (isMobileRequestView()) {
      clearAccountDropdownPosition();
      return;
    }

    var rect = trigger.getBoundingClientRect();
    var gap = 8;
    var edge = 12;

    dropdown.style.position = 'fixed';
    dropdown.style.left = 'auto';
    dropdown.style.right = Math.max(edge, window.innerWidth - rect.right) + 'px';
    dropdown.style.minWidth = '12rem';
    dropdown.style.width = '';
    dropdown.style.bottom = 'auto';
    dropdown.style.top = rect.bottom + gap + 'px';
  }

  function toggleAccountDropdown() {
    var dropdown = document.getElementById('rh-account-dropdown');
    var trigger = getAccountTrigger();
    var backdrop = document.getElementById('rh-account-backdrop');
    if (!dropdown || !trigger) return;

    var shouldOpen = dropdown.hidden || accountPhase === 'closing';
    if (!shouldOpen) {
      closeAccountDropdown();
      return;
    }

    stopAccountMotion();
    accountPhase = 'opening';

    var mobile = isMobileRequestView();
    document.body.classList.toggle('rh-account-open', mobile);
    if (mobile && window.rhMotion) window.rhMotion.prepareSheetOpen(dropdown);
    dropdown.hidden = false;
    if (backdrop) backdrop.hidden = true;
    document.querySelectorAll('.rh-account-trigger').forEach(function (el) {
      el.setAttribute('aria-expanded', 'true');
    });
    if (!mobile) positionAccountDropdown();
    else clearAccountDropdownPosition();

    var motion = window.rhMotion;
    if (motion && !motion.reduced()) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (accountPhase !== 'opening') return;
          accountMotion = motion.openOverlay(dropdown, mobile ? 'sheet-profile' : 'menu');
          Promise.resolve(accountMotion && accountMotion.finished).then(function () {
            if (accountPhase === 'opening') accountPhase = '';
          });
        });
      });
      return;
    }

    accountPhase = '';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var accountBackdrop = document.getElementById('rh-account-backdrop');

    document.querySelectorAll('.rh-account-trigger').forEach(function (accountTrigger) {
      accountTrigger.addEventListener('click', function (e) {
        e.preventDefault();
        toggleAccountDropdown();
      });
    });

    if (accountBackdrop) {
      accountBackdrop.addEventListener('click', closeAccountDropdown);
    }

    var accountFrost = document.querySelector('.rh-account-dropdown-frost');
    if (accountFrost) {
      accountFrost.addEventListener('click', function () {
        if (document.body.classList.contains('rh-account-open')) closeAccountDropdown();
      });
    }

    document.addEventListener('click', function (e) {
      var dropdown = document.getElementById('rh-account-dropdown');
      if (!dropdown || dropdown.hidden || accountPhase === 'closing') return;
      if (e.target.closest('.rh-account-trigger') || e.target.closest('#rh-account-dropdown')) return;
      closeAccountDropdown();
    });

    window.addEventListener('resize', function () {
      positionAccountDropdown();
    });

    document.body.addEventListener('click', function (e) {
      var noteBtn = e.target.closest('.rh-note-preview--link, .rh-note-more');
      if (!noteBtn) return;
      e.preventDefault();
      openRequestNoteModal(noteBtn.dataset.requestId);
    });

    document.body.addEventListener('htmx:afterSwap', function (evt) {
      var target = evt.detail.target;
      if (!target) return;
      if (target.id === 'modal-body' && modal) modal.showModal();
      var root =
        modalSearchRoot(target) ||
        (target.querySelector && target.querySelector('.users-modal-shell, .teams-modal-shell'));
      if (root) applyModalSearch(root);
    });

    function applyPageMeta(page) {
      if (!page) return;
      var meta = page.querySelector('[data-rh-page]');
      var name = meta ? meta.getAttribute('data-rh-page') : '';
      document.body.classList.toggle('rh-requests-page', name === 'requests');
      document.body.classList.toggle('rh-profile-page', name === 'profile');
      if (meta && meta.getAttribute('data-rh-title')) {
        document.title = meta.getAttribute('data-rh-title');
      }

      var heroName = page.querySelector('.rh-profile-hero-name');
      if (heroName) {
        document.querySelectorAll('.rh-account-dropdown-name').forEach(function (el) {
          el.textContent = heroName.textContent;
        });
      }

      var previewImg = page.querySelector('#profile-avatar-preview img.rh-avatar-img');
      if (previewImg) {
        document.querySelectorAll(
          '.rh-account-trigger img.rh-avatar-img, .rh-account-dropdown-user img.rh-avatar-img, .rh-mobile-account-btn img.rh-avatar-img'
        ).forEach(function (img) {
          img.src = previewImg.getAttribute('src');
        });
      }

      bindDialogChrome(document.getElementById('avatar-crop-modal'));
    }

    window.applyRhPageMeta = applyPageMeta;

    window.refreshAppPage = function (url) {
      if (typeof htmx === 'undefined' || !document.getElementById('rh-page')) {
        window.location.href = url || window.location.pathname;
        return;
      }
      htmx.ajax('GET', url || (window.location.pathname + window.location.search), {
        target: '#rh-page',
        swap: 'innerHTML show:none',
      });
    };

    function stayInApp(url) {
      if (modal) modal.close();
      Promise.resolve(window.closeRequestQuiz && window.closeRequestQuiz()).finally(function () {
        var next;
        try {
          next = new URL(url, window.location.origin);
        } catch (e) {
          window.location.href = url;
          return;
        }
        if (next.origin !== window.location.origin || next.pathname === '/login') {
          window.location.href = url;
          return;
        }
        if (document.getElementById('requests-main') && next.pathname === '/') {
          if (typeof window.refreshRequestsList === 'function') window.refreshRequestsList();
          return;
        }
        if (typeof htmx !== 'undefined' && document.getElementById('rh-page')) {
          htmx.ajax('GET', next.pathname + next.search, {
            target: '#rh-page',
            swap: 'innerHTML show:window:top',
          });
          return;
        }
        window.location.href = url;
      });
    }

    document.body.addEventListener('modal-close', function () {
      if (modal) modal.close('', true);
    });

    document.body.addEventListener('requests-refresh', function () {
      if (typeof window.refreshRequestsList === 'function') window.refreshRequestsList();
    });

    document.body.addEventListener('htmx:beforeRequest', function (evt) {
      var elt = evt.detail && evt.detail.elt;
      if (!elt || !elt.getAttribute) return;
      if ((elt.getAttribute('hx-target') || '') !== '#rh-page') return;
      var url = elt.getAttribute('hx-get') || '';
      if (url !== '/' && url.indexOf('/?') !== 0) return;
      if (!document.getElementById('requests-main')) return;
      evt.preventDefault();
      if (typeof window.refreshRequestsList === 'function') {
        window.refreshRequestsList();
      }
    });

    document.body.addEventListener('htmx:afterSwap', function (evt) {
      if (evt.detail && evt.detail.target && evt.detail.target.id === 'rh-page') {
        applyPageMeta(evt.detail.target);
      }
    });

    document.body.addEventListener('htmx:historyRestore', function () {
      applyPageMeta(document.getElementById('rh-page'));
    });

    document.body.addEventListener('htmx:afterRequest', function (evt) {
      var xhr = evt.detail.xhr;
      if (!xhr) return;
      var redirect = xhr.getResponseHeader('HX-Redirect');
      if (redirect) {
        stayInApp(redirect);
        return;
      }
      if (xhr.getResponseHeader('HX-Refresh') === 'true') {
        stayInApp('/');
      }
    });

    var params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') {
      window.openRequestCreate();
      params.delete('new');
      var qs = params.toString();
      history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
    }
    if (params.get('panel') === 'users') {
      htmx.ajax('GET', '/users/modal', { target: '#modal-body', swap: 'innerHTML' });
    }
    if (params.get('panel') === 'users-new') {
      htmx.ajax('GET', '/users/new-modal', { target: '#modal-body', swap: 'innerHTML' });
    }
    if (params.get('panel') === 'teams') {
      htmx.ajax('GET', '/teams/modal', { target: '#modal-body', swap: 'innerHTML' });
    }
    if (params.get('panel') === 'teams-new') {
      htmx.ajax('GET', '/teams/new-modal', { target: '#modal-body', swap: 'innerHTML' });
    }
  });
})();
