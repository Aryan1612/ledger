// =============================================================================
// LEDGER — WhatsApp → transaction webhook
//
// Receives messages from Meta's WhatsApp Cloud API and inserts them straight
// into Supabase, so logging an expense is just texting a number.
//
// No npm dependencies on purpose — Node's built-in fetch + crypto are enough,
// which means this deploys correctly even via Netlify's manual drag-and-drop
// (no "npm install" step required).
//
// MESSAGE FORMAT
//   Expense (default):  <amount> <category> [note...]
//     e.g. "250 food lunch with Raj"
//   Income:              in <amount> [note...]
//     e.g. "in 5000 salary"
//
// Category matching is case-insensitive and matches on the start of the
// category name (so "trans" matches "Transportation").
//
// REQUIRED ENVIRONMENT VARIABLES (set in Netlify: Site settings → Environment
// variables — never commit these to the repo):
//   SUPABASE_URL                 — same as supabase-config.js
//   SUPABASE_SERVICE_ROLE_KEY    — Project Settings → API Keys → service_role
//                                   (NOT the anon key — this one bypasses RLS,
//                                   so keep it server-side only, never in the
//                                   frontend)
//   LEDGER_USER_ID               — your Supabase auth user UUID (Authentication
//                                   → Users → click your user → copy UID)
//   WHATSAPP_VERIFY_TOKEN        — any random string you invent yourself; used
//                                   once during the Meta webhook setup handshake
//   WHATSAPP_ACCESS_TOKEN        — permanent token from your Meta System User
//   WHATSAPP_PHONE_NUMBER_ID     — from Meta App → WhatsApp → API Setup
//   WHATSAPP_APP_SECRET          — Meta App → App Settings → Basic → App Secret
//   ALLOWED_WHATSAPP_NUMBER      — YOUR WhatsApp number in E.164 without the
//                                   "+", e.g. 919999999999. Messages from any
//                                   other number are silently ignored — this
//                                   is what stops a stranger from texting the
//                                   number and injecting fake transactions.
// =============================================================================

const crypto = require('crypto');

const IST_OFFSET_MIN = 330; // fixed UTC+5:30, matches the frontend's assumption

function nowAsLocalNaiveString() {
  // Mirrors setDefaultDatetime() in app.js: shift "now" by the IST offset,
  // then read it as if it were UTC, so we get "YYYY-MM-DDTHH:MM" in IST
  // without a timezone suffix — the same shape occurred_at already uses.
  const now = new Date();
  const shifted = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
  return shifted.toISOString().slice(0, 16);
}

async function supabaseFetch(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function sendWhatsAppReply(toNumber, body) {
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'text',
      text: { body },
    }),
  }).catch(() => {}); // a failed reply shouldn't crash the webhook / cause retries
}

function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Parses "250 food lunch with Raj" or "in 5000 salary"
function parseMessage(text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  let type = 'expense';
  let rest = trimmed;
  if (lower.startsWith('in ')) {
    type = 'income';
    rest = trimmed.slice(3).trim();
  } else if (lower.startsWith('income ')) {
    type = 'income';
    rest = trimmed.slice(7).trim();
  }

  if (type === 'income') {
    const m = rest.match(/^([\d,]+(?:\.\d+)?)\s*(.*)$/);
    if (!m) return null;
    return { type, amount: parseFloat(m[1].replace(/,/g, '')), categoryToken: null, note: m[2].trim() };
  }

  const m = rest.match(/^([\d,]+(?:\.\d+)?)\s+(\S+)\s*(.*)$/);
  if (!m) return null;
  return {
    type,
    amount: parseFloat(m[1].replace(/,/g, '')),
    categoryToken: m[2],
    note: m[3].trim(),
  };
}

function fmtRupees(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

exports.handler = async (event) => {
  // ---- Step 1: Meta's one-time webhook verification handshake (GET) ----
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    if (
      params['hub.mode'] === 'subscribe' &&
      params['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return { statusCode: 200, body: params['hub.challenge'] || '' };
    }
    return { statusCode: 403, body: 'Verification failed' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // ---- Step 2: verify this really came from Meta ----
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
  if (!verifySignature(rawBody, signature)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  try {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    // Delivery/read receipts and non-text messages land here too — just ack them.
    if (!message || message.type !== 'text') {
      return { statusCode: 200, body: 'ok' };
    }

    const fromNumber = message.from; // E.164 without "+"
    const text = message.text?.body || '';

    // ---- Step 3: only ever act on messages from you ----
    if (fromNumber !== process.env.ALLOWED_WHATSAPP_NUMBER) {
      return { statusCode: 200, body: 'ignored' }; // ack to Meta, do nothing else
    }

    const parsed = parseMessage(text);
    if (!parsed || isNaN(parsed.amount) || parsed.amount <= 0) {
      await sendWhatsAppReply(
        fromNumber,
        '⚠️ Didn\'t recognize that. Format:\n' +
          '"250 food lunch with Raj" for an expense\n' +
          '"in 5000 salary" for income'
      );
      return { statusCode: 200, body: 'ok' };
    }

    let categoryId = null;
    if (parsed.type === 'expense') {
      const categories = await supabaseFetch(
        `categories?user_id=eq.${process.env.LEDGER_USER_ID}&select=id,name`
      );
      const token = parsed.categoryToken.toLowerCase();
      const match =
        categories.find((c) => c.name.toLowerCase() === token) ||
        categories.find((c) => c.name.toLowerCase().startsWith(token)) ||
        categories.find((c) => c.name.toLowerCase().includes(token));

      if (!match) {
        const names = categories.map((c) => c.name).join(', ');
        await sendWhatsAppReply(
          fromNumber,
          `⚠️ No category matching "${parsed.categoryToken}". You have: ${names}`
        );
        return { statusCode: 200, body: 'ok' };
      }
      categoryId = match.id;
    }

    await supabaseFetch('transactions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: process.env.LEDGER_USER_ID,
        type: parsed.type,
        amount: parsed.amount,
        category_id: categoryId,
        note: parsed.note || null,
        occurred_at: nowAsLocalNaiveString(),
      }),
    });

    // Best-effort running total for the confirmation message — not fatal if it fails.
    let totalLine = '';
    try {
      const summary = await supabaseFetch('rpc/get_summary', {
        method: 'POST',
        body: JSON.stringify({ p_month: null }),
      });
      if (parsed.type === 'expense') {
        totalLine = `\nSpent this month: ${fmtRupees(summary.total_expense)}`;
      } else {
        totalLine = `\nIncome this month: ${fmtRupees(summary.total_income)}`;
      }
    } catch {
      /* skip the total if this call fails */
    }

    await sendWhatsAppReply(
      fromNumber,
      `✅ Added ${fmtRupees(parsed.amount)} ${
        parsed.type === 'income' ? 'income' : `to ${parsed.categoryToken}`
      }${totalLine}`
    );

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error(err);
    // Still 200 so Meta doesn't hammer retries; the error is in the logs.
    return { statusCode: 200, body: 'error logged' };
  }
};
