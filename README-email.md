# Ledger — Email Logging Integration

This module provides a serverless integration to log expenses directly via email, bypassing the need for a Meta Business account or third-party webhooks. It runs securely within your own Google account using Google Apps Script.

## Overview

By sending an email with a specific format to **your own Gmail address**, a background Apps Script will parse the content, insert the transaction into your Supabase database, reply with a confirmation, and automatically archive the original email to keep your inbox organized.

## Message Format

Include your transaction details in the **email body**. (The subject line must contain the word "ledger", but otherwise can be anything).

**Examples:**
```
[SECRET_CODE] 250 food lunch with Raj      → logs an expense: ₹250, category "Food", note "lunch with Raj"
[SECRET_CODE] in 5000 salary                → logs an income: ₹5000, note "salary"
```

*Note: Replace `[SECRET_CODE]` with the unique identifier you configure in Step 3. This acts as a security measure to prevent unauthorized entries.*

## 1. Initialize the Apps Script Project

1. Navigate to [script.google.com](https://script.google.com) and click **New project**.
2. Delete the default placeholder code and paste the contents of `apps-script/Code.gs`.
3. Rename the project to a descriptive title, such as "Ledger Email Logger".

## 2. Retrieve Supabase Credentials

If you haven't already obtained these during the WhatsApp setup:
- **User ID:** Navigate to **Supabase Dashboard → Authentication → Users**, click your user profile, and copy the **UID**.
- **Service Role Key:** Navigate to **Supabase Dashboard → Project Settings → API Keys** and copy the **service_role** key. *(This key bypasses Row Level Security and is kept strictly private within your Apps Script environment).*

## 3. Configure Script Properties

In the Apps Script editor:
1. Click the **Project Settings** (gear icon) in the left sidebar.
2. Scroll down to **Script Properties** and click **Add script property** for each of the following:

| Property | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (matches `supabase-config.js`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service_role key from Step 2 |
| `LEDGER_USER_ID` | Your UID from Step 2 |
| `LEDGER_SECRET_CODE` | A unique string you create (e.g., `LEDGER8f3k2`) |
| `ALLOWED_EMAIL` | Your Gmail address, in lowercase |

## 4. Run Initial Setup

1. Return to the **Editor** tab.
2. In the function dropdown menu at the top, select **setup**, then click **Run**.
3. During the first run, Google will prompt for authorization. Because this is your personal script, it will be flagged as "unverified." Click **Advanced → Go to Ledger Email Logger (unsafe)** → **Allow**. This grants the script permission to interact with your Gmail account locally.
4. The setup function will automatically configure a 1-minute time-driven trigger and create two organizational labels in your Gmail (`Ledger/Processed` and `Ledger/Failed`).

## 5. Verification and Testing

Send a test email to your own address from your phone or mail client:
- **Subject:** `ledger`
- **Body:** `[YOUR_SECRET_CODE] 250 food test entry` 

Within approximately one minute, you should receive a ✅ confirmation reply. The transaction will appear in your web application, and the original email will be moved to the `Ledger/Processed` label.

## Additional Notes
- **Processing Delay:** Google Apps Script triggers have a minimum interval of 1 minute, so expect a brief delay.
- **Security:** Emails lacking the correct secret code are silently ignored without generating a reply.
- **Error Handling:** If the format or category is unrecognized, you will receive an explanatory email reply.
- **Updating the Code:** You can change your `LEDGER_SECRET_CODE` at any time via the Script Properties without needing to redeploy.
- **Compatibility:** This email integration operates independently and can run concurrently with the WhatsApp integration.

## Optional Automation: iOS Shortcut

If you use an iPhone, you can streamline the process using the Shortcuts app:
1. Open **Shortcuts** and create a new shortcut with the **Send Email** action.
2. Configure the recipient to your own address and the subject to `ledger`.
3. Precede the email action with an **Ask for Input** action (Text type) and pass that input into the email body.
4. Add the shortcut to your Home Screen or trigger it via Siri ("Hey Siri, log expense").
