/* ═══════════════════════════════════════════════════════
   JaeTheTech — Auth System (Cloudflare Worker + Resend)
   Server-side code generation — codes never touch the browser
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── API endpoint (Cloudflare Worker) ───────────────── */
  const API_BASE = 'https://jaethetech.com';

  /* ── Session config ─────────────────────────────────── */
  const SESSION_KEY = 'jtt_auth';
  const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours

  /* ── DOM refs ───────────────────────────────────────── */
  const emailStep  = document.getElementById('email-step');
  const codeStep   = document.getElementById('code-step');
  const emailInput = document.getElementById('login-email');
  const codeInput  = document.getElementById('login-code');
  const sentTo     = document.getElementById('sent-to');
  const errorEl    = document.getElementById('login-error');
  const spinnerEl  = document.getElementById('login-spinner');
  const resendBtn  = document.getElementById('resend-btn');

  /* ── State ──────────────────────────────────────────── */
  var pendingEmail = null;

  /* ── Helpers ────────────────────────────────────────── */
  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    setTimeout(function () { errorEl.style.display = 'none'; }, 4000);
  }

  function showSpinner(on) {
    if (spinnerEl) spinnerEl.style.display = on ? 'flex' : 'none';
  }

  function setSession(email, token) {
    var data = { ts: Date.now(), ttl: SESSION_TTL, email: email, token: token };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }

  function hasValidSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      return (Date.now() - data.ts) < data.ttl;
    } catch (e) { return false; }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  /* ── Already authed? Redirect ───────────────────────── */
  if (hasValidSession() && window.location.pathname.indexOf('login') !== -1) {
    window.location.replace('admin.html');
    return;
  }

  /* ── API call helper ────────────────────────────────── */
  function apiCall(endpoint, body) {
    return fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); });
  }

  /* ── Step 1: Email submit → Worker generates & sends code */
  if (emailStep) {
    emailStep.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = emailInput.value.trim().toLowerCase();

      if (!isValidEmail(email)) {
        showError('Please enter a valid email address.');
        return;
      }

      showSpinner(true);
      apiCall('/api/auth/send-code', { email: email })
        .then(function (data) {
          showSpinner(false);
          if (data.error) { showError(data.error); return; }
          pendingEmail = email;
          emailStep.style.display = 'none';
          codeStep.style.display = 'block';
          sentTo.textContent = email;
          codeInput.focus();
        })
        .catch(function (err) {
          showSpinner(false);
          console.error('API error:', err);
          showError('Connection error. Try again.');
        });
    });
  }

  /* ── Step 2: Code verify → Worker checks code server-side */
  if (codeStep) {
    codeStep.addEventListener('submit', function (e) {
      e.preventDefault();
      var entered = codeInput.value.trim();

      if (!entered || entered.length !== 6) {
        showError('Enter the 6-digit code.');
        return;
      }

      showSpinner(true);
      apiCall('/api/auth/verify-code', { email: pendingEmail, code: entered })
        .then(function (data) {
          showSpinner(false);
          if (data.error) {
            showError(data.error);
            codeInput.value = '';
            codeInput.focus();
            return;
          }
          setSession(data.email, data.token);
          window.location.replace('admin.html');
        })
        .catch(function (err) {
          showSpinner(false);
          console.error('API error:', err);
          showError('Connection error. Try again.');
        });
    });
  }

  /* ── Resend ─────────────────────────────────────────── */
  if (resendBtn) {
    resendBtn.addEventListener('click', function () {
      if (!pendingEmail) return;
      showSpinner(true);
      apiCall('/api/auth/send-code', { email: pendingEmail })
        .then(function (data) {
          showSpinner(false);
          if (data.error) { showError(data.error); return; }
          showError('New code sent.');
        })
        .catch(function () {
          showSpinner(false);
          showError('Failed to resend. Try again.');
        });
    });
  }

})();

/* ── Auth Guard (use on protected pages) ────────────── */
function requireAuth() {
  var SESSION_KEY = 'jtt_auth';
  try {
    var raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) { window.location.replace('login.html'); return; }
    var data = JSON.parse(raw);
    if ((Date.now() - data.ts) >= data.ttl) {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.replace('login.html');
    }
  } catch (e) {
    window.location.replace('login.html');
  }
}
