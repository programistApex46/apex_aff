(function () {
  var resizeTimer;

  function getGoogleButtonWidth(container) {
    var width = Math.floor(container.getBoundingClientRect().width);
    if (!width) {
      width = Math.floor(container.clientWidth);
    }
    return Math.min(400, Math.max(200, width));
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
    google.accounts.id.renderButton(buttonHost, {
      type: 'standard',
      size: 'large',
      width: width,
      theme: getGoogleButtonTheme(),
      text: 'signin_with',
      shape: 'rectangular',
    });
  }

  function waitForGoogleSignIn() {
    if (window.google && google.accounts && google.accounts.id) {
      renderGoogleSignInButton();
      return;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (window.google && google.accounts && google.accounts.id) {
        window.clearInterval(timer);
        renderGoogleSignInButton();
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
})();
