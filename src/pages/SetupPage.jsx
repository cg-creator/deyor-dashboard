import React, { useEffect, useMemo, useState } from 'react';
import { fetchHistory as apiFetchHistory, upsertHistory as apiUpsertHistory, deleteHistoryByPerson as apiDeleteByPerson, fetchOverrides as apiFetchOverrides, setOverride as apiSetOverride, clearOverride as apiClearOverride, fetchProfiles as apiFetchProfiles, setProfileApproval as apiSetProfileApproval } from '../lib/dataApi';
import { isSupabaseEnabled } from '../lib/supabaseClient';
import { Plus, Users2, CalendarPlus, Target, TrendingUp, ClipboardList, Trash2 } from 'lucide-react';

const DEFAULT_SALES_TARGET = 200000; // 2 lacs
const DEFAULT_BOOKINGS_TARGET = 10;

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ABBR_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseMonthLabel(label) {
  if (!label) return { y: 0, m: 0 };
  const mIdxFull = MONTHS_FULL.findIndex(m => label.startsWith(m));
  if (mIdxFull >= 0) {
    const y = Number((label.split(' ')[1] || '0')) || 0;
    return { y, m: mIdxFull };
  }
  const abbr = label.slice(0, 3);
  if (ABBR_MAP[abbr] !== undefined) return { y: 0, m: ABBR_MAP[abbr] };
  return { y: 0, m: 0 };
}

function formatMonthYear(date = new Date()) {
  const m = MONTHS_FULL[date.getMonth()];
  const y = date.getFullYear();
  return `${m} ${y}`;
}

function ensureFullMonth(label) {
  if (!label) return formatMonthYear();
  // if already has a space and a numeric year
  const parts = String(label).split(' ');
  if (parts.length === 2 && !isNaN(Number(parts[1]))) return label;
  const abbr = String(label).slice(0,3);
  const idx = ABBR_MAP[abbr];
  const y = new Date().getFullYear();
  if (idx !== undefined) return `${MONTHS_FULL[idx]} ${y}`;
  return label;
}

function nextMonthYear(label) {
  const { y, m } = parseMonthLabel(label);
  const nm = (m + 1) % 12;
  const ny = y + (m === 11 ? 1 : 0);
  return `${MONTHS_FULL[nm]} ${ny || new Date().getFullYear()}`;
}

function compareMonthLabels(a, b) {
  const pa = parseMonthLabel(a);
  const pb = parseMonthLabel(b);
  if (pa.y !== pb.y) return pa.y - pb.y;
  return pa.m - pb.m;
}

function gradeClass(p) {
  if (p <= 30) return 'bg-rose-100 text-rose-700';
  if (p < 50) return 'bg-orange-100 text-orange-700';
  if (p < 75) return 'bg-yellow-100 text-yellow-700';
  if (p < 100) return 'bg-emerald-100 text-emerald-700';
  if (p < 200) return 'bg-blue-100 text-blue-700';
  if (p < 300) return 'bg-pink-100 text-pink-700';
  return 'bg-gray-200 text-gray-800';
}

function normalizeHistory(arr) {
  // Ensure legacy rows default to domestic and normalize month label
  return (arr || []).map(r => ({ segment: r.segment || 'domestic', ...r, month: ensureFullMonth(r.month) }));
}

export default function SetupPage({ canEdit = true }) {
  const [history, setHistory] = useState([]);
  const [segment, setSegment] = useState(() => {
    try { return localStorage.getItem('deyor_segment') || 'domestic'; } catch { return 'domestic'; }
  });

  // Admin status overrides: { [segment]: { [name]: { [month]: 'Vigilance'|'PIP'|'Terminated' } } }
  const [overrides, setOverrides] = useState({});

  // persist chosen segment
  useEffect(() => { try { localStorage.setItem('deyor_segment', segment); } catch {} }, [segment]);

  // Load history for current segment from API/Supabase
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await apiFetchHistory(segment);
      if (!alive) return;
      setHistory(normalizeHistory(rows || []));
    })();
    return () => { alive = false; };
  }, [segment]);

  // Load overrides once on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const ov = await apiFetchOverrides();
      if (!alive) return;
      setOverrides(ov || {});
    })();
    return () => { alive = false; };
  }, []);

  // Admin: user approvals
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!canEdit || !isSupabaseEnabled()) return;
    (async () => {
      setProfilesLoading(true);
      const list = await apiFetchProfiles();
      if (!alive) return;
      setProfiles(Array.isArray(list) ? list : []);
      setProfilesLoading(false);
    })();
    return () => { alive = false; };
  }, [canEdit]);

  async function approveProfile(id, approved, role) {
    await apiSetProfileApproval(id, approved, role);
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, approved, role: role ?? p.role } : p));
  }

  const people = useMemo(() => Array.from(new Set(history.filter(r => r.segment === segment).map(r => r.name))).sort(), [history, segment]);
  const months = useMemo(() => {
    const set = new Set(history.filter(r => r.segment === segment).map(r => r.month));
    // If nothing yet, seed with current month-year
    if (set.size === 0) set.add(formatMonthYear());
    return Array.from(set.values()).sort(compareMonthLabels);
  }, [history, segment]);

  const [selectedMonth, setSelectedMonth] = useState(() => months[months.length - 1] || formatMonthYear());
  useEffect(() => {
    if (!months.includes(selectedMonth)) setSelectedMonth(months[months.length - 1] || formatMonthYear());
  }, [months, selectedMonth]);

  const [newPerson, setNewPerson] = useState('');

  function upsert({ name, month }, patch) {
    if (!canEdit) return;
    const newRow = { segment, name, month, sales: 0, target: DEFAULT_SALES_TARGET, ...(segment==='international'?{bookingsTarget: DEFAULT_BOOKINGS_TARGET}:{}), ...patch };
    setHistory(prev => {
      const idx = prev.findIndex(r => (r.segment || 'domestic') === segment && r.name === name && r.month === month);
      const next = [...prev];
      if (idx >= 0) next[idx] = { ...next[idx], ...newRow };
      else next.push(newRow);
      return next;
    });
    apiUpsertHistory([newRow]);
  }

  function getOverride(name, month) {
    return overrides?.[segment]?.[name]?.[month] || 'Auto';
  }

  function setOverride(name, month, value) {
    if (!canEdit) return;
    if (value === 'Auto') {
      apiClearOverride(segment, name, month);
      setOverrides(prev => {
        const next = { ...prev };
        if (!next[segment] || !next[segment][name]) return next;
        if (next[segment][name][month] !== undefined) delete next[segment][name][month];
        if (Object.keys(next[segment][name]).length === 0) delete next[segment][name];
        if (Object.keys(next[segment] || {}).length === 0) delete next[segment];
        return next;
      });
    } else {
      apiSetOverride(segment, name, month, value);
      setOverrides(prev => {
        const next = { ...prev };
        if (!next[segment]) next[segment] = {};
        if (!next[segment][name]) next[segment][name] = {};
        next[segment][name][month] = value;
        return next;
      });
    }
  }

  function getEntry(name, month) {
    return history.find(r => (r.segment || 'domestic') === segment && r.name === name && r.month === month);
  }

  function addMonth() {
    if (!canEdit) return;
    const next = nextMonthYear(selectedMonth || formatMonthYear());
    // create placeholder rows for all people so month appears in dropdown
    if (people.length > 0) {
      people.forEach(name => upsert({ name, month: next }, {}));
    } else {
      // no people yet, just switch selection; when first person added, defaults will apply
      setSelectedMonth(next);
    }
  }

  function addPerson() {
    if (!canEdit) return;
    const name = newPerson.trim();
    if (!name) return;
    // Create a placeholder row so the person appears
    upsert({ name, month: selectedMonth }, {});
    setNewPerson('');
  }

  async function deletePerson(name) {
    if (!canEdit) return;
    if (!name) return;
    const ok = window.confirm(`Delete ${name} from ${segment} segment? This removes all months for this person in this segment.`);
    if (!ok) return;
    await apiDeleteByPerson(segment, name);
    setHistory(prev => prev.filter(r => !((r.segment || 'domestic') === segment && r.name === name)));
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Setup</h2>
        <div className="flex items-center gap-2">
          <button className={`rounded-2xl px-3 py-2 text-sm ${segment==='domestic'?'bg-brand-600 text-white':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setSegment('domestic')}>Domestic</button>
          <button className={`rounded-2xl px-3 py-2 text-sm ${segment==='international'?'bg-brand-600 text-white':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setSegment('international')}>International</button>
        </div>
      </div>

      {canEdit && isSupabaseEnabled() && (
        <div className="mb-6 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users2 size={18} className="text-neutral-600" />
              <span className="text-sm font-medium text-neutral-800">User Approvals</span>
            </div>
            {profilesLoading && <span className="text-xs text-neutral-500">Loading…</span>}
          </div>
          {profiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">No users found. Sign-ups will appear here for approval.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-neutral-50 text-neutral-600">
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Requested</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Approved</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles
                    .slice()
                    .sort((a,b)=> (a.approved===b.approved ? 0 : (a.approved?1:-1)))
                    .map(p => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{p.email}</td>
                      <td className="px-3 py-2">{p.full_name || '-'}</td>
                      <td className="px-3 py-2">{p.requested_role || '-'}</td>
                      <td className="px-3 py-2">
                        <select
                          className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm"
                          value={p.role || 'User'}
                          onChange={(e)=>approveProfile(p.id, p.approved, e.target.value)}
                        >
                          <option>User</option>
                          <option>Admin</option>
                          <option>Manager</option>
                          <option>Finance</option>
                          <option>Cofounder</option>
                          <option>TL</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${p.approved?'bg-emerald-100 text-emerald-700':'bg-yellow-100 text-yellow-700'}`}>{p.approved?'Yes':'No'}</span>
                      </td>
                      <td className="px-3 py-2">
                        {p.approved ? (
                          <button className="rounded-lg border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100" onClick={()=>approveProfile(p.id, false)}>Revoke</button>
                        ) : (
                          <button
                            className="rounded-lg bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700"
                            onClick={()=>approveProfile(p.id, true, p.role || p.requested_role || 'User')}
                          >Approve</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 text-xs text-neutral-500">
            Note: Admins are identified by email in the `admin_emails` table. Seed it via Supabase SQL with your admin emails.
          </div>
        </div>
      )}

      {!canEdit && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Read-only: your role does not have permission to edit on this page.
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users2 size={18} className="text-neutral-600" />
          <span className="text-sm text-neutral-600">People</span>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm" value={selectedMonth} onChange={(e)=>setSelectedMonth(e.target.value)}>
            {months.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button className="flex items-center gap-1 rounded-2xl bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={addMonth} disabled={!canEdit} title={canEdit?undefined:'You do not have permission to edit'}>
            <CalendarPlus size={16}/> Add Month
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <input className="flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" placeholder="Add salesperson name" value={newPerson} onChange={(e)=>setNewPerson(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') addPerson();}} disabled={!canEdit} />
          <button className="inline-flex items-center gap-1 rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={addPerson} disabled={!canEdit} title={canEdit?undefined:'You do not have permission to edit'}><Plus size={16}/> Add</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {people.length === 0 && (
          <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">No people yet. Add a name above.</div>
        )}
        {people.map(name => {
          const row = getEntry(name, selectedMonth) || {};
          const isIntl = segment === 'international';
          const effTarget = Number(row.target ?? DEFAULT_SALES_TARGET) || 0;
          const effBkgsTarget = Number(row.bookingsTarget ?? (isIntl ? DEFAULT_BOOKINGS_TARGET : 0)) || 0;
          const salesPct = effTarget > 0 ? Math.round((Number(row.sales||0) / effTarget) * 100) : 0;
          const bookingsPct = effBkgsTarget > 0 ? Math.round((Number(row.bookings||0) / effBkgsTarget) * 100) : 0;
          return (
            <div key={name} className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList size={18} className="text-neutral-500"/>
                  <h3 className="text-base font-semibold">{name} — {selectedMonth}</h3>
                </div>
                {canEdit && (
                  <button
                    className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                    title="Delete salesperson"
                    onClick={() => deletePerson(name)}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div className="flex items-center gap-2">
                  <label className="w-32 text-neutral-600">Sales Target</label>
                  <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={row.target ?? DEFAULT_SALES_TARGET} onChange={(e)=>upsert({name, month: selectedMonth},{ target: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-32 text-neutral-600">Sales Achieved</label>
                  <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={row.sales ?? ''} onChange={(e)=>upsert({name, month: selectedMonth},{ sales: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                </div>
                {isIntl && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="w-32 text-neutral-600">Bookings Target</label>
                      <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={row.bookingsTarget ?? DEFAULT_BOOKINGS_TARGET} onChange={(e)=>upsert({name, month: selectedMonth},{ bookingsTarget: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="w-32 text-neutral-600">Bookings Achieved</label>
                      <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={row.bookings ?? ''} onChange={(e)=>upsert({name, month: selectedMonth},{ bookings: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                    </div>
                  </>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div className="flex items-center gap-2">
                  <label className="w-32 text-neutral-600">Status Override</label>
                  <select
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2"
                    value={getOverride(name, selectedMonth)}
                    onChange={(e)=>setOverride(name, selectedMonth, e.target.value)}
                    disabled={!canEdit}
                  >
                    <option value="Auto">Auto (computed)</option>
                    <option value="Vigilance">Vigilance</option>
                    <option value="PIP">PIP</option>
                    <option value="Terminated">Terminated</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Target size={16} className="text-neutral-500"/>
                  <span className="text-neutral-600">% Sales completion:</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${gradeClass(salesPct)}`}>{salesPct}%</span>
                </div>
                {isIntl && (
                  <div className="flex items-center gap-2">
                    <TrendingUp size={16} className="text-neutral-500"/>
                    <span className="text-neutral-600">% Bookings completion:</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${gradeClass(bookingsPct)}`}>{bookingsPct}%</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
