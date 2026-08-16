# Ledger — Web Version (Supabase + Netlify)

Ledger is a personal expense tracker. This repository contains the web deployment setup, utilizing **Supabase** for the backend database and authentication, and **Netlify** for hosting the static frontend. 

*Note: If you have previously used the desktop version (SQLite + Python), this web version operates entirely independently. It uses a separate database and does not sync with the local desktop app.*

Please follow the deployment instructions below in sequence to properly configure your instance.

## 1. Database Setup (Supabase)

1. Create a new project in your [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to the **SQL Editor** and run the following scripts in order:
   - `supabase/schema.sql` — Initializes the `categories` and `transactions` tables and configures Row Level Security (RLS) to restrict data access to your user ID.
   - `supabase/functions.sql` — Creates the necessary backend functions for generating monthly summaries and comparison charts.
   - `supabase/grants.sql` — Grants the `authenticated` role required Data API access to the tables and functions. *(Note: This step is mandatory for Supabase projects created after May 30, 2026, due to changes in default API exposure settings).*

## 2. Account Creation

To keep your ledger completely private, sign-ups should be disabled. You will manually create your single authorized account:

1. In the Supabase Dashboard, go to **Authentication → Users → Add user**. 
2. Enter your email address, enable **Auto Confirm User**, and set a password (or leave it blank, as you will use an email magic link for your initial sign-in).
3. Go to **Authentication → Sign In / Providers → Email** and **disable** the "Allow new users to sign up" setting.

## 3. Configure Project Credentials

Connect your frontend to your Supabase project:

1. Open `static/js/supabase-config.js` in your text editor.
2. Replace the placeholder values with your project credentials:
   - `LEDGER_SUPABASE_URL`: Found under **Project Settings → Data API → URL**.
   - `LEDGER_SUPABASE_ANON_KEY`: Found under **Project Settings → API Keys → anon / publishable key**. *(Note: This key is safe to be exposed in the frontend. Your data is protected by the Row Level Security configured in Step 1).*

## 4. Frontend Deployment (Netlify)

Since this is a static frontend without a build step, deployment is straightforward:

1. Create a free account at [Netlify](https://www.netlify.com).
2. To deploy automatically, connect your GitHub repository to Netlify via **Add new site → Import from Git**.
3. Alternatively, for a manual deployment, go to **Sites → Add new site → Deploy manually** and drag the entire project folder into the upload zone.
4. Once deployed, Netlify will provide a URL (e.g., `https://your-ledger-site.netlify.app`). You can customize this domain in the **Site settings**.

## 5. Enable Passkey Authentication

Passkeys allow you to sign in securely without a password using biometrics. Passkeys are bound to your specific domain, so complete this step **after** securing your Netlify URL:

1. In the Supabase Dashboard, navigate to **Authentication → Passkeys**.
2. Toggle on **Enable Passkey authentication**.
3. Set the **Relying Party ID** to your bare domain (e.g., `your-ledger-site.netlify.app` — no `https://` or trailing paths).
4. Set the **Relying Party Origins** to your full URL (e.g., `https://your-ledger-site.netlify.app`).

*Note: If you later configure a custom domain, you will need to update these settings and re-register your passkeys.*

## 6. Initial Sign-in and Device Registration

To access your deployed app for the first time:

1. Navigate to your Netlify URL.
2. Click **"First time on this device? Set up a passkey"**, enter your email, and request a sign-in link.
3. Open the email **on the device** you wish to register and click the link.
4. You will be authenticated and prompted to **register this device's passkey**. Follow your operating system's prompt (e.g., Face ID, Touch ID, or Windows Hello).
5. For all future visits on this device, you can simply click **"Sign in with passkey"**.

To use Ledger on multiple devices, repeat this process to register a passkey for each device.

## Additional Notes

- **Sign Out**: A sign-out button is available in the header next to the month selector for shared devices.
- **Passkey Beta**: The Supabase passkey feature is currently in beta. If the API changes or you encounter issues, you can always fall back to the email sign-in link used in Step 6.
- **Data Migration**: If you are transitioning from the desktop version and wish to migrate your existing `expense_tracker.db` data to Supabase, you can use a migration script to securely transfer your records.

## Additional Integrations

Beyond the standard web interface, you can also set up alternative ways to log your expenses on the go:
- [Log expenses via WhatsApp](README-whatsapp.md)
- [Log expenses via Email](README-email.md)
- [Log expenses via an iOS Shortcut](README-shortcut.md)
