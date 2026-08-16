# Ledger — the "Log Expense" iOS Shortcut

A tap-through form on your Home Screen (or "Hey Siri, log expense") that
builds the right email format and sends it — no typing subject lines, no
remembering the exact syntax.

Assumes you've already set up `apps-script/Code.gs` (see `README-email.md`)
and know your secret code from `LEDGER_SECRET_CODE`.

## Build it

Open the **Shortcuts** app → tap **+** (top right) → build these actions in
order. After adding each action, tap it to rename/configure as described.

### 1. Ask expense or income

Add action **Choose from Menu**.
- Tap the menu prompt text, set it to `Expense or income?`
- It starts with two menu items ("Menu Item 1/2") — tap each to rename:
  `Expense` and `Income`.
- This creates two branches below it — build the rest inside the
  **Expense** branch first, then the **Income** branch.

### 2. Inside the "Expense" branch

**Add action: Ask for Input**
- Input Type: **Number**
- Prompt: `Amount (₹)`
- Rename the output variable (tap the little variable chip) to `Amount`

**Add action: Choose from Menu** (a second one, nested here)
- Prompt: `Category`
- Add one menu item per category you actually use — match your app's
  category names exactly, e.g.: `Travel`, `Shopping`, `Personal Care`,
  `Transportation`, `Entertainment`, `Housing`, `Food`. Delete the two
  default placeholder items first.
- In **each** menu item's branch, add a single **Text** action containing
  just that category's name (this is what lets one "Category" variable
  carry through — see step below). Actually simpler: skip the Text action
  and instead, after this whole Choose-from-Menu block ends, Shortcuts
  automatically gives you a **"Chosen Item"** variable you can use directly
  in step 4 — no need to repeat text in every branch.

**Add action: Ask for Input**
- Input Type: **Text**
- Prompt: `Note (optional)`
- Rename output variable to `Note`

**Add action: Text**
- Content:
  ```
  LEDGER8f3k2 [Amount] [Chosen Item] [Note]
  ```
  (Tap inside the text field, then tap the variable chips for `Amount`,
  the category menu's `Chosen Item`, and `Note` from the little variables
  bar above the keyboard — don't type the brackets, insert the actual blue
  variable pills. Replace `LEDGER8f3k2` with your real secret code.)
- Rename this Text action's output to `EmailBody`

### 3. Inside the "Income" branch

**Add action: Ask for Input**
- Input Type: **Number**, Prompt: `Amount (₹)`, rename output to `Amount`

**Add action: Ask for Input**
- Input Type: **Text**, Prompt: `Note (optional)`, rename output to `Note`

**Add action: Text**
- Content:
  ```
  LEDGER8f3k2 in [Amount] [Note]
  ```
- Rename output to `EmailBody`

### 4. After both branches (outside the Choose from Menu block)

**Add action: Send Email**
- **To:** your own email address
- **Subject:** `ledger`
- **Body:** tap in, insert the `EmailBody` variable pill
- Tap **Show More** → turn **Show Compose Sheet** **off**, so it sends
  silently in the background instead of opening Mail for you to hit send.

### 5. Name and save

- Tap the shortcut's name at the top → `Log Expense`.
- Tap the settings icon (bottom left, looks like a steering wheel/circle)
  → **Add to Home Screen**, so it's a one-tap icon.
- While there, you can also enable **Use with Siri** and record a phrase
  like "Log expense."

## Using it

Tap the Home Screen icon (or say the Siri phrase) →

1. Tap **Expense** or **Income**
2. Type the amount, tap **Done**
3. (Expense only) tap a category from the list
4. Type a note or leave blank, tap **Done**

That's it — the email sends itself, and within about a minute you'll get
the ✅ confirmation and the entry is live in the app.

## Keeping categories in sync

If you add or rename a category in the app later, edit the Shortcut's
category menu step to match (step 2's inner Choose from Menu) — the names
need to at least *start with* what's in Supabase for the matching in
`Code.gs` to find it (it does prefix/substring matching, so `Trans` would
still match `Transportation`, but it's safer to just keep them identical).

## First-run permissions

The first time you run it, iOS will ask permission to send email as you and
possibly to allow the shortcut to run — allow both. If you don't use
Gmail's iOS app as your default Mail account, make sure whichever Mail
account Shortcuts sends from is the same one that lands in the Gmail inbox
`Code.gs` is watching (i.e. actually delivers to your Gmail address, even
if sent via Apple Mail).
