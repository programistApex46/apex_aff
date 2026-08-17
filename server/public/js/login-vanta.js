(function () {
  var effect = null;

  function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'rh-dark';
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function getTrunkOptions() {
    if (isDarkTheme()) {
      return {
        backgroundColor: 0x0e0f12,
        color: 0xff5c61,
        spacing: 2.1,
        chaos: 3.8,
      };
    }

    return {
      backgroundColor: 0xe8eaef,
      color: 0xee4545,
      spacing: 2.4,
      chaos: 3.2,
    };
  }

  function destroyEffect() {
    if (effect) {
      effect.destroy();
      effect = null;
    }
  }

  function initLoginVanta() {
    var el = document.getElementById('login-vanta-bg');
    if (!el || typeof VANTA === 'undefined' || !VANTA.TRUNK) return;

    destroyEffect();

    if (prefersReducedMotion()) {
      el.style.display = 'none';
      return;
    }

    el.style.display = '';
    var options = getTrunkOptions();

    effect = VANTA.TRUNK({
      el: el,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      scale: 1,
      scaleMobile: 1,
      backgroundColor: options.backgroundColor,
      color: options.color,
      spacing: options.spacing,
      chaos: options.chaos,
    });
  }

  window.initLoginVanta = initLoginVanta;

  document.addEventListener('DOMContentLoaded', function () {
    initLoginVanta();

    var originalToggleTheme = window.toggleTheme;
    window.toggleTheme = function () {
      if (originalToggleTheme) originalToggleTheme();
      initLoginVanta();
    };
  });

  window.addEventListener('beforeunload', destroyEffect);
})();
