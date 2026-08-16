# Ledger — log expenses by email

Simpler alternative to the WhatsApp route: no Meta Business account, no app
review, no third-party service. It runs entirely inside your own Gmail
account using Google Apps Script (free, built into every Google account).

## How it works

You send an email to **yourself** with a fixed format in the body. A script
checks your Gmail every minute, and if it finds a new matching email, parses
it, inserts the transaction into Supabase, replies with a confirmation, and
archives the original so your inbox stays clean.

## Message format

Put this in the **email body** (subject just needs to contain the word
"ledger" somewhere — subject text itself doesn't matter beyond that):

```
LEDGER8f3k2 250 food lunch with Raj      → expense: ₹250, category "Food"
LEDGER8f3k2 in 5000 salary                → income: ₹5000
```

`LEDGER8f3k2` is a secret code you invent yourself (step 3 below) — it's
what stops a spoofed or misdirected email from creating fake entries, since
whoever sends it needs to know the code, not just your email address.

## 1. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Delete the placeholder code, paste in the contents of `apps-script/Code.gs`.
3. Rename the project (top left) to something like "Ledger Email Logger".

## 2. Find your Supabase user ID and service role key

(Same as the WhatsApp setup, if you already did that — skip to step 3.)

- **Supabase dashboard → Authentication → Users** → click your user → copy
  the **UID**.
- **Supabase dashboard → Project Settings → API Keys** → copy the
  **service_role** key (not anon). This bypasses Row Level Security — it
  only goes into Apps Script's private storage in the next step, never into
  any file that reaches a browser.

## 3. Set Script Properties

In the Apps Script editor: **Project Settings** (gear icon, left sidebar) →
scroll to **Script Properties** → **Add script property**, one at a time:

| Property | Value |
|---|---|
| `SUPABASE_URL` | same URL as in `supabase-config.js` |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
| `LEDGER_USER_ID` | from step 2 |
| `LEDGER_SECRET_CODE` | make up your own, e.g. `LEDGER8f3k2` |
| `ALLOWED_EMAIL` | your own email address, lowercase |

## 4. Run setup once

Back in the **Editor** tab: in the function dropdown at the top (next to the
Run button), select **setup**, then click **Run**.

- The first run will pop up an authorization screen — Google flags this as
  "unverified" because it's your own personal script, not a published app.
  Click **Advanced → Go to Ledger Email Logger (unsafe)** → **Allow**. This
  is safe; it's granting *your own script* permission to read/send from
  *your own* Gmail, nothing leaves Google's infrastructure.
- This creates the every-1-minute trigger and two Gmail labels
  (`Ledger/Processed`, `Ledger/Failed`) that keep things organized.

## 5. Test it

From your phone, send a new email **to yourself**:

- **Subject:** `ledger`
- **Body:** `LEDGER8f3k2 250 food lunch with Raj` (use your real secret code)

Within about a minute you should get a ✅ confirmation reply, and the entry
will show up in the app under the current month. The original email moves
out of your inbox into the `Ledger/Processed` label.

## Notes / limits

- **Delay:** up to ~1 minute, since it's polling rather than instant — Apps
  Script's minimum trigger interval. For a personal ledger this is
  unnoticeable in practice.
- **Wrong secret code:** silently ignored (no reply), so a stray email that
  happens to have "ledger" in the subject doesn't get a confusing response.
- **Wrong format / unknown category:** you get an email back explaining
  what went wrong, same as the WhatsApp version.
- If you ever want to change the secret code, just update the
  `LEDGER_SECRET_CODE` script property — no redeploy needed.
- You can run this **alongside** the WhatsApp bot if you ever set both up —
  they don't conflict, since they're independent paths into the same
  Supabase database.

## Optional: make sending the email effortless

Typing out an email on your phone every time is still a few taps. An iOS
Shortcut can shave that down to one tap + a text prompt:

1. **Shortcuts app → +** → add action **Send Email**.
2. **To:** your own address. **Subject:** `ledger`.
3. **Body:** add a **Text** action first with an **Ask for Input** step
   (Text type) — plug that into the email body.
4. Add the shortcut to your Home Screen (Share icon → **Add to Home
   Screen**), or trigger it by voice: "Hey Siri, log expense."

Then logging an expense is: tap the icon → type `LEDGER8f3k2 250 food lunch
with Raj` → send. No app switching, no typing a subject line each time.
