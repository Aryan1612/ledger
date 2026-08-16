// =============================================================================
// LEDGER — Supabase connection details
// Find both values in your Supabase project: Project Settings → Data API
// (URL) and → API Keys (the "anon" / "publishable" key — NOT the secret key).
// The anon key is safe to expose in browser code by design; Row Level
// Security (set up in supabase/schema.sql) is what actually protects your
// data, not keeping this key secret.
// =============================================================================

window.LEDGER_SUPABASE_URL = 'https://<your-project-id>.supabase.co';
window.LEDGER_SUPABASE_ANON_KEY = '<your-anon-key>';
