// Seed an admin email into public.admin_emails
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seedAdminEmail.js cg@deyor.in
// Optionally, set email via ADMIN_EMAIL env var, or pass as argv[2]
// Reads REACT_APP_SUPABASE_URL from .env.local (same as the app)

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(fileName) {
  const envPath = path.join(__dirname, '..', fileName);
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  // Load .env files
  loadEnvFile('.env.local'); // for REACT_APP_SUPABASE_URL
  loadEnvFile('.env.local.server'); // optional: could contain SUPABASE_SERVICE_ROLE_KEY

  const url = process.env.REACT_APP_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.ADMIN_EMAIL || process.argv[2];

  if (!url) {
    console.error('Missing REACT_APP_SUPABASE_URL (set in sales-dashboard/.env.local)');
    process.exit(1);
  }
  if (!serviceKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY (export in env or put in .env.local.server, not in client .env)');
    process.exit(1);
  }
  if (!email) {
    console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/seedAdminEmail.js <email>');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  console.log('Seeding admin email:', email);
  const { error } = await supabase
    .from('admin_emails')
    .upsert([{ email }], { onConflict: 'email' });

  if (error) {
    console.error('Failed to insert admin email:', error);
    process.exit(1);
  }

  console.log('Done. Admin email ensured:', email);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
