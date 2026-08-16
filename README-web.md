# Ledger — web version (Supabase + Netlify)

This is the same app, restructured so Supabase replaces `app.py` + the SQLite
file, and Netlify hosts the static frontend. **It's a separate deployment
from the desktop app** — separate database, separate data. The desktop
`.app` / `python3 app.py` setup still works exactly as before if you want to
keep using it too; the two just don't sync with each other.

Order matters below — do these roughly in sequence.

## 1. Set up the database (Supabase)

You already have a project. Open **SQL Editor** in the Supabase dashboard and run, in order:

1. `supabase/schema.sql` — creates the `categories` / `transactions` tables and locks every row to your user ID (Row Level Security).
2. `supabase/functions.sql` — adds two functions the frontend calls for the monthly summary and comparison charts.
3. `supabase/grants.sql` — grants the `authenticated` role Data API access to those tables and functions. Supabase changed its defaults on **May 30, 2026**: new projects no longer auto-expose tables/functions to the Data API, even with RLS already set up — a role needs an explicit grant just to reach the table at all. If your project predates that change this is a harmless no-op; if it doesn't, this step is what makes the app's queries actually reach the database instead of failing with a `permission denied for table` (`42501`) error.

## 2. Create your one account

Since sign-ups will be switched off, create the account by hand:

- **Authentication → Users → Add user** in the dashboard. Enter your email, tick **Auto Confirm User**, and either set a password or leave it blank (you'll sign in via email link the first time anyway).
- **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up." From now on, that's the only account that will ever be able to exist.

## 3. Fill in your project credentials

Open `static/js/supabase-config.js` and replace the two placeholder values with **Project Settings → Data API → URL** and **Project Settings → API Keys → anon / publishable key** (not the secret key — the anon key is meant to be public; Row Level Security is what actually protects your data).

## 4. Deploy to Netlify

Since there's no build step, the simplest path:

1. Create a free account at [netlify.com](https://www.netlify.com).
2. Go to **Sites → Add new site → Deploy manually**, and drag the whole `ledger-web` folder onto the drop zone.
3. Netlify gives you a URL like `https://random-name-123.netlify.app`. You can rename it under **Site settings → Change site name**, or attach a custom domain later.

(Once you're comfortable with the flow, pushing this folder to a GitHub repo and connecting it under **Add new site → Import from Git** gets you auto-deploys on every push — worth doing once you're past initial setup.)

## 5. Enable passkeys, pointed at your real domain

Passkeys are bound to the exact domain they're registered on, and changing it later invalidates them — so do this **after** step 4, once you know your Netlify URL:

- **Authentication → Passkeys** in the Supabase dashboard.
- Turn on **Enable Passkey authentication**.
- **Relying Party ID**: your bare domain, e.g. `random-name-123.netlify.app` (no `https://`, no path).
- **Relying Party Origins**: `https://random-name-123.netlify.app`.

If you later move to a custom domain, you'll need to update these and re-register your passkey.

## 6. First sign-in (one-time)

Open your Netlify URL:

1. Click **"First time on this device? Set up a passkey"**, enter your email, and send yourself the link.
2. Open that email **on the same device** you want the passkey tied to, and click the link.
3. You'll land back on the site already signed in, with a prompt to **register this device's passkey** — click it and follow your browser/OS prompt (Face ID, Touch ID, Windows Hello, or a security key).
4. From then on, **"Sign in with passkey"** is all you need — no email, no password.

If you use the app on more than one device (phone + laptop, say), repeat the email-link step once per device to register a passkey for each.

## Notes

- **Sign out** button sits next to the month picker in the header, if you're ever on a shared machine.
- The passkey feature is explicitly marked **beta** by Supabase — the API "may change without notice." If something breaks after a Supabase update, the email-link path in step 6 still works as a fallback sign-in.
- If you ever want your existing desktop data (`expense_tracker.db`) copied into Supabase instead of starting fresh, that's a straightforward one-off migration script — just ask.
