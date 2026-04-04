/* =====================================================
   JaeTheTech Auth Worker v2 (Cloudflare Email Routing)
   
   Two-tier auth:
   ├─ Website: 6-digit numeric codes via email (disposable)
   └─ Apps:    JTT-prefixed alphanumeric codes (more secure)
   
   Roles: admin, staff, user
   No passwords. No code tracking. Everything self-destructs.
   ===================================================== */

import { EmailMessage } from "cloudflare:email";

/* ── Constants ───────────────────────────────────────── */
const CODE_TTL      = 300;     // 5 minutes
const APP_CODE_TTL  = 120;     // 2 minutes (apps = tighter)
const SESSION_TTL   = 14400;   // 4 hours
const RATE_LIMIT    = 10;
const RATE_WINDOW   = 900;     // 15 minutes
const MAX_ATTEMPTS  = 5;

const ADMIN_EMAIL = 'imjaethetech@gmail.com';

const ALLOWED_ORIGINS = [
  'https://jaethetech.com',
  'https://www.jaethetech.com',
  'https://jaethetech-site.pages.dev',
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://localhost:3000',
  'tauri://localhost'
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      /* ── Auth routes (POST) ─────────────────────────── */
      if (request.method === 'POST') {
        switch (url.pathname) {
          case '/api/auth/send-code':
            return await handleSendCode(request, env, corsHeaders);
          case '/api/auth/verify-code':
            return await handleVerifyCode(request, env, corsHeaders);
          case '/api/auth/signup':
            return await handleSignup(request, env, corsHeaders);
          case '/api/auth/app-code':
            return await handleAppCode(request, env, corsHeaders);
          case '/api/auth/verify-app-code':
            return await handleVerifyAppCode(request, env, corsHeaders);

          /* ── Staff management (admin only) ──────────── */
          case '/api/staff/add':
            return await handleStaffAdd(request, env, corsHeaders);
          case '/api/staff/remove':
            return await handleStaffRemove(request, env, corsHeaders);
          case '/api/staff/list':
            return await handleStaffList(request, env, corsHeaders);

          /* ── User management ────────────────────────── */
          case '/api/user/role':
            return await handleGetRole(request, env, corsHeaders);
        }
      }

      /* ── GET routes ─────────────────────────────────── */
      if (request.method === 'GET') {
        if (url.pathname === '/api/auth/session') {
          return await handleSessionCheck(request, env, corsHeaders);
        }
      }

      return json({ error: 'Not found' }, 404, corsHeaders);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: 'Internal server error' }, 500, corsHeaders);
    }
  }
};

/* ═════════════════════════════════════════════════════════
   AUTH: Website Login (email codes)
   ═════════════════════════════════════════════════════════ */

async function handleSendCode(request, env, cors) {
  const body = await request.json();
  const email = clean(body.email);

  if (!validEmail(email)) {
    return json({ error: 'Invalid email address' }, 400, cors);
  }

  // Check user exists (admin always allowed)
  const role = await getRole(env, email);
  if (!role) {
    return json({ error: 'No account found. Sign up first.' }, 403, cors);
  }

  // Rate limit
  const rl = await rateCheck(env, email);
  if (!rl.ok) return json({ error: rl.msg }, 429, cors);

  // Generate 6-digit code
  const code = randomDigits(6);

  // Store — self-destructs via TTL, never persisted
  await env.AUTH_KV.put(`code:${email}`, JSON.stringify({
    code, attempts: 0, created: Date.now()
  }), { expirationTtl: CODE_TTL });

  await bumpRate(env, email);

  // Send via Cloudflare Email
  const sent = await sendCodeEmail(env, email, code);
  if (!sent) return json({ error: 'Failed to send email. Try again.' }, 500, cors);

  return json({ ok: true, message: 'Code sent' }, 200, cors);
}

async function handleVerifyCode(request, env, cors) {
  const body = await request.json();
  const email = clean(body.email);
  const entered = (body.code || '').trim();

  if (!email || !entered) {
    return json({ error: 'Email and code required' }, 400, cors);
  }

  const kvKey = `code:${email}`;
  const raw = await env.AUTH_KV.get(kvKey);

  if (!raw) {
    return json({ error: 'Code expired or not found. Request a new one.' }, 401, cors);
  }

  const data = JSON.parse(raw);

  if (data.attempts >= MAX_ATTEMPTS) {
    await env.AUTH_KV.delete(kvKey);
    return json({ error: 'Too many attempts. Request a new code.' }, 401, cors);
  }

  if (entered !== data.code) {
    data.attempts++;
    const ttl = Math.max(1, CODE_TTL - Math.floor((Date.now() - data.created) / 1000));
    await env.AUTH_KV.put(kvKey, JSON.stringify(data), { expirationTtl: ttl });
    const left = MAX_ATTEMPTS - data.attempts;
    return json({ error: `Wrong code. ${left} attempt${left !== 1 ? 's' : ''} left.`, attemptsLeft: left }, 401, cors);
  }

  // Code correct — self-destruct immediately
  await env.AUTH_KV.delete(kvKey);

  const role = await getRole(env, email);
  const token = await createSession(env, email, role);

  return json({ ok: true, token, email, role }, 200, cors);
}

/* ═════════════════════════════════════════════════════════
   AUTH: Signup (no passwords, just register email)
   ═════════════════════════════════════════════════════════ */

async function handleSignup(request, env, cors) {
  const body = await request.json();
  const email = clean(body.email);

  if (!validEmail(email)) {
    return json({ error: 'Invalid email address' }, 400, cors);
  }

  // Already exists?
  const existing = await getRole(env, email);
  if (existing) {
    return json({ error: 'Account already exists. Go to login.' }, 409, cors);
  }

  // Rate limit
  const rl = await rateCheck(env, email);
  if (!rl.ok) return json({ error: rl.msg }, 429, cors);

  // Create user record (role: user)
  await env.AUTH_KV.put(`user:${email}`, JSON.stringify({
    role: 'user',
    created: Date.now()
  }));

  // Send verification code
  const code = randomDigits(6);
  await env.AUTH_KV.put(`code:${email}`, JSON.stringify({
    code, attempts: 0, created: Date.now(), signup: true
  }), { expirationTtl: CODE_TTL });

  await bumpRate(env, email);

  const sent = await sendCodeEmail(env, email, code, true);
  if (!sent) return json({ error: 'Failed to send email. Try again.' }, 500, cors);

  return json({ ok: true, message: 'Verification code sent' }, 200, cors);
}

/* ═════════════════════════════════════════════════════════
   AUTH: App Codes (JTT-prefixed, more secure)
   - Alphanumeric, starts with JTT
   - 2 min TTL, single-use, self-destructs
   ═════════════════════════════════════════════════════════ */

async function handleAppCode(request, env, cors) {
  const session = await authRequired(request, env);
  if (!session) return json({ error: 'Not authenticated' }, 401, cors);

  const email = session.email;

  // Rate limit
  const rl = await rateCheck(env, `app:${email}`);
  if (!rl.ok) return json({ error: rl.msg }, 429, cors);

  // Generate JTT code: JTT + 12 alphanumeric chars
  const code = 'JTT' + randomAlphanumeric(12);

  // Store with short TTL — self-destructs fast
  await env.AUTH_KV.put(`appcode:${email}`, JSON.stringify({
    code,
    created: Date.now(),
    used: false
  }), { expirationTtl: APP_CODE_TTL });

  await bumpRate(env, `app:${email}`);

  // Send via email too
  await sendAppCodeEmail(env, email, code);

  return json({ ok: true, message: 'App code generated', expiresIn: APP_CODE_TTL }, 200, cors);
}

async function handleVerifyAppCode(request, env, cors) {
  const body = await request.json();
  const email = clean(body.email);
  const entered = (body.code || '').trim().toUpperCase();

  if (!email || !entered) {
    return json({ error: 'Email and code required' }, 400, cors);
  }

  if (!entered.startsWith('JTT') || entered.length !== 15) {
    return json({ error: 'Invalid app code format' }, 400, cors);
  }

  const kvKey = `appcode:${email}`;
  const raw = await env.AUTH_KV.get(kvKey);

  if (!raw) {
    return json({ error: 'App code expired or not found. Request a new one.' }, 401, cors);
  }

  const data = JSON.parse(raw);

  if (data.used) {
    await env.AUTH_KV.delete(kvKey);
    return json({ error: 'Code already used. Request a new one.' }, 401, cors);
  }

  // Single attempt — app codes don't get retries
  if (entered !== data.code) {
    await env.AUTH_KV.delete(kvKey);
    return json({ error: 'Invalid code. Request a new one.' }, 401, cors);
  }

  // Self-destruct immediately
  await env.AUTH_KV.delete(kvKey);

  const role = await getRole(env, email);
  const token = await createSession(env, email, role, 'app');

  return json({ ok: true, token, email, role, source: 'app' }, 200, cors);
}

/* ═════════════════════════════════════════════════════════
   STAFF MANAGEMENT (admin only)
   ═════════════════════════════════════════════════════════ */

async function handleStaffAdd(request, env, cors) {
  const session = await authRequired(request, env);
  if (!session || session.role !== 'admin') {
    return json({ error: 'Admin access required' }, 403, cors);
  }

  const body = await request.json();
  const email = clean(body.email);
  if (!validEmail(email)) return json({ error: 'Invalid email' }, 400, cors);

  await env.AUTH_KV.put(`user:${email}`, JSON.stringify({
    role: 'staff',
    created: Date.now(),
    addedBy: session.email
  }));

  return json({ ok: true, message: `${email} is now staff` }, 200, cors);
}

async function handleStaffRemove(request, env, cors) {
  const session = await authRequired(request, env);
  if (!session || session.role !== 'admin') {
    return json({ error: 'Admin access required' }, 403, cors);
  }

  const body = await request.json();
  const email = clean(body.email);
  if (!validEmail(email)) return json({ error: 'Invalid email' }, 400, cors);

  if (email === ADMIN_EMAIL) {
    return json({ error: 'Cannot remove admin' }, 400, cors);
  }

  // Downgrade to user instead of deleting
  const existing = await env.AUTH_KV.get(`user:${email}`);
  if (existing) {
    const data = JSON.parse(existing);
    data.role = 'user';
    await env.AUTH_KV.put(`user:${email}`, JSON.stringify(data));
  }

  return json({ ok: true, message: `${email} removed from staff` }, 200, cors);
}

async function handleStaffList(request, env, cors) {
  const session = await authRequired(request, env);
  if (!session || session.role !== 'admin') {
    return json({ error: 'Admin access required' }, 403, cors);
  }

  // KV list with prefix
  const list = await env.AUTH_KV.list({ prefix: 'user:' });
  const staff = [];

  for (const key of list.keys) {
    const raw = await env.AUTH_KV.get(key.name);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.role === 'staff' || data.role === 'admin') {
        staff.push({
          email: key.name.replace('user:', ''),
          role: data.role,
          created: data.created
        });
      }
    }
  }

  return json({ ok: true, staff }, 200, cors);
}

/* ═════════════════════════════════════════════════════════
   USER ROLE CHECK + SESSION CHECK
   ═════════════════════════════════════════════════════════ */

async function handleGetRole(request, env, cors) {
  const session = await authRequired(request, env);
  if (!session) return json({ error: 'Not authenticated' }, 401, cors);

  return json({ ok: true, email: session.email, role: session.role }, 200, cors);
}

async function handleSessionCheck(request, env, cors) {
  const session = await authRequired(request, env);
  if (!session) return json({ valid: false }, 200, cors);
  return json({ valid: true, email: session.email, role: session.role }, 200, cors);
}

/* ═════════════════════════════════════════════════════════
   HELPERS
   ═════════════════════════════════════════════════════════ */

function clean(str) {
  return (str || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function randomDigits(len) {
  const arr = crypto.getRandomValues(new Uint32Array(1));
  return String(arr[0] % Math.pow(10, len)).padStart(len, '0');
}

function randomAlphanumeric(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 for clarity
  const arr = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

async function getRole(env, email) {
  if (email === ADMIN_EMAIL) return 'admin';
  const raw = await env.AUTH_KV.get(`user:${email}`);
  if (!raw) return null;
  return JSON.parse(raw).role || 'user';
}

async function rateCheck(env, key) {
  const rlKey = `rate:${key}`;
  const count = parseInt(await env.AUTH_KV.get(rlKey) || '0');
  if (count >= RATE_LIMIT) {
    return { ok: false, msg: 'Too many requests. Try again in 15 minutes.' };
  }
  return { ok: true };
}

async function bumpRate(env, key) {
  const rlKey = `rate:${key}`;
  const count = parseInt(await env.AUTH_KV.get(rlKey) || '0');
  await env.AUTH_KV.put(rlKey, String(count + 1), { expirationTtl: RATE_WINDOW });
}

async function createSession(env, email, role, source) {
  const tokenArr = new Uint8Array(32);
  crypto.getRandomValues(tokenArr);
  const token = Array.from(tokenArr).map(b => b.toString(16).padStart(2, '0')).join('');

  await env.AUTH_KV.put(`session:${token}`, JSON.stringify({
    email, role: role || 'user', source: source || 'web', created: Date.now()
  }), { expirationTtl: SESSION_TTL });

  return token;
}

async function authRequired(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  let token = '';

  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    try {
      const clone = request.clone();
      const body = await clone.json();
      token = body.token || '';
    } catch (e) {
      token = '';
    }
  }

  if (!token) return null;

  const raw = await env.AUTH_KV.get(`session:${token}`);
  if (!raw) return null;

  return JSON.parse(raw);
}

/* ═════════════════════════════════════════════════════════
   EMAIL: Website Login Code
   ═════════════════════════════════════════════════════════ */

async function sendCodeEmail(env, toEmail, code, isSignup) {
  const fromAddr = 'codes@jaethetech.com';
  const subject = isSignup
    ? `Welcome to JaeTheTech — your code: ${code}`
    : `Your JaeTheTech login code: ${code}`;

  const heading = isSignup ? 'Welcome to JaeTheTech' : 'Login Verification';
  const subtext = isSignup
    ? 'Verify your email to complete signup'
    : 'Login verification code';

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;color:#e8e8e8;background:#1a1a1a;border-radius:10px;">',
    '<h2 style="color:#f0f0f0;margin:0 0 8px;">' + heading + '</h2>',
    '<p style="color:#999;margin:0 0 24px;font-size:14px;">' + subtext + '</p>',
    '<div style="background:#0e0e0e;border:1px solid #2a2a2a;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">',
    '<span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#f0f0f0;font-family:SF Mono,Cascadia Code,Consolas,monospace;">' + code + '</span>',
    '</div>',
    '<p style="color:#666;font-size:13px;margin:0;">This code expires in <strong style="color:#b0b0b0;">5 minutes</strong> and self-destructs after use.</p>',
    '<p style="color:#666;font-size:13px;margin:8px 0 0;">If you did not request this, ignore this email.</p>',
    '<hr style="border:none;border-top:1px solid #2a2a2a;margin:24px 0;">',
    '<p style="color:#444;font-size:11px;margin:0;">We never store passwords or codes. Everything is disposable.</p>',
    '</div>'
  ].join('');

  return await sendRawEmail(env, fromAddr, toEmail, subject, html);
}

/* ═════════════════════════════════════════════════════════
   EMAIL: App Code (JTT-prefixed)
   ═════════════════════════════════════════════════════════ */

async function sendAppCodeEmail(env, toEmail, code) {
  const fromAddr = 'codes@jaethetech.com';
  const subject = 'Your JaeTheTech app code';

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;color:#e8e8e8;background:#1a1a1a;border-radius:10px;">',
    '<h2 style="color:#f0f0f0;margin:0 0 8px;">App Authentication</h2>',
    '<p style="color:#999;margin:0 0 6px;font-size:14px;">Secure app code — single use only</p>',
    '<p style="color:#d9534f;margin:0 0 24px;font-size:12px;font-weight:600;">⚠ This code expires in 2 minutes</p>',
    '<div style="background:#0e0e0e;border:1px solid #2a2a2a;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">',
    '<span style="font-size:24px;font-weight:800;letter-spacing:4px;color:#f0f0f0;font-family:SF Mono,Cascadia Code,Consolas,monospace;">' + code + '</span>',
    '</div>',
    '<p style="color:#666;font-size:13px;margin:0;">This code <strong style="color:#b0b0b0;">self-destructs</strong> immediately after use. No retries.</p>',
    '<p style="color:#666;font-size:13px;margin:8px 0 0;">If you didn\'t request this, someone has your session. Log out immediately.</p>',
    '</div>'
  ].join('');

  return await sendRawEmail(env, fromAddr, toEmail, subject, html);
}

/* ═════════════════════════════════════════════════════════
   EMAIL: Raw send via Cloudflare Email Routing
   ═════════════════════════════════════════════════════════ */

async function sendRawEmail(env, from, to, subject, html) {
  const msgId = crypto.randomUUID();
  const raw = [
    'From: JaeTheTech <' + from + '>',
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + msgId + '@jaethetech.com>',
    '',
    html
  ].join('\r\n');

  try {
    const msg = new EmailMessage(from, to, raw);
    await env.SEND_EMAIL.send(msg);
    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
}

/* ── JSON Response Helper ──────────────────────────────── */
function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}