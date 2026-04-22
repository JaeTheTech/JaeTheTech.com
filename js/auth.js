/* ═══════════════════════════════════════════════════════
   JaeTheTech — Auth System v2
   Two-tier: website (6-digit) + apps (JTT codes)
   No passwords. No code tracking. Self-destructing codes.
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── API endpoint ───────────────────────────────────── */
  var API = 'https://jaethetech.com';

  /* ── Session config ─────────────────────────────────── */
  var SESSION_KEY = 'jtt_auth';
  var SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours

  /* ── DOM refs (login flow) ──────────────────────────── */
  var emailStep   = document.getElementById('email-step');
  var codeStep    = document.getElementById('code-step');
  var emailInput  = document.getElementById('login-email');
  var codeInput   = document.getElementById('login-code');
  var sentTo      = document.getElementById('sent-to');
  var resendBtn   = document.getElementById('resend-btn');

  /* ── DOM refs (signup flow) ─────────────────────────── */
  var signupEmailStep = document.getElementById('signup-email-step');
  var signupCodeStep  = document.getElementById('signup-code-step');
  var signupEmail     = document.getElementById('signup-email');
  var signupCode      = document.getElementById('signup-code');
  var signupSentTo    = document.getElementById('signup-sent-to');

  /* ── DOM refs (shared) ──────────────────────────────── */
  var errorEl    = document.getElementById('login-error');
  var spinnerEl  = document.getElementById('login-spinner');

  /* ── DOM refs (GitHub) ──────────────────────────────── */
  var githubBtn  = document.getElementById('github-login-btn');

  /* ── Tab refs ───────────────────────────────────────── */
  var tabLogin   = document.getElementById('tab-login');
  var tabSignup  = document.getElementById('tab-signup');
  var loginFlow  = document.getElementById('login-flow');
  var signupFlow = document.getElementById('signup-flow');

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

  function setSession(email, token, role) {
    var data = { ts: Date.now(), ttl: SESSION_TTL, email: email, token: token, role: role || 'user' };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }

  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if ((Date.now() - data.ts) >= data.ttl) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return data;
    } catch (e) { return null; }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  function redirectForRole(role) {
    if (role === 'admin' || role === 'staff') {
      window.location.replace('admin.html');
    } else {
      window.location.replace('dashboard.html');
    }
  }

  /* ── Already authed? Redirect ───────────────────────── */
  var session = getSession();
  if (session && window.location.pathname.indexOf('login') !== -1) {
    redirectForRole(session.role);
    return;
  }

  /* ── Check for error in URL ─────────────────────────── */
  var urlParams = new URLSearchParams(window.location.search);
  var errorParam = urlParams.get('error');
  if (errorParam) {
    showError(decodeURIComponent(errorParam));
    // Clear the URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  /* ── API call helper ────────────────────────────────── */
  function apiCall(endpoint, body) {
    return fetch(API + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); });
  }

  /* ── Tab switching ──────────────────────────────────── */
  if (tabLogin && tabSignup) {
    tabLogin.addEventListener('click', function () {
      tabLogin.classList.add('active');
      tabSignup.classList.remove('active');
      loginFlow.style.display = 'block';
      signupFlow.style.display = 'none';
    });
    tabSignup.addEventListener('click', function () {
      tabSignup.classList.add('active');
      tabLogin.classList.remove('active');
      signupFlow.style.display = 'block';
      loginFlow.style.display = 'none';
    });
  }

  /* ═══ LOGIN: Step 1 — Email ═════════════════════════── */
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
        .catch(function () {
          showSpinner(false);
          showError('Connection error. Try again.');
        });
    });
  }

  /* ═══ LOGIN: Step 2 — Verify ════════════════════════── */
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
          setSession(data.email, data.token, data.role);
          redirectForRole(data.role);
        })
        .catch(function () {
          showSpinner(false);
          showError('Connection error. Try again.');
        });
    });
  }

  /* ═══ LOGIN: Resend ═════════════════════════════════── */
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

  /* ═══ GITHUB LOGIN ════════════════════════════════════ */
  if (githubBtn) {
    githubBtn.addEventListener('click', function () {
      showSpinner(true);
      // Redirect to GitHub OAuth
      window.location.href = API + '/api/auth/github';
    });
  }

  /* ═══ SIGNUP: Step 1 — Register email ═══════════════── */
  if (signupEmailStep) {
    signupEmailStep.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = signupEmail.value.trim().toLowerCase();

      if (!isValidEmail(email)) {
        showError('Please enter a valid email address.');
        return;
      }

      showSpinner(true);
      apiCall('/api/auth/signup', { email: email })
        .then(function (data) {
          showSpinner(false);
          if (data.error) { showError(data.error); return; }
          pendingEmail = email;
          signupEmailStep.style.display = 'none';
          signupCodeStep.style.display = 'block';
          signupSentTo.textContent = email;
          signupCode.focus();
        })
        .catch(function () {
          showSpinner(false);
          showError('Connection error. Try again.');
        });
    });
  }

  /* ═══ SIGNUP: Step 2 — Verify ═══════════════════════── */
  if (signupCodeStep) {
    signupCodeStep.addEventListener('submit', function (e) {
      e.preventDefault();
      var entered = signupCode.value.trim();

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
            signupCode.value = '';
            signupCode.focus();
            return;
          }
          setSession(data.email, data.token, data.role);
          redirectForRole(data.role);
        })
        .catch(function () {
          showSpinner(false);
          showError('Connection error. Try again.');
        });
    });
  }

})();

/* ═══ Auth Guard (use on protected pages) ═══════════════ */
function requireAuth(minRole) {
  var SESSION_KEY = 'jtt_auth';
  try {
    var raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) { window.location.replace('login.html'); return null; }
    var data = JSON.parse(raw);
    if ((Date.now() - data.ts) >= data.ttl) {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.replace('login.html');
      return null;
    }
    // Role check
    if (minRole) {
      var roles = { user: 1, staff: 2, admin: 3 };
      if ((roles[data.role] || 0) < (roles[minRole] || 0)) {
        window.location.replace('dashboard.html');
        return null;
      }
    }
    return data;
  } catch (e) {
    window.location.replace('login.html');
    return null;
  }
}

/* ═══ Get current session helper ════════════════════════ */
function getAuthSession() {
  var SESSION_KEY = 'jtt_auth';
  try {
    var raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if ((Date.now() - data.ts) >= data.ttl) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return data;
  } catch (e) { return null; }
}
