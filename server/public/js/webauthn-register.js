import { startRegistration } from 'https://unpkg.com/@simplewebauthn/browser@11.0.0/dist/bundle/index.js';

if (window.__rhWebauthnRegisterBound) {
  // already listening
} else {
  window.__rhWebauthnRegisterBound = true;

  function showStatus(message, isError) {
    var statusEl = document.getElementById('webauthn-register-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = false;
    statusEl.classList.toggle('text-error', !!isError);
  }

  document.body.addEventListener('click', async function (evt) {
    var btn = evt.target.closest('#webauthn-register-btn');
    if (!btn) return;

    btn.disabled = true;
    var originalText = btn.textContent;
    btn.textContent = 'Please wait…';
    var statusEl = document.getElementById('webauthn-register-status');
    if (statusEl) statusEl.hidden = true;

    try {
      var optionsRes = await fetch('/webauthn/register-options', {
        credentials: 'same-origin',
      });

      var optionsPayload = await optionsRes.json().catch(function () { return {}; });
      if (!optionsRes.ok) {
        throw new Error(optionsPayload.error || 'Could not start Touch ID / Face ID linking');
      }

      var registrationResponse = await startRegistration({ optionsJSON: optionsPayload });

      var registerRes = await fetch('/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(registrationResponse),
      });

      var registerPayload = await registerRes.json().catch(function () { return {}; });
      if (!registerRes.ok) {
        throw new Error(registerPayload.error || 'Could not save passkey');
      }

      if (typeof window.refreshAppPage === 'function') {
        window.refreshAppPage('/profile?success=passkey');
      } else if (typeof htmx !== 'undefined' && document.getElementById('rh-page')) {
        htmx.ajax('GET', '/profile?success=passkey', { target: '#rh-page', swap: 'innerHTML show:none' });
      } else {
        window.location.href = '/profile?success=passkey';
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = originalText;
      if (err.name === 'NotAllowedError') {
        showStatus('Cancelled or Touch ID / Face ID is unavailable on this device', true);
      } else {
        showStatus(err.message || 'Could not link Touch ID / Face ID', true);
      }
    }
  });
}
