(function () {
  var resizeTimer;

  function getGoogleButtonWidth(container) {
    var card = container.closest('.rh-login-card');
    if (card) {
      var style = window.getComputedStyle(card);
      var padding =
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      var inner = Math.floor(card.clientWidth - padding);
      if (inner > 0) {
        return Math.min(400, Math.max(200, inner - 2));
      }
    }

    var host = document.getElementById('google-signin-button');
    var measureEl = host || container;
    var width = Math.floor(measureEl.clientWidth);

    if (!width) {
      width = Math.floor(measureEl.getBoundingClientRect().width);
    }

    width = Math.max(200, width - 2);
    return Math.min(400, width);
  }

  function getGoogleButtonTheme() {
    return document.documentElement.getAttribute('data-theme') === 'rh-dark'
      ? 'filled_black'
      : 'outline';
  }

  function renderGoogleSignInButton() {
    var container = document.querySelector('.rh-google-signin');
    var buttonHost = document.getElementById('google-signin-button');
    if (!container || !buttonHost || !window.google || !google.accounts || !google.accounts.id) {
      return;
    }

    var width = getGoogleButtonWidth(container);
    buttonHost.innerHTML = '';
    buttonHost.style.removeProperty('width');
    buttonHost.style.removeProperty('max-width');
    google.accounts.id.renderButton(buttonHost, {
      type: 'standard',
      size: 'large',
      width: width,
      theme: getGoogleButtonTheme(),
      text: 'signin_with',
      shape: 'rectangular',
    });
  }

  function scheduleGoogleSignInRender() {
    renderGoogleSignInButton();
    window.requestAnimationFrame(function () {
      renderGoogleSignInButton();
      window.setTimeout(renderGoogleSignInButton, 250);
    });
  }

  function waitForGoogleSignIn() {
    if (window.google && google.accounts && google.accounts.id) {
      scheduleGoogleSignInRender();
      return;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (window.google && google.accounts && google.accounts.id) {
        window.clearInterval(timer);
        scheduleGoogleSignInRender();
        return;
      }
      if (attempts > 200) {
        window.clearInterval(timer);
      }
    }, 50);
  }

  window.addEventListener('load', waitForGoogleSignIn);
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderGoogleSignInButton, 150);
  });
  window.addEventListener('orientationchange', function () {
    window.setTimeout(scheduleGoogleSignInRender, 300);
  });
})();
