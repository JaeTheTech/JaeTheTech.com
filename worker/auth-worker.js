/* =====================================================
   JaeTheTech Auth Worker (Cloudflare Email Routing)
   Sends login codes via Cloudflare send_email binding.
   No third-party email APIs needed.
   ===================================================== */

import { EmailMessage } from "cloudflare:email";

export default {
  async fetch(request, env) {
    const ALLOWED_ORIGINS = [
      'https://jaethetech.com',
      'https://www.jaethetech.com',
      'https://jaethetech-site.pages.dev',
      'http://127.0.0.1:8080',
      'http://localhost:8080'
    ];

    const origin = request.headers.get('Origin') || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/auth/send-code') {
        return await handleSendCode(request, env, corsHeaders);
      }
      if (url.pathname === '/api/auth/verify-code') {
        return await handleVerifyCode(request, env, corsHeaders);
      }
      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
    }
  }
};

/* -- Send Code Handler ---------------------------------- */
async function handleSendCode(request, env, corsHeaders) {
  const body = await request.json();
  const email = (body.email || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return jsonResponse({ error: 'Invalid email address' }, 400, corsHeaders);
  }

  // Admin-only
  const ALLOWED_EMAILS = (env.ADMIN_EMAILS || 'imjaethetech@gmail.com').split(',').map(e => e.trim().toLowerCase());
  if (!ALLOWED_EMAILS.includes(email)) {
    return jsonResponse({ error: 'Unauthorised email address.' }, 403, corsHeaders);
  }

  // Rate limit: max 10 codes per email per 15 minutes
  const rateLimitKey = `rate:${email}`;
  const rateCount = parseInt(await env.AUTH_KV.get(rateLimitKey) || '0');
  if (rateCount >= 10) {
    return jsonResponse({ error: 'Too many requests. Try again in 15 minutes.' }, 429, corsHeaders);
  }

  // Generate 6-digit code
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');

  // Store code in KV (5-minute TTL)
  await env.AUTH_KV.put(`code:${email}`, JSON.stringify({
    code: code,
    attempts: 0,
    created: Date.now()
  }), { expirationTtl: 300 });

  // Update rate limit
  await env.AUTH_KV.put(rateLimitKey, String(rateCount + 1), { expirationTtl: 900 });

  // Send email via Cloudflare Email Routing
  const sent = await sendEmail(env, email, code);
  if (!sent) {
    return jsonResponse({ error: 'Failed to send email. Try again.' }, 500, corsHeaders);
  }

  return jsonResponse({ ok: true, message: 'Code sent' }, 200, corsHeaders);
}

/* -- Verify Code Handler --------------------------------- */
async function handleVerifyCode(request, env, corsHeaders) {
  const body = await request.json();
  const email = (body.email || '').trim().toLowerCase();
  const enteredCode = (body.code || '').trim();

  if (!email || !enteredCode) {
    return jsonResponse({ error: 'Email and code required' }, 400, corsHeaders);
  }

  const kvKey = `code:${email}`;
  const raw = await env.AUTH_KV.get(kvKey);

  if (!raw) {
    return jsonResponse({ error: 'Code expired or not found. Request a new one.' }, 401, corsHeaders);
  }

  const data = JSON.parse(raw);

  if (data.attempts >= 5) {
    await env.AUTH_KV.delete(kvKey);
    return jsonResponse({ error: 'Too many attempts. Request a new code.' }, 401, corsHeaders);
  }

  if (enteredCode !== data.code) {
    data.attempts++;
    const remainingTtl = Math.max(1, 300 - Math.floor((Date.now() - data.created) / 1000));
    await env.AUTH_KV.put(kvKey, JSON.stringify(data), { expirationTtl: remainingTtl });
    const left = 5 - data.attempts;
    return jsonResponse({
      error: `Wrong code. ${left} attempt${left !== 1 ? 's' : ''} left.`,
      attemptsLeft: left
    }, 401, corsHeaders);
  }

  // Correct -- clean up and return session token
  await env.AUTH_KV.delete(kvKey);

  const tokenArr = new Uint8Array(32);
  crypto.getRandomValues(tokenArr);
  const token = Array.from(tokenArr).map(b => b.toString(16).padStart(2, '0')).join('');

  await env.AUTH_KV.put(`session:${token}`, JSON.stringify({
    email: email,
    created: Date.now()
  }), { expirationTtl: 14400 }); // 4 hours

  return jsonResponse({ ok: true, token: token, email: email }, 200, corsHeaders);
}

/* -- Send Email via Cloudflare Email Routing ------------- */
async function sendEmail(env, toEmail, code) {
  const fromAddr = 'codes@jaethetech.com';

  const htmlBody = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;color:#e8e8e8;background:#1a1a1a;border-radius:10px;">',
    '<h2 style="color:#f0f0f0;margin:0 0 8px;">JaeTheTech</h2>',
    '<p style="color:#999;margin:0 0 24px;font-size:14px;">Login verification code</p>',
    '<div style="background:#0e0e0e;border:1px solid #2a2a2a;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">',
    '<span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#f0f0f0;font-family:SF Mono,Cascadia Code,Consolas,monospace;">' + code + '</span>',
    '</div>',
    '<p style="color:#666;font-size:13px;margin:0;">This code expires in <strong style="color:#b0b0b0;">5 minutes</strong>.</p>',
    '<p style="color:#666;font-size:13px;margin:8px 0 0;">If you did not request this, ignore this email.</p>',
    '</div>'
  ].join('');

  const msgId = crypto.randomUUID();
  const raw = [
    'From: JaeTheTech <' + fromAddr + '>',
    'To: ' + toEmail,
    'Subject: Your JaeTheTech login code: ' + code,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + msgId + '@jaethetech.com>',
    '',
    htmlBody
  ].join('\r\n');

  try {
    const msg = new EmailMessage(fromAddr, toEmail, raw);
    await env.SEND_EMAIL.send(msg);
    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
}

/* -- JSON Response Helper -------------------------------- */
function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}