(function () {
  var TOTAL_STEPS = 5;
  var state = {
    step: 1,
    geo: '',
    quantity: '',
    funnel: '',
    comment: '',
    draftId: '',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getRoot() {
    return $('request-quiz-root');
  }

  function hasProgress() {
    return !!(
      state.geo.trim() ||
      state.quantity ||
      state.funnel.trim() ||
      state.comment.trim()
    );
  }

  function readFieldsFromDom() {
    var geoInput = $('quiz-geo');
    if (geoInput) state.geo = geoInput.value;
    state.quantity = $('quiz-quantity') ? $('quiz-quantity').value : state.quantity;
    state.funnel = $('quiz-funnel') ? $('quiz-funnel').value : state.funnel;
    state.comment = $('quiz-comment') ? $('quiz-comment').value : state.comment;
  }

  function buildBody(intent) {
    readFieldsFromDom();
    var params = new URLSearchParams();
    if (state.draftId) params.set('draft_id', state.draftId);
    params.set('geo', state.geo.trim());
    params.set('quantity', state.quantity || '');
    params.set('funnel', state.funnel || '');
    params.set('comment', state.comment || '');
    if (intent) params.set('intent', intent);
    return params;
  }

  function postRequest(intent) {
    return fetch('/', {
      method: 'POST',
      body: buildBody(intent),
      headers: {
        'HX-Request': 'true',
        'HX-Target': 'request-quiz-body',
        'X-RH-Quiz': '1',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      credentials: 'same-origin',
    });
  }

  function refreshRequestsList() {
    if (typeof window.refreshRequestsList === 'function') {
      window.refreshRequestsList();
    }
  }

  function closeQuiz(refreshList) {
    if (refreshList) refreshRequestsList();
    if (typeof window.closeRequestQuiz === 'function') {
      return window.closeRequestQuiz();
    }
    return Promise.resolve();
  }

  function saveDraftAndClose() {
    readFieldsFromDom();
    if (!hasProgress()) {
      closeQuiz(false);
      return;
    }

    postRequest('draft').finally(function () {
      closeQuiz(true);
    });
  }

  function submitRequest() {
    var nextBtn = $('request-quiz-next');
    if (nextBtn) nextBtn.disabled = true;

    postRequest('')
      .then(function (res) {
        if (res.status === 204) {
          closeQuiz(true);
          return null;
        }
        return res.text().then(function (html) {
          return { status: res.status, html: html };
        });
      })
      .then(function (result) {
        if (!result || !result.html) return;
        var body = $('request-quiz-body');
        if (body) {
          body.innerHTML = result.html;
          initRequestQuiz();
        }
      })
      .finally(function () {
        if (nextBtn) nextBtn.disabled = false;
      });
  }

  function syncReview() {
    readFieldsFromDom();
    var geo = state.geo.trim() || '—';
    if ($('quiz-review-geo')) $('quiz-review-geo').textContent = geo;
    if ($('quiz-review-cap')) $('quiz-review-cap').textContent = state.quantity || '—';
    if ($('quiz-review-funnel')) $('quiz-review-funnel').textContent = state.funnel.trim() || '—';
    if ($('quiz-review-comment')) $('quiz-review-comment').textContent = state.comment.trim() || '—';
  }

  function showStep(step) {
    state.step = step;
    document.querySelectorAll('.rh-quiz-step').forEach(function (el) {
      el.classList.toggle('hidden', Number(el.dataset.step) !== step);
    });

    if ($('request-quiz-step-label')) {
      $('request-quiz-step-label').textContent = step + ' / ' + TOTAL_STEPS;
    }
    if ($('request-quiz-progress')) {
      $('request-quiz-progress').style.width = ((step / TOTAL_STEPS) * 100) + '%';
    }

    var backBtn = $('request-quiz-back');
    var nextBtn = $('request-quiz-next');
    if (backBtn) backBtn.classList.toggle('hidden', step === 1);
    if (nextBtn) nextBtn.textContent = step === TOTAL_STEPS ? 'Send request' : 'Next';

    if (step === 5) syncReview();
  }

  function showError(step, message) {
    var el = $('quiz-error-' + step);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('hidden', !message);
  }

  function validateStep(step) {
    readFieldsFromDom();
    showError(step, '');

    if (step === 1) {
      if (!state.geo.trim()) {
        showError(1, 'Enter GEO');
        return false;
      }
      return true;
    }

    if (step === 2) {
      var qty = Number(state.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        showError(2, 'Enter a whole number greater than 0');
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (!state.funnel.trim()) {
        showError(3, 'Enter funnel name');
        return false;
      }
      return true;
    }

    return true;
  }

  function bindGeoInput() {
    var input = $('quiz-geo');
    if (!input) return;

    input.value = state.geo || '';
    input.addEventListener('input', function () {
      state.geo = input.value;
      showError(1, '');
    });
  }

  function firstIncompleteStep() {
    var root = getRoot();
    var isDraft = root && root.dataset.isDraft === '1';

    readFieldsFromDom();
    if (!state.geo.trim()) return 1;
    var qty = Number(state.quantity);
    if (!Number.isInteger(qty) || qty <= 0) return 2;
    if (!state.funnel.trim()) return 3;
    if (isDraft) return 5;
    return 4;
  }

  function showServerError() {
    var alert = document.querySelector('.rh-quiz-alert span');
    if (!alert) return;
    var message = alert.textContent.trim();
    if (!message) return;
    showError(5, message);
    showStep(5);
  }

  window.initRequestQuiz = function () {
    var root = getRoot();
    if (!root) return;

    state.draftId = root.dataset.draftId || '';
    state.geo = root.dataset.initialGeo || '';
    state.quantity = root.dataset.initialQuantity || '';
    state.funnel = root.dataset.initialFunnel || '';
    state.comment = root.dataset.initialComment || '';

    bindGeoInput();
    showStep(firstIncompleteStep());
    showServerError();

    var closeBtn = $('request-quiz-close');
    if (closeBtn) {
      closeBtn.onclick = function (e) {
        e.preventDefault();
        saveDraftAndClose();
      };
    }

    var backBtn = $('request-quiz-back');
    if (backBtn) {
      backBtn.onclick = function () {
        if (state.step > 1) showStep(state.step - 1);
      };
    }

    var nextBtn = $('request-quiz-next');
    if (nextBtn) {
      nextBtn.onclick = function () {
        if (!validateStep(state.step)) return;
        if (state.step === TOTAL_STEPS) {
          submitRequest();
          return;
        }
        showStep(state.step + 1);
      };
    }
  };

  document.body.addEventListener('htmx:afterSwap', function (evt) {
    if (evt.detail.target && evt.detail.target.id === 'request-quiz-body') {
      initRequestQuiz();
    }
  });
})();
