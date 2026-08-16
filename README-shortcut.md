# Ledger — iOS Shortcut Integration

This guide explains how to create a custom iOS Shortcut to quickly log expenses or income via email. It provides an intuitive, tap-through interface directly from your Home Screen (or via Siri) that automatically formats and dispatches the email without requiring manual typing.

*Prerequisites: You must have completed the setup in `README-email.md` and have your `LEDGER_SECRET_CODE` ready.*

## Quick Install (Recommended)

You can download the pre-configured shortcut directly to your iPhone:
**[Download Ledger Logger Shortcut](https://www.icloud.com/shortcuts/839b8422e12f49b298eca6677e04b730)**

Once downloaded, open it in the Shortcuts app and update the "To" field in the Send Email action to your dummy Apps Script email.

---

## Manual Construction

If you prefer to build it from scratch, open the **Shortcuts** app on your iOS device and tap **+** in the top right corner. Follow these steps:

### 1. Initial Prompt (Expense or Income)

1. Add the **Choose from Menu** action.
2. Set the prompt text to: `Expense or income?`
3. Rename the two default menu items to `Expense` and `Income`.
4. This will create two distinct branches in your workflow.

### 2. Configure the "Expense" Branch

Add the following actions directly under the "Expense" menu branch:

1. **Ask for Input**:
   - Type: **Number**
   - Prompt: `Amount (₹)`
   - Rename the output variable to `Amount`.
2. **Choose from Menu**:
   - Prompt: `Category`
   - Add a menu item for each category in your Supabase database (e.g., `Travel`, `Food`, `Housing`). Ensure these names match the starting characters of your actual categories.
   - Delete the default placeholder items. Leave the inner branches empty; Shortcuts automatically saves the selection to a **Chosen Item** variable.
3. **Ask for Input**:
   - Type: **Text**
   - Prompt: `Note (optional)`
   - Rename the output variable to `Note`.
4. **Text**:
   - Construct the email payload exactly as follows (replace `[SECRET_CODE]` with your actual `LEDGER_SECRET_CODE`):
     ```
     [SECRET_CODE] [Amount] [Chosen Item] [Note]
     ```
   - *Note: Do not type the brackets; insert the actual dynamic variable pills provided by the Shortcuts app.*
   - Rename the output variable of this text block to `EmailBody`.

### 3. Configure the "Income" Branch

Add the following actions directly under the "Income" menu branch:

1. **Ask for Input**:
   - Type: **Number**
   - Prompt: `Amount (₹)`
   - Rename the output variable to `Amount`.
2. **Ask for Input**:
   - Type: **Text**
   - Prompt: `Note (optional)`
   - Rename the output variable to `Note`.
3. **Text**:
   - Construct the email payload exactly as follows:
     ```
     [SECRET_CODE] in [Amount] [Note]
     ```
   - Rename the output variable to `EmailBody`.

### 4. Configure the Email Dispatch

Add this action at the very bottom, outside of the menu branches:

1. **Send Email**:
   - **To:** Your registered Gmail address.
   - **Subject:** `ledger`
   - **Body:** Insert the `EmailBody` variable pill.
   - Tap **Show More** and toggle **Show Compose Sheet** to **Off**. This ensures the email sends silently in the background.

### 5. Finalize and Save

1. Tap the shortcut's title at the top of the screen and rename it to `Log Expense`.
2. Tap the settings icon (the circular steering wheel icon) and select **Add to Home Screen**.
3. Optionally, enable **Use with Siri** to trigger the workflow vocally.

## Usage Guide

Tap the icon on your Home Screen (or say "Hey Siri, log expense") to execute the workflow:
1. Select **Expense** or **Income**.
2. Enter the numerical amount.
3. (For expenses) Select the appropriate category from the menu.
4. Provide an optional note.

The workflow will silently dispatch the formatted email, and you will receive a confirmation reply from your Apps Script integration shortly after.

## Synchronization and Maintenance

- **Categories:** If you modify your categories within the web app, remember to update the internal menu list in this iOS Shortcut. The names must match (or prefix-match) the records in your Supabase database.
- **Permissions:** Upon the first execution, iOS will request permission to send emails automatically. Approve this request to enable silent dispatching.
