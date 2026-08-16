# Ledger — log expenses by texting WhatsApp

Text a number in a fixed format, it lands in your Supabase database, done.
This is a separate add-on to the web app — the app itself doesn't change,
it'll just show entries that showed up via WhatsApp alongside ones you add
by hand.

## How it works

WhatsApp → Meta's servers → a small serverless function on your Netlify site
→ Supabase. Nothing runs on your phone; there's no app to install. The
function only ever acts on messages from **your** WhatsApp number — anyone
else texting the bot gets silently ignored.

## Message format

```
250 food lunch with Raj      → expense: ₹250, category "Food", note "lunch with Raj"
in 5000 salary                → income: ₹5000, note "salary"
```

- First word is always the amount.
- For expenses, the second word is matched against your category names
  (case-insensitive, and "trans" will match "Transportation" — it doesn't
  need to be exact).
- Everything after that becomes the note.
- Start the message with `in` for income (no category needed).
- Get the format wrong and it'll text you back explaining what it expected,
  instead of silently failing.

## 1. Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My
   Apps → Create App**.
2. Choose **Business** as the app type.
3. Once created, on the app dashboard, find **WhatsApp** in the product list
   and click **Set up**.

## 2. Get your test number talking

Meta gives every new WhatsApp integration a free test phone number.

1. In **WhatsApp → API Setup**, you'll see a **From** number (Meta's test
   number) and a **Temporary access token**.
2. Under **To**, add your own WhatsApp number as a test recipient (you'll
   get a verification code via WhatsApp to confirm it's really your number).
3. Send yourself a test message from that page to confirm the number works
   before wiring up the webhook.

Note the following three values from this page — you'll need them shortly:
- **Phone number ID** (not the phone number itself — a numeric ID)
- **WhatsApp Business Account ID** (not needed for the function, but good to
  have handy)
- The temporary access token (you'll replace this with a permanent one in
  step 4)

## 3. Get a permanent access token

The token shown in API Setup expires in 24 hours — fine for testing, useless
for a bot that should just keep working.

1. Go to **Business Settings** (gear icon, or
   [business.facebook.com/settings](https://business.facebook.com/settings)).
2. **Users → System Users → Add** — create a system user (e.g. "ledger-bot"),
   role **Admin**.
3. **Add Assets** → assign it your WhatsApp app with **Full control**.
4. Click **Generate New Token** on that system user, select your app, tick
   the `whatsapp_business_messaging` permission, and generate. **Copy this
   token now** — Meta only shows it once.

This is your `WHATSAPP_ACCESS_TOKEN` — it doesn't expire.

## 4. Get your App Secret

**App Settings → Basic** on your Meta app dashboard → click **Show** next to
App Secret. This is `WHATSAPP_APP_SECRET` — it's what lets the function
verify a webhook call genuinely came from Meta and not an impersonator.

## 5. Find your Supabase user ID and service role key

- **Supabase dashboard → Authentication → Users** → click your (only) user →
  copy the **UID**. This is `LEDGER_USER_ID`.
- **Supabase dashboard → Project Settings → API Keys** → copy the
  **service_role** key (not anon). This is `SUPABASE_SERVICE_ROLE_KEY`.
  Treat it like a master password — it bypasses Row Level Security entirely.
  It only ever goes into Netlify's environment variables, never into any
  file that ends up in the browser.

## 6. Set environment variables in Netlify

**Site settings → Environment variables** → add each of these:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | same URL as in `supabase-config.js` |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 5 |
| `LEDGER_USER_ID` | from step 5 |
| `WHATSAPP_ACCESS_TOKEN` | from step 3 |
| `WHATSAPP_PHONE_NUMBER_ID` | from step 2 |
| `WHATSAPP_APP_SECRET` | from step 4 |
| `WHATSAPP_VERIFY_TOKEN` | make up any random string, e.g. `ledger-verify-8f3k2` |
| `ALLOWED_WHATSAPP_NUMBER` | your WhatsApp number, E.164 **without** the `+`, e.g. `919999999999` |

## 7. Deploy

Drag the whole `ledger-web` folder (now including `netlify/functions/`) onto
Netlify same as before. Your webhook URL will be:

```
https://<your-site>.netlify.app/.netlify/functions/whatsapp-webhook
```

## 8. Point Meta at your webhook

Back in **WhatsApp → Configuration** on the Meta app dashboard:

1. **Webhook → Edit** → paste your webhook URL from step 7.
2. **Verify token** → paste the same `WHATSAPP_VERIFY_TOKEN` you invented in
   step 6.
3. Click **Verify and Save** — Meta will hit your function's GET handler to
   confirm it's live.
4. Under **Webhook fields**, subscribe to **messages**.

## 9. Test it

Text the Meta test number (the one from step 2) from your phone:

```
250 food lunch with Raj
```

You should get a ✅ confirmation back within a couple seconds, and the entry
will show up in the app under the current month.

## Notes / limits

- Meta's free test number can message up to 5 verified recipient numbers —
  plenty for a personal bot. If you outgrow that, moving to a real business
  phone number is the next step, but isn't needed for solo use.
- The bot only reacts to your own number (`ALLOWED_WHATSAPP_NUMBER`) — every
  other sender is acknowledged to Meta but otherwise ignored, so the test
  number being technically "findable" isn't a real risk.
- All timestamps are logged as "now" in IST. There's no way to backdate an
  entry via WhatsApp right now — for that, still use the app.
- If a category name doesn't match anything, the bot texts back your full
  category list instead of guessing wrong.
