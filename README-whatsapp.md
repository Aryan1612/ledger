# Ledger — WhatsApp Logging Integration

This module allows you to log expenses and income directly into your Supabase database by sending a text message via WhatsApp. It functions alongside the web application, synchronizing all entries in real-time.

## Overview

The workflow routes your messages from WhatsApp through Meta's servers to a serverless Netlify function, which then securely communicates with your Supabase database. The integration requires no mobile app installation and only responds to messages sent from your designated phone number.

## Message Format

```
250 food lunch with Raj      → logs an expense: ₹250, category "Food", note "lunch with Raj"
in 5000 salary                → logs an income: ₹5000, note "salary"
```

- **Expenses:** The first word must be the amount. The second word is matched against your existing categories (case-insensitive and supports prefix matching, e.g., "trans" for "Transportation"). Any subsequent words form the note.
- **Income:** Prefix the message with `in` followed by the amount and an optional note. No category is required.
- **Error Handling:** If the formatting is incorrect, the bot will reply with instructions.

## 1. Create a Meta Developer App

1. Visit [developers.facebook.com](https://developers.facebook.com) and navigate to **My Apps → Create App**.
2. Select **Business** as the application type.
3. On your app dashboard, locate **WhatsApp** in the product list and click **Set up**.

## 2. Configure the Test Phone Number

Meta provisions a free test number for new WhatsApp integrations.

1. Navigate to **WhatsApp → API Setup**. Note the **From** number (Meta's test number) and the **Temporary access token**.
2. In the **To** section, add your personal WhatsApp number as a recipient (this requires a verification code sent to your device).
3. Send a test message from the dashboard to verify connectivity.

*Required variables for later:*
- **Phone number ID** (A numeric identifier, not the phone number itself)
- **WhatsApp Business Account ID** (Optional, but recommended to keep track of)

## 3. Generate a Permanent Access Token

The temporary token expires in 24 hours. Follow these steps to generate a permanent token:

1. Open **Business Settings** via the gear icon or at [business.facebook.com/settings](https://business.facebook.com/settings).
2. Go to **Users → System Users → Add** and create a new user (e.g., "ledger-bot") with an **Admin** role.
3. Click **Add Assets** and assign your WhatsApp app with **Full control**.
4. Click **Generate New Token** for the system user, select your app, enable the `whatsapp_business_messaging` permission, and generate. 
5. **Copy this token immediately**, as it will only be displayed once. This is your `WHATSAPP_ACCESS_TOKEN`.

## 4. Retrieve Your App Secret

Navigate to **App Settings → Basic** on your Meta app dashboard. Click **Show** next to the **App Secret**. This is your `WHATSAPP_APP_SECRET`, which ensures incoming webhook requests are genuinely originating from Meta.

## 5. Retrieve Supabase Credentials

- **User ID:** Navigate to **Supabase Dashboard → Authentication → Users**, click your user profile, and copy the **UID**. This is your `LEDGER_USER_ID`.
- **Service Role Key:** Navigate to **Supabase Dashboard → Project Settings → API Keys** and copy the **service_role** key. This is your `SUPABASE_SERVICE_ROLE_KEY`. *(Note: This key bypasses Row Level Security. It must only be stored in your Netlify environment variables).*

## 6. Configure Netlify Environment Variables

In your Netlify dashboard, navigate to **Site settings → Environment variables** and configure the following:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role key from Step 5 |
| `LEDGER_USER_ID` | Your Supabase UID from Step 5 |
| `WHATSAPP_ACCESS_TOKEN` | The permanent token from Step 3 |
| `WHATSAPP_PHONE_NUMBER_ID` | The Phone Number ID from Step 2 |
| `WHATSAPP_APP_SECRET` | The App Secret from Step 4 |
| `WHATSAPP_VERIFY_TOKEN` | A custom random string (e.g., `ledger-verify-8f3k2`) |
| `ALLOWED_WHATSAPP_NUMBER` | Your personal WhatsApp number in E.164 format without the `+` (e.g., `919999999999`) |

## 7. Deploy the Webhook

Upload the `ledger-web` directory (which includes `netlify/functions/`) to Netlify. Your webhook endpoint will be located at:
`https://<your-site>.netlify.app/.netlify/functions/whatsapp-webhook`

## 8. Connect Meta to Your Webhook

Return to **WhatsApp → Configuration** in the Meta app dashboard:

1. Click **Edit** under **Webhook** and paste your URL from Step 7.
2. Enter the custom `WHATSAPP_VERIFY_TOKEN` you created in Step 6.
3. Click **Verify and Save**. Meta will send a GET request to confirm the endpoint is active.
4. Under **Webhook fields**, subscribe to the **messages** event.

## 9. Verification and Testing

Send a WhatsApp message to the Meta test number from your registered personal number:
`250 food test transaction`

You should receive a ✅ confirmation reply immediately, and the transaction will populate in your web application.

## Additional Notes

- **Rate Limits:** Meta's free test number allows messaging to up to 5 verified recipients, which is sufficient for personal use.
- **Security:** The integration ignores messages from any number other than your `ALLOWED_WHATSAPP_NUMBER`.
- **Timestamps:** All entries logged via WhatsApp default to the current time in IST. To log past transactions, utilize the web interface.
- **Category Fallback:** If a category is unrecognized, the bot will reply with a list of your available categories.
