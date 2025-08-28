import React, { useEffect, useMemo, useState } from 'react';
import { fetchHistory as apiFetchHistory, upsertHistory as apiUpsertHistory, deleteHistoryByMonth as apiDeleteMonth, deleteHistoryRow as apiDeleteRow } from '../lib/dataApi';

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ABBR_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const DEFAULT_SALES_TARGET = 200000;
const DEFAULT_BOOKINGS_TARGET = 10;

function parseMonthLabel(label) {
  if (!label) return { y: 0, m: 0 };
  const mIdxFull = MONTHS_FULL.findIndex(m => String(label).startsWith(m));
  if (mIdxFull >= 0) {
    const y = Number(String(label).split(' ')[1] || 0) || 0;
    return { y, m: mIdxFull };
  }
  const abbr = String(label).slice(0,3);
  if (ABBR_MAP[abbr] !== undefined) return { y: 0, m: ABBR_MAP[abbr] };
  return { y: 0, m: 0 };
}

function compareMonthLabels(a, b) {
  const pa = parseMonthLabel(a);
  const pb = parseMonthLabel(b);
  if (pa.y !== pb.y) return pa.y - pb.y;
  return pa.m - pb.m;
}

function ensureFullMonth(label) {
  if (!label) return label;
  const parts = String(label).split(' ');
  if (parts.length === 2 && !isNaN(Number(parts[1]))) return label;
  const abbr = String(label).slice(0,3);
  const idx = ABBR_MAP[abbr];
  const y = new Date().getFullYear();
  if (idx !== undefined) return `${MONTHS_FULL[idx]} ${y}`;
  return label;
}

function monthLabel(y, m) { return `${MONTHS_FULL[m]} ${y}`; }

function addOneMonth(y, m) {
  const nm = (m + 1) % 12;
  const ny = y + (m === 11 ? 1 : 0);
  return [ny, nm];
}

function maxMonthFromHistory(history) {
  let max = { y: 2024, m: 0 }; // Jan 2024
  history.forEach(r => {
    const { y, m } = parseMonthLabel(r.month);
    if (y > max.y || (y === max.y && m > max.m)) max = { y, m };
  });
  const now = new Date();
  if (now.getFullYear() > max.y || (now.getFullYear() === max.y && now.getMonth() > max.m)) max = { y: now.getFullYear(), m: now.getMonth() };
  return max;
}

export default function HistoricalData({ canEdit = true }) {
  const [history, setHistory] = useState([]);
  const [segment, setSegment] = useState(() => {
    try { return localStorage.getItem('deyor_segment') || 'domestic'; } catch { return 'domestic'; }
  });

  // Load history for current segment from API/Supabase
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await apiFetchHistory(segment);
      if (!alive) return;
      setHistory((rows || []).map(r => ({ segment: r.segment || 'domestic', ...r, month: ensureFullMonth(r.month) })));
    })();
    return () => { alive = false; };
  }, [segment]);

  // Persist chosen segment for UX
  useEffect(() => { try { localStorage.setItem('deyor_segment', segment); } catch {} }, [segment]);

  const months = useMemo(() => {
    const end = maxMonthFromHistory(history);
    const arr = [];
    let y = 2024, m = 0; // start Jan 2024
    while (y < end.y || (y === end.y && m <= end.m)) {
      arr.push(monthLabel(y, m));
      const next = addOneMonth(y, m);
      y = next[0]; m = next[1];
    }
    return arr;
  }, [history]);

  const [selectedMonth, setSelectedMonth] = useState(() => months[months.length - 1] || monthLabel(2024,0));
  useEffect(() => {
    if (!months.includes(selectedMonth)) setSelectedMonth(months[months.length - 1] || monthLabel(2024,0));
  }, [months, selectedMonth]);

  const rows = useMemo(() => history.filter(r => (r.segment || 'domestic') === segment && r.month === selectedMonth), [history, segment, selectedMonth]);
  const people = useMemo(() => Array.from(new Set(rows.map(r => r.name))).sort(), [rows]);

  // Multi-select state (by name for the current month+segment view)
  const [selected, setSelected] = useState(new Set());
  useEffect(() => { setSelected(new Set()); }, [segment, selectedMonth, rows.length]);

  function upsert({ name, month }, patch) {
    if (!canEdit) return;
    const newRow = { segment, name, month, sales: 0, target: DEFAULT_SALES_TARGET, ...(segment==='international'?{bookingsTarget: DEFAULT_BOOKINGS_TARGET, bookings: 0}:{}), ...patch };
    setHistory(prev => {
      const idx = prev.findIndex(r => (r.segment || 'domestic') === segment && r.name === name && r.month === month);
      const next = [...prev];
      if (idx >= 0) next[idx] = { ...next[idx], ...newRow };
      else next.push(newRow);
      return next;
    });
    // Persist
    apiUpsertHistory([newRow]);
  }

  function addRow() {
    if (!canEdit) return;
    const name = prompt('Enter Destination Expert name');
    if (!name) return;
    upsert({ name: name.trim(), month: selectedMonth }, {});
  }

  async function deleteRow(name) {
    if (!canEdit) return;
    if (!name) return;
    const ok = window.confirm(`Remove ${name} for ${selectedMonth} (${segment})?`);
    if (!ok) return;
    await apiDeleteRow(segment, name, selectedMonth);
    setHistory(prev => prev.filter(r => !((r.segment||'domestic')===segment && r.name===name && r.month===selectedMonth)));
  }

  function addMonth() {
    if (!canEdit) return;
    if (months.length === 0) return;
    const last = months[months.length - 1];
    const { y, m } = parseMonthLabel(last);
    const [ny, nm] = addOneMonth(y, m);
    const newLbl = monthLabel(ny, nm);
    // ensure the month appears by creating placeholder rows for existing people in this segment
    const segPeople = Array.from(new Set(history.filter(r => (r.segment||'domestic')===segment).map(r => r.name)));
    if (segPeople.length > 0) {
      const rows = segPeople.map(name => ({ segment, name, month: newLbl, sales: 0, target: DEFAULT_SALES_TARGET, ...(segment==='international'?{bookingsTarget: DEFAULT_BOOKINGS_TARGET, bookings: 0}:{}) }));
      // optimistic update
      setHistory(prev => {
        const next = [...prev];
        rows.forEach(r => {
          const idx = next.findIndex(x => (x.segment||'domestic')===segment && x.name===r.name && x.month===newLbl);
          if (idx >= 0) next[idx] = { ...next[idx], ...r }; else next.push(r);
        });
        return next;
      });
      apiUpsertHistory(rows);
    }
    setSelectedMonth(newLbl);
  }

  async function deleteMonth() {
    if (!canEdit) return;
    if (!selectedMonth) return;
    const ok = window.confirm(`Delete ALL rows for ${selectedMonth} in ${(segment==='international'?'International':'Domestic')}? This cannot be undone.`);
    if (!ok) return;
    let nextSelected = null;
    await apiDeleteMonth(segment, selectedMonth);
    setHistory(prev => {
      const next = prev.filter(r => !((r.segment||'domestic')===segment && r.month === selectedMonth));
      const remainingForSeg = Array.from(new Set(next.filter(r => (r.segment||'domestic')===segment).map(r => r.month))).sort(compareMonthLabels);
      nextSelected = remainingForSeg[remainingForSeg.length - 1] || monthLabel(2024,0);
      return next;
    });
    if (nextSelected) setSelectedMonth(nextSelected);
  }

  // Multi-select helpers
  const allSelected = people.length > 0 && people.every(n => selected.has(n));
  function toggleSelectAll() {
    if (!canEdit) return;
    setSelected(prev => {
      if (people.length === 0) return new Set();
      if (allSelected) return new Set();
      return new Set(people);
    });
  }
  function toggleSelect(name) {
    if (!canEdit) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  async function bulkDeleteSelected() {
    if (!canEdit) return;
    if (selected.size === 0) return;
    const ok = window.confirm(`Delete ${selected.size} selected row(s) for ${selectedMonth}?`);
    if (!ok) return;
    const names = Array.from(selected.values());
    for (const name of names) {
      // persist and update cache
      // Note: sequential to keep it simple; can be optimized later.
      await apiDeleteRow(segment, name, selectedMonth);
    }
    setHistory(prev => prev.filter(r => !((r.segment||'domestic')===segment && r.month===selectedMonth && selected.has(r.name))));
    setSelected(new Set());
  }

  // Optional bulk paste: accepts Google Sheets or CSV-like data.
  // Smart header mapping supports: Destination Expert/Name, Profit Target/Target, Profit Achieved/Sales,
  // (International) Bookings Target, Bookings Achieved/Bookings, and optional Month.
  function applyBulkPaste(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    // Detect a single delimiter to avoid splitting numbers like "200,000".
    const headerLine = lines[0];
    const delimiterChar =
      headerLine.includes('\t') ? '\t' :
      headerLine.includes(';') ? ';' :
      headerLine.includes('|') ? '|' :
      (headerLine.includes(',') ? ',' : '\t');

    // Split a row by the detected delimiter. If comma, handle basic CSV quotes.
    const splitRow = (row) => {
      const r = String(row || '');
      if (delimiterChar === ',') {
        const out = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < r.length; i++) {
          const ch = r[i];
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        out.push(cur.trim());
        return out;
      }
      return r.split(delimiterChar).map(p => p.trim());
    };
    const toNum = (v) => {
      if (v === '' || v == null) return '';
      const s = String(v).replace(/[,₹\s]/g, '');
      const n = Number(s);
      return isNaN(n) ? '' : n;
    };

    // Define header keys once
    const headerKeys = {
      name: ['destination expert', 'name', 'salesperson', 'sales person', 'rep'],
      target: ['profit target', 'target', 'sales target', 'revenue target'],
      sales: ['profit achieved', 'achieved', 'sales', 'revenue'],
      bookingsTarget: ['bookings target', 'booking target', 'target bookings', 'bookings goal'],
      bookings: ['bookings achieved', 'bookings', 'actual bookings', 'closed bookings'],
      month: ['month']
    };

    // Special case: support vertical keyed format like:
    // Destination Expert \n Profit Target \n Profit Achieved \n <name> \n <target> \n <sales> \n ...
    // We'll read initial header lines to determine the field order, then consume values in chunks.
    const tryVerticalKeyedParse = () => {
      // Only consider if first few lines are single tokens (no delimiter) and match known keys
      const isSingleToken = (row) => splitRow(row).length === 1;
      if (!isSingleToken(lines[0])) return false; // likely a normal row-based table
      const lower = (s) => String(s || '').toLowerCase();
      const matchKey = (label) => {
        const h = lower(label);
        if (headerKeys.name.some(k => h.includes(k))) return 'name';
        if (headerKeys.target.some(k => h.includes(k))) return 'target';
        if (headerKeys.sales.some(k => h.includes(k))) return 'sales';
        if (headerKeys.bookingsTarget.some(k => h.includes(k))) return 'bookingsTarget';
        if (headerKeys.bookings.some(k => h.includes(k))) return 'bookings';
        if (headerKeys.month.some(k => h.includes(k))) return 'month';
        return '';
      };

      const fieldOrder = [];
      let i = 0;
      while (i < lines.length && isSingleToken(lines[i])) {
        const key = matchKey(lines[i]);
        if (!key || fieldOrder.includes(key)) break;
        fieldOrder.push(key);
        i++;
      }
      // Need at least name plus one numeric field to be considered valid
      if (fieldOrder.length < 2 || !fieldOrder.includes('name')) return false;

      // Consume value chunks
      const step = fieldOrder.length;
      for (let j = i; j + step - 1 < lines.length; j += step) {
        let name, target, sales, bookingsTarget, bookings, month;
        for (let k = 0; k < step; k++) {
          const f = fieldOrder[k];
          const vRaw = splitRow(lines[j + k])[0];
          if (f === 'name') name = vRaw;
          else if (f === 'month') month = vRaw;
          else if (f === 'target') target = vRaw;
          else if (f === 'sales') sales = vRaw;
          else if (f === 'bookingsTarget') bookingsTarget = vRaw;
          else if (f === 'bookings') bookings = vRaw;
        }
        if (!name) continue;
        const rowMonth = ensureFullMonth(month || selectedMonth);
        const patch = {
          target: toNum(target) === '' ? 0 : toNum(target),
          sales: toNum(sales) === '' ? 0 : toNum(sales),
        };
        if (segment === 'international') {
          patch.bookingsTarget = toNum(bookingsTarget) === '' ? DEFAULT_BOOKINGS_TARGET : toNum(bookingsTarget);
          patch.bookings = toNum(bookings) === '' ? 0 : toNum(bookings);
        }
        upsert({ name, month: rowMonth }, patch);
      }
      return true; // handled via vertical keyed path
    };

    if (tryVerticalKeyedParse()) return;

    // Detect header row
    const first = splitRow(lines[0]).map(h => h.toLowerCase());
    const findIndex = (keys) => {
      for (let i = 0; i < first.length; i++) {
        const h = first[i];
        if (keys.some(k => h.includes(k))) return i;
      }
      return -1;
    };

    const idxMap = {
      name: findIndex(headerKeys.name),
      target: findIndex(headerKeys.target),
      sales: findIndex(headerKeys.sales),
      bookingsTarget: findIndex(headerKeys.bookingsTarget),
      bookings: findIndex(headerKeys.bookings),
      month: findIndex(headerKeys.month),
    };
    const hasHeader = Object.values(idxMap).some(i => i >= 0);

    const start = hasHeader ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const parts = splitRow(lines[i]);
      const isIntl = segment === 'international';
      let name, target, sales, bookingsTarget, bookings, month;
      if (hasHeader) {
        name = idxMap.name >= 0 ? parts[idxMap.name] : undefined;
        target = idxMap.target >= 0 ? parts[idxMap.target] : undefined;
        sales = idxMap.sales >= 0 ? parts[idxMap.sales] : undefined;
        bookingsTarget = idxMap.bookingsTarget >= 0 ? parts[idxMap.bookingsTarget] : undefined;
        bookings = idxMap.bookings >= 0 ? parts[idxMap.bookings] : undefined;
        month = idxMap.month >= 0 ? parts[idxMap.month] : undefined;
      } else {
        // Fallback to positional order based on segment
        if (isIntl) {
          [name, target, bookingsTarget, sales, bookings, month] = parts;
        } else {
          [name, target, sales, month] = parts;
        }
      }
      if (!name) continue;
      const rowMonth = ensureFullMonth(month || selectedMonth);
      const patch = {
        target: toNum(target) === '' ? 0 : toNum(target),
        sales: toNum(sales) === '' ? 0 : toNum(sales),
      };
      if (segment === 'international') {
        patch.bookingsTarget = toNum(bookingsTarget) === '' ? DEFAULT_BOOKINGS_TARGET : toNum(bookingsTarget);
        patch.bookings = toNum(bookings) === '' ? 0 : toNum(bookings);
      }
      upsert({ name, month: rowMonth }, patch);
    }
  }

  const isIntl = segment === 'international';

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Historical Data</h2>
        <div className="flex items-center gap-2">
          <button className={`rounded-2xl px-3 py-2 text-sm ${segment==='domestic'?'bg-neutral-900 text-white hover:bg-neutral-800':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setSegment('domestic')}>Domestic</button>
          <button className={`rounded-2xl px-3 py-2 text-sm ${segment==='international'?'bg-neutral-900 text-white hover:bg-neutral-800':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setSegment('international')}>International</button>
        </div>
      </div>

      {!canEdit && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Read-only: your role does not have permission to edit on this page.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {months.map(m => (
            <button key={m} className={`rounded-full px-3 py-1 text-sm ${selectedMonth===m?'bg-brand-600 text-white':'bg-neutral-100 text-neutral-900 hover:bg-neutral-200'}`} onClick={()=>setSelectedMonth(m)}>{m}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-2xl bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={addMonth} disabled={!canEdit} title={canEdit?undefined:'Read-only'}>Add Month</button>
          <button className="rounded-2xl bg-rose-600 px-3 py-2 text-sm text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={deleteMonth} disabled={!canEdit} title={canEdit?undefined:'Read-only'}>Delete Month</button>
        </div>
      </div>

      <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{selectedMonth} — {isIntl ? 'International' : 'Domestic'}</h3>
          <button className="rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={addRow} disabled={!canEdit} title={canEdit?undefined:'Read-only'}>Add Row</button>
        </div>

        {canEdit && selected.size > 0 && (
          <div className="mb-3 flex items-center justify-between text-sm">
            <div className="text-neutral-700">Selected: {selected.size}</div>
            <div className="flex items-center gap-2">
              <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700" onClick={bulkDeleteSelected}>Delete Selected</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-600">
                <th className="px-3 py-2 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={!canEdit} />
                </th>
                <th className="px-3 py-2">Destination Expert</th>
                <th className="px-3 py-2">Profit Target</th>
                {isIntl && <th className="px-3 py-2">Bookings Target</th>}
                <th className="px-3 py-2">Profit Achieved</th>
                {isIntl && <th className="px-3 py-2">Bookings Achieved</th>}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 && (
                <tr><td className="px-3 py-3 text-neutral-500" colSpan={isIntl?7:5}>No rows yet. Use Add Row or paste data below.</td></tr>
              )}
              {people.map(name => {
                const row = rows.find(r => r.name === name) || {};
                return (
                  <tr key={name} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(name)} onChange={() => toggleSelect(name)} disabled={!canEdit} />
                    </td>
                    <td className="px-3 py-2">
                      <input className="w-56 rounded-xl border border-neutral-300 px-3 py-2" value={name} readOnly title="Name is set per row" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" inputMode="numeric" className="w-40 rounded-xl border border-neutral-300 px-3 py-2" value={row.target ?? DEFAULT_SALES_TARGET} onChange={(e)=>upsert({name, month: selectedMonth},{ target: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                    </td>
                    {isIntl && (
                      <td className="px-3 py-2">
                        <input type="number" inputMode="numeric" className="w-40 rounded-xl border border-neutral-300 px-3 py-2" value={row.bookingsTarget ?? DEFAULT_BOOKINGS_TARGET} onChange={(e)=>upsert({name, month: selectedMonth},{ bookingsTarget: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <input type="number" inputMode="numeric" className="w-40 rounded-xl border border-neutral-300 px-3 py-2" value={row.sales ?? ''} onChange={(e)=>upsert({name, month: selectedMonth},{ sales: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                    </td>
                    {isIntl && (
                      <td className="px-3 py-2">
                        <input type="number" inputMode="numeric" className="w-40 rounded-xl border border-neutral-300 px-3 py-2" value={row.bookings ?? ''} onChange={(e)=>upsert({name, month: selectedMonth},{ bookings: e.target.value===''?'':Number(e.target.value) })} readOnly={!canEdit} />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {canEdit && (
                        <button className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100" onClick={()=>deleteRow(name)}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-50 p-3 text-xs text-neutral-600">
          <div className="mb-2 font-semibold">Bulk paste (optional)</div>
          <p className="mb-2">Paste directly from Google Sheets or CSV. Header row is supported and auto-mapped.</p>
          <ul className="mb-2 list-disc pl-6">
            <li>Recognized headers: Destination Expert/Name, Profit Target, Profit Achieved (Sales)</li>
            <li>International: also Bookings Target, Bookings Achieved</li>
            <li>Optional: Month column. If omitted, current month tab is used.</li>
          </ul>
          <textarea id="bulkPaste" className="h-24 w-full rounded-xl border border-neutral-300 p-2 disabled:cursor-not-allowed disabled:opacity-50" placeholder="Aarav,200000,150000\nIsha,200000,120000" disabled={!canEdit}></textarea>
          <div className="mt-2">
            <button className="rounded-xl bg-brand-600 px-3 py-2 text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canEdit} onClick={() => {
              if (!canEdit) return;
              const ta = document.getElementById('bulkPaste');
              if (ta) applyBulkPaste(ta.value);
            }}>Apply Paste</button>
          </div>
        </div>
      </div>
    </main>
  );
}
