// Quick check script: queries Supabase for domestic January/February 2024 rows
// It parses .env.local manually so we don't add extra dependencies.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env.local at', envPath);
    process.exit(1);
  }
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
  loadEnvLocal();
  const url = process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY in .env.local');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const months = ['January 2024', 'February 2024'];
  const { data, error } = await supabase
    .from('sales_history')
    .select('*')
    .eq('segment', 'domestic')
    .in('month', months)
    .order('name', { ascending: true });

  if (error) {
    console.error('Supabase query error:', error);
    process.exit(1);
  }

  console.log('Found rows:', data?.length || 0);
  if (data && data.length) {
    for (const row of data) {
      console.log(`- ${row.name} | ${row.month} | sales=${row.sales} target=${row.target} bookings=${row.bookings ?? ''} bt=${row.bookings_target ?? ''}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
