// =============================================================================
// LEDGER — email → transaction logger (Google Apps Script)
//
// Runs entirely inside your own Gmail account. A time-driven trigger checks
// for new matching emails every minute, parses them, inserts a transaction
// into Supabase, replies with a confirmation, and archives the email so your
// inbox stays clean.
//
// SETUP: see README-email.md for the full walkthrough. In short:
//   1. Paste this into a new project at script.google.com
//   2. Project Settings (gear icon) → Script Properties → add the 5 keys
//      listed below
//   3. Run `setup` once (authorizes Gmail access + creates the trigger)
//
// MESSAGE FORMAT (put this in the EMAIL BODY, subject line doesn't matter
// as long as it contains the word "ledger" somewhere):
//   <secret> 250 food lunch with Raj      → expense
//   <secret> in 5000 salary                → income
//
// <secret> is LEDGER_SECRET_CODE below — a password only you know, so even
// if someone spoofs your email address, they can't inject fake entries
// without also knowing the code.
// =============================================================================

const PROPS = PropertiesService.getScriptProperties();
const SUPABASE_URL = PROPS.getProperty('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = PROPS.getProperty('SUPABASE_SERVICE_ROLE_KEY');
const LEDGER_USER_ID = PROPS.getProperty('LEDGER_USER_ID');
const LEDGER_SECRET_CODE = PROPS.getProperty('LEDGER_SECRET_CODE');
const ALLOWED_EMAIL = PROPS.getProperty('ALLOWED_EMAIL'); // your own address, lowercase

const IST_OFFSET_MIN = 330; // fixed UTC+5:30, matches the web app's assumption
const PROCESSED_LABEL = 'Ledger/Processed';
const FAILED_LABEL = 'Ledger/Failed';

// -----------------------------------------------------------------------------
// One-time setup: run this once from the Apps Script editor (select `setup`
// in the function dropdown, click Run). It authorizes Gmail access and
// installs the recurring trigger.
// -----------------------------------------------------------------------------
function setup() {
  // Clear any existing triggers for this function so re-running setup is safe.
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'processLedgerEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processLedgerEmails').timeBased().everyMinutes(1).create();
  getOrCreateLabel(PROCESSED_LABEL);
  getOrCreateLabel(FAILED_LABEL);
  Logger.log('Setup complete — checking Gmail every minute from now on.');
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function nowAsLocalNaiveString() {
  const now = new Date();
  const shifted = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
  return shifted.toISOString().slice(0, 16);
}

function fmtRupees(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function supabaseFetch(path, options) {
  options = options || {};
  const res = UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || 'get',
    headers: Object.assign(
      {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      options.headers || {}
    ),
    contentType: 'application/json',
    payload: options.payload,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error(`Supabase ${code}: ${res.getContentText()}`);
  }
  const text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

// Parses "<secret> 250 food lunch with Raj" or "<secret> in 5000 salary"
function parseMessage(body) {
  const trimmed = body.trim().replace(/\s+/g, ' ');
  const parts = trimmed.split(' ');
  if (parts[0] !== LEDGER_SECRET_CODE) return { error: 'bad_secret' };

  let rest = parts.slice(1).join(' ');
  const lower = rest.toLowerCase();
  let type = 'expense';
  if (lower.startsWith('in ')) {
    type = 'income';
    rest = rest.slice(3).trim();
  } else if (lower.startsWith('income ')) {
    type = 'income';
    rest = rest.slice(7).trim();
  }

  if (type === 'income') {
    const m = rest.match(/^([\d,]+(?:\.\d+)?)\s*(.*)$/);
    if (!m) return { error: 'format' };
    return { type, amount: parseFloat(m[1].replace(/,/g, '')), categoryToken: null, note: m[2].trim() };
  }

  const m = rest.match(/^([\d,]+(?:\.\d+)?)\s+(\S+)\s*(.*)$/);
  if (!m) return { error: 'format' };
  return {
    type,
    amount: parseFloat(m[1].replace(/,/g, '')),
    categoryToken: m[2],
    note: m[3].trim(),
  };
}

// -----------------------------------------------------------------------------
// Main entry point — called by the time-driven trigger every minute.
// -----------------------------------------------------------------------------
function processLedgerEmails() {
  const threads = GmailApp.search('is:unread subject:ledger', 0, 20);
  const processedLabel = getOrCreateLabel(PROCESSED_LABEL);
  const failedLabel = getOrCreateLabel(FAILED_LABEL);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      if (!message.isUnread()) return;

      const fromEmail = extractEmail(message.getFrom());
      if (ALLOWED_EMAIL && fromEmail.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
        message.markRead(); // ignore silently, don't reply to strangers
        return;
      }

      try {
        handleMessage(message);
        message.markRead();
        thread.addLabel(processedLabel);
        thread.moveToArchive();
      } catch (err) {
        Logger.log(`Failed to process message: ${err}`);
        message.markRead();
        thread.addLabel(failedLabel);
        GmailApp.sendEmail(fromEmail, 'Ledger: could not log that', String(err));
      }
    });
  });
}

function extractEmail(fromHeader) {
  const m = fromHeader.match(/<(.+)>/);
  return m ? m[1] : fromHeader;
}

function handleMessage(message) {
  const body = message.getPlainBody();
  const fromEmail = extractEmail(message.getFrom());
  const parsed = parseMessage(body);

  if (parsed.error === 'bad_secret') {
    // Wrong or missing secret code — don't confirm anything, just note it
    // in the logs. No reply, so a stray "ledger"-subject email from someone
    // else (or a mailing list) doesn't get a response either.
    Logger.log('Secret code mismatch, ignoring.');
    return;
  }
  if (parsed.error === 'format') {
    GmailApp.sendEmail(
      fromEmail,
      'Ledger: format not recognized',
      'Expected:\n"<secret> 250 food lunch with Raj" for an expense\n"<secret> in 5000 salary" for income'
    );
    return;
  }
  if (isNaN(parsed.amount) || parsed.amount <= 0) {
    GmailApp.sendEmail(fromEmail, 'Ledger: invalid amount', 'Could not read an amount from that message.');
    return;
  }

  let categoryId = null;
  if (parsed.type === 'expense') {
    const categories = supabaseFetch(`categories?user_id=eq.${LEDGER_USER_ID}&select=id,name`);
    const token = parsed.categoryToken.toLowerCase();
    const match =
      categories.find((c) => c.name.toLowerCase() === token) ||
      categories.find((c) => c.name.toLowerCase().indexOf(token) === 0) ||
      categories.find((c) => c.name.toLowerCase().indexOf(token) !== -1);

    if (!match) {
      const names = categories.map((c) => c.name).join(', ');
      GmailApp.sendEmail(
        fromEmail,
        'Ledger: category not found',
        `No category matching "${parsed.categoryToken}". You have: ${names}`
      );
      return;
    }
    categoryId = match.id;
  }

  supabaseFetch('transactions', {
    method: 'post',
    headers: { Prefer: 'return=minimal' },
    payload: JSON.stringify({
      user_id: LEDGER_USER_ID,
      type: parsed.type,
      amount: parsed.amount,
      category_id: categoryId,
      note: parsed.note || null,
      occurred_at: nowAsLocalNaiveString(),
    }),
  });

  let totalLine = '';
  try {
    const summary = supabaseFetch('rpc/get_summary', {
      method: 'post',
      payload: JSON.stringify({ p_month: null }),
    });
    totalLine =
      parsed.type === 'expense'
        ? `\nSpent this month: ${fmtRupees(summary.total_expense)}`
        : `\nIncome this month: ${fmtRupees(summary.total_income)}`;
  } catch (e) {
    /* skip the total if this call fails */
  }

  GmailApp.sendEmail(
    fromEmail,
    '✅ Ledger updated',
    `Added ${fmtRupees(parsed.amount)} ${
      parsed.type === 'income' ? 'income' : `to ${parsed.categoryToken}`
    }${totalLine}`
  );
}
