// Unified data API: uses Supabase when configured, with localStorage fallback/cache.
// Keys used in localStorage for backward-compatibility.
// - deyor_sales_history: JSON array of rows
// - deyor_status_overrides: { [segment]: { [name]: { [month]: status } } }

import { supabase, isSupabaseEnabled } from './supabaseClient';

const LS_HISTORY = 'deyor_sales_history';
const LS_OVERRIDES = 'deyor_status_overrides';

// Debug logging (opt-in via REACT_APP_DEBUG_DATAAPI=true)
const DEBUG = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_DEBUG_DATAAPI === 'true') || false;
function dbg(...args) {
  try { if (DEBUG) console.debug('[dataApi]', ...args); } catch (_) { /* ignore */ }
}

// Utilities
function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
}

// Normalizers
function toNumOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Map frontend row -> DB row (camelCase -> snake_case where needed)
function toDbRow(row) {
  return {
    segment: row.segment || 'domestic',
    name: row.name,
    month: row.month,
    sales: toNumOrNull(row.sales),
    target: toNumOrNull(row.target),
    bookings: toNumOrNull(row.bookings),
    bookings_target: toNumOrNull(row.bookingsTarget ?? row.bookings_target),
  };
}

// Map DB row -> frontend row (ensure camelCase expected by UI)
function toAppRow(row) {
  const out = { ...row };
  if (out.bookingsTarget === undefined) {
    out.bookingsTarget = out.bookings_target;
  }
  return out;
}

// Shape reference (not enforced):
// {
//   id?: string, // uuid from DB
//   segment: 'domestic' | 'international',
//   name: string,
//   month: string, // e.g., 'August 2025'
//   sales?: number,
//   target?: number,
//   bookings?: number,            // intl only
//   bookingsTarget?: number,      // intl only
//   created_at?: string,
//   updated_at?: string,
// }

// HISTORY
export async function fetchHistory(segment) {
  dbg('fetchHistory:start', { segment, supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const { data, error } = await supabase
      .from('sales_history')
      .select('*')
      .eq('segment', segment);
    if (!error && Array.isArray(data)) {
      dbg('fetchHistory:remote_ok', { segment, rows: data.length });
      // Map to app shape and MERGE into cache for this segment (avoid wiping pending local rows)
      const appRows = data.map(toAppRow);
      const all = readLocal(LS_HISTORY, []);
      const others = all.filter(r => (r.segment || 'domestic') !== segment);
      const existingSeg = all.filter(r => (r.segment || 'domestic') === segment);
      const key = (r) => `${(r.segment || 'domestic')}|${r.name}|${r.month}`;
      const map = new Map(existingSeg.map(r => [key(r), r]));
      appRows.forEach(r => map.set(key(r), r));
      const mergedSeg = Array.from(map.values());
      writeLocal(LS_HISTORY, [...others, ...mergedSeg]);
      dbg('fetchHistory:cache_merged', { segment, merged: mergedSeg.length });
      return mergedSeg;
    }
    if (error) dbg('fetchHistory:remote_error', { segment, error });
  }
  // fallback to localStorage
  const all = readLocal(LS_HISTORY, []);
  const local = all.filter(r => (r.segment || 'domestic') === segment);
  dbg('fetchHistory:local_fallback', { segment, rows: local.length });
  return local;
}

export async function upsertHistory(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { count: 0 };
  dbg('upsertHistory:start', { rowsCount: rows.length, supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const dbRows = rows.map(toDbRow);
    dbg('upsertHistory:toDbRow', { preview: dbRows.slice(0, 3) });
    const { data, error } = await supabase
      .from('sales_history')
      .upsert(dbRows, { onConflict: 'segment,name,month' })
      .select();
    if (!error && Array.isArray(data)) {
      dbg('upsertHistory:remote_ok', { affected: data.length });
      // merge into cache (store in app shape)
      const cache = readLocal(LS_HISTORY, []);
      const key = (r) => `${r.segment}|${r.name}|${r.month}`;
      const map = new Map(cache.map(r => [key(r), toAppRow(r)]));
      data.map(toAppRow).forEach(r => map.set(key(r), r));
      writeLocal(LS_HISTORY, Array.from(map.values()));
      dbg('upsertHistory:cache_merged', { total: map.size });
      return { count: data.length };
    }
    if (error) dbg('upsertHistory:remote_error_fallback_to_local', { error });
  }
  // localStorage only
  const cache = readLocal(LS_HISTORY, []);
  const key = (r) => `${r.segment}|${r.name}|${r.month}`;
  const map = new Map(cache.map(r => [key(r), toAppRow(r)]));
  rows.map(toAppRow).forEach(r => map.set(key(r), r));
  writeLocal(LS_HISTORY, Array.from(map.values()));
  dbg('upsertHistory:local_cache_merged', { total: map.size });
  return { count: rows.length };
}

export async function deleteHistoryByMonth(segment, month) {
  dbg('deleteHistoryByMonth:start', { segment, month, supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const { error } = await supabase.from('sales_history').delete().eq('segment', segment).eq('month', month);
    if (error) dbg('deleteHistoryByMonth:remote_error', { error }); else dbg('deleteHistoryByMonth:remote_ok');
  }
  // update cache either way
  const cache = readLocal(LS_HISTORY, []);
  const filtered = cache.filter(r => (r.segment || 'domestic') !== segment || r.month !== month);
  writeLocal(LS_HISTORY, filtered);
  dbg('deleteHistoryByMonth:cache_updated', { remaining: filtered.length });
  return { ok: true };
}

// Delete a single row for a person+month within a segment
export async function deleteHistoryRow(segment, name, month) {
  dbg('deleteHistoryRow:start', { segment, name, month, supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const { error } = await supabase
      .from('sales_history')
      .delete()
      .eq('segment', segment)
      .eq('name', name)
      .eq('month', month);
    if (error) dbg('deleteHistoryRow:remote_error', { error }); else dbg('deleteHistoryRow:remote_ok');
  }
  const cache = readLocal(LS_HISTORY, []);
  const filtered = cache.filter(r => !((r.segment || 'domestic') === segment && r.name === name && r.month === month));
  writeLocal(LS_HISTORY, filtered);
  dbg('deleteHistoryRow:cache_updated', { remaining: filtered.length });
  return { ok: true };
}

// Delete all rows for a person across all months within a segment
export async function deleteHistoryByPerson(segment, name) {
  dbg('deleteHistoryByPerson:start', { segment, name, supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const { error } = await supabase
      .from('sales_history')
      .delete()
      .eq('segment', segment)
      .eq('name', name);
    if (error) dbg('deleteHistoryByPerson:remote_error', { error }); else dbg('deleteHistoryByPerson:remote_ok');
  }
  const cache = readLocal(LS_HISTORY, []);
  const filtered = cache.filter(r => !((r.segment || 'domestic') === segment && r.name === name));
  writeLocal(LS_HISTORY, filtered);
  dbg('deleteHistoryByPerson:cache_updated', { remaining: filtered.length });
  return { ok: true };
}

// OVERRIDES
export async function fetchOverrides() {
  dbg('fetchOverrides:start', { supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const { data, error } = await supabase.from('status_overrides').select('*');
    if (!error && Array.isArray(data)) {
      dbg('fetchOverrides:remote_ok', { rows: data.length });
      // shape: { [segment]: { [name]: { [month]: status } } }
      const shaped = {};
      for (const r of data) {
        const seg = r.segment || 'domestic';
        shaped[seg] = shaped[seg] || {};
        shaped[seg][r.name] = shaped[seg][r.name] || {};
        shaped[seg][r.name][r.month] = r.status;
      }
      writeLocal(LS_OVERRIDES, shaped);
      dbg('fetchOverrides:cache_updated');
      return shaped;
    }
    if (error) dbg('fetchOverrides:remote_error', { error });
  }
  const local = readLocal(LS_OVERRIDES, {});
  dbg('fetchOverrides:local_fallback');
  return local;
}

export async function setOverride(segment, name, month, status) {
  dbg('setOverride:start', { segment, name, month, status, supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const { error } = await supabase.from('status_overrides').upsert([{ segment, name, month, status }], { onConflict: 'segment,name,month' });
    if (error) dbg('setOverride:remote_error', { error }); else dbg('setOverride:remote_ok');
  }
  const all = readLocal(LS_OVERRIDES, {});
  all[segment] = all[segment] || {};
  all[segment][name] = all[segment][name] || {};
  all[segment][name][month] = status;
  writeLocal(LS_OVERRIDES, all);
  dbg('setOverride:cache_updated');
  return { ok: true };
}

export async function clearOverride(segment, name, month) {
  dbg('clearOverride:start', { segment, name, month, supabase: isSupabaseEnabled() });
  if (isSupabaseEnabled()) {
    const { error } = await supabase.from('status_overrides').delete().eq('segment', segment).eq('name', name).eq('month', month);
    if (error) dbg('clearOverride:remote_error', { error }); else dbg('clearOverride:remote_ok');
  }
  const all = readLocal(LS_OVERRIDES, {});
  if (all?.[segment]?.[name]) {
    delete all[segment][name][month];
    if (Object.keys(all[segment][name]).length === 0) delete all[segment][name];
    if (Object.keys(all[segment] || {}).length === 0) delete all[segment];
    writeLocal(LS_OVERRIDES, all);
    dbg('clearOverride:cache_updated');
  }
  return { ok: true };
}

// PROFILES / AUTH HELPERS
export async function getMyProfile() {
  if (!isSupabaseEnabled()) return null;
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
      dbg('getMyProfile:error', { error });
      return null;
    }
    dbg('getMyProfile:ok', { id: user.id, approved: data?.approved, role: data?.role });
    return data || null;
  } catch (e) {
    dbg('getMyProfile:exception', { e: String(e) });
    return null;
  }
}

export async function fetchProfiles() {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    dbg('fetchProfiles:error', { error });
    return [];
  }
  dbg('fetchProfiles:ok', { count: data?.length || 0 });
  return data || [];
}

export async function setProfileApproval(id, approved, role) {
  if (!isSupabaseEnabled()) return { ok: false, error: 'supabase_disabled' };
  const patch = { approved };
  if (role) patch.role = role;
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) {
    dbg('setProfileApproval:error', { error });
    return { ok: false, error };
  }
  dbg('setProfileApproval:ok', { id, approved, role });
  return { ok: true };
}

// Approve a profile by email (useful for approval deep-links)
export async function setProfileApprovalByEmail(email, approved, role) {
  if (!isSupabaseEnabled()) return { ok: false, error: 'supabase_disabled' };
  const patch = { approved };
  if (role) patch.role = role;
  const { error } = await supabase.from('profiles').update(patch).eq('email', email);
  if (error) {
    dbg('setProfileApprovalByEmail:error', { error });
    return { ok: false, error };
  }
  dbg('setProfileApprovalByEmail:ok', { email, approved, role });
  return { ok: true };
}

export async function updateMyFullName(full_name) {
  if (!isSupabaseEnabled()) return { ok: false };
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { ok: false };
  const { error } = await supabase.from('profiles').update({ full_name }).eq('id', user.id);
  if (error) {
    dbg('updateMyFullName:error', { error });
    return { ok: false, error };
  }
  dbg('updateMyFullName:ok');
  return { ok: true };
}
