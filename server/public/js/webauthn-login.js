import { startAuthentication } from 'https://unpkg.com/@simplewebauthn/browser@11.0.0/dist/bundle/index.js';

const btn = document.getElementById('webauthn-login-btn');
const usernameInput = document.querySelector('input[name="username"]');
const errorEl = document.getElementById('webauthn-login-error');

function showError(message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  if (!errorEl) return;
  errorEl.textContent = '';
  errorEl.hidden = true;
}

btn?.addEventListener('click', async () => {
  clearError();

  const username = usernameInput?.value?.trim();
  if (!username) {
    showError('Enter your stage first');
    usernameInput?.focus();
    return;
  }

  btn.disabled = true;
  const label = btn.querySelector('.webauthn-login-label');
  const busy = btn.querySelector('.webauthn-login-busy');
  if (label) label.hidden = true;
  if (busy) busy.hidden = false;

  try {
    const optionsRes = await fetch('/webauthn/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username }),
    });

    const optionsPayload = await optionsRes.json().catch(() => ({}));
    if (!optionsRes.ok) {
      throw new Error(optionsPayload.error || 'Could not start Face ID / Touch ID sign-in');
    }

    const authResponse = await startAuthentication({ optionsJSON: optionsPayload });

    const loginRes = await fetch('/webauthn/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(authResponse),
    });

    const loginPayload = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok) {
      throw new Error(
        loginPayload.error ||
          'Could not verify Face ID / Touch ID. Try again or sign in with your password'
      );
    }

    window.location.href = loginPayload.redirect || '/app';
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showError(
        'Touch ID / Face ID was not confirmed. If Bitwarden opened, close it, link your key in Profile on apex-aff.xyz, or choose this device instead of the password manager.'
      );
    } else if (/no passkeys|not allowed|timed out/i.test(String(err.message || ''))) {
      showError(
        'No Touch ID linked for apex-aff.xyz. Sign in with your password → Profile → link Face ID / Touch ID again.'
      );
    } else {
      showError(err.message || 'Could not sign in with Face ID / Touch ID');
    }
  } finally {
    btn.disabled = false;
    if (label) label.hidden = false;
    if (busy) busy.hidden = true;
  }
});
