import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchHistory as apiFetchHistory, upsertHistory as apiUpsertHistory, fetchOverrides as apiFetchOverrides } from '../lib/dataApi';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Play, Pause, BarChart3, Users2, TrendingUp, Percent, RefreshCw, Save, Plus, Minus } from 'lucide-react';

// Sample history removed – history now loads from dataApi with local cache fallback

const DEFAULT_SALES_TARGET = 200000; // 2 lacs
const DEFAULT_BOOKINGS_TARGET = 10; // international only by default
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ABBR_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseMonthLabel(label) {
  if (!label) return { y: 0, m: 0 };
  const mIdxFull = MONTHS_FULL.findIndex(m => String(label).startsWith(m));
  if (mIdxFull >= 0) {
    const y = Number(String(label).split(' ')[1] || 0) || 0;
    return { y, m: mIdxFull };
  }

  // moved worstStatus out of parseMonthLabel
  const abbr = String(label).slice(0,3);
  if (ABBR_MAP[abbr] !== undefined) return { y: 0, m: ABBR_MAP[abbr] };
  return { y: 0, m: 0 };
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

function compareMonthLabels(a, b) {
  const pa = parseMonthLabel(a);
  const pb = parseMonthLabel(b);
  if (pa.y !== pb.y) return pa.y - pb.y;
  return pa.m - pb.m;
}

function monthLabel(y, m) {
  return `${MONTHS_FULL[m]} ${y}`;
}

function addOneMonth(y, m) {
  const nm = (m + 1) % 12;
  const ny = y + (m === 11 ? 1 : 0);
  return [ny, nm];
}

function subOneMonth(y, m) {
  const pm = (m + 11) % 12;
  const py = y - (m === 0 ? 1 : 0);
  return [py, pm];
}

function prevMonthLabel(label) {
  const { y, m } = parseMonthLabel(label);
  const [py, pm] = subOneMonth(y, m);
  return monthLabel(py, pm);
}

function maxMonthFromHistory(history) {
  let max = { y: 2024, m: 0 }; // Jan 2024 baseline
  history.forEach(r => {
    const { y, m } = parseMonthLabel(r.month);
    if (y > max.y || (y === max.y && m > max.m)) max = { y, m };
  });
  const now = new Date();
  if (now.getFullYear() > max.y || (now.getFullYear() === max.y && now.getMonth() > max.m)) max = { y: now.getFullYear(), m: now.getMonth() };
  return max;
}

// Note: getLatestPerPerson removed (unused)

function parseCSV(text) {
  const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
  if (rows.length < 2) return [];
  const header = rows[0].split(/,|\t|;|\|/).map(h => h.trim().toLowerCase());
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const parts = rows[i].split(/,|\t|;|\|/).map(p => p.trim());
    const rec = Object.fromEntries(header.map((h, idx) => [h, parts[idx]]));
    if (!rec.name || !rec.month) continue;
    data.push({ segment: rec.segment || 'domestic', name: rec.name, month: ensureFullMonth(rec.month), sales: Number(rec.sales ?? 0), target: Number(rec.target ?? 0), bookingsTarget: Number(rec.bookingstarget ?? rec.bookingsTarget ?? 0), bookings: Number(rec.bookings ?? 0) });
  }
  return data;
}

function parseXLSX(arrayBuffer) {
  if (!(window && window.XLSX)) return [];
  try {
    const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const json = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!json || json.length < 2) return [];
    const header = (json[0] || []).map(h => String(h || '').trim().toLowerCase());
    const data = [];
    for (let i = 1; i < json.length; i++) {
      const row = json[i] || [];
      const rec = Object.fromEntries(header.map((h, idx) => [h, row[idx]]));
      if (!rec.name || !rec.month) continue;
      data.push({ segment: rec.segment || 'domestic', name: rec.name, month: ensureFullMonth(rec.month), sales: Number(rec.sales ?? 0), target: Number(rec.target ?? 0), bookingsTarget: Number(rec.bookingstarget ?? rec.bookingsTarget ?? 0), bookings: Number(rec.bookings ?? 0) });
    }
    return data;
  } catch {
    return [];
  }
}

function kpiDelta(curr, prev) {
  if (prev <= 0) return 100;
  return ((curr - prev) / prev) * 100;
}

// Airbnb-like brand styles used via Tailwind classes (see tailwind.config.js):
// - Primary: bg-brand-600 text-white
// - Neutral surfaces: bg-white, bg-neutral-50/100

function KPI({ label, value, icon }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-neutral-50 px-3 py-2">
      <div className="flex items-center gap-2 text-neutral-600">
        <span className="text-neutral-500">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function BadgeDelta({ curr, prev }) {
  const delta = kpiDelta(curr, prev);
  const good = delta >= 0;
  const label = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${good ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{label}</span>
  );
}

function buildInsights(personHistory, current, prevMonth, segment) {
  if (!current) return ['No data yet. Use Setup tab to import or add data.'];
  const insights = [];
  const pct = current.target > 0 ? Math.round((current.sales / current.target) * 100) : 0;
  if (pct >= 110) insights.push(`${current.name} is ahead at ${pct}% – give more leads or set a small stretch target.`);
  else if (pct >= 90) insights.push(`${current.name} is on track at ${pct}% – keep fast WhatsApp follow-ups to close.`);
  else insights.push(`${current.name} is at ${pct}% – focus on hot leads, daily check-ins, and short manager coaching.`);

  if (prevMonth) {
    const mom = kpiDelta(current.sales, prevMonth.sales);
    if (mom > 0) insights.push(`MoM up (+${mom}%) – double down on what worked last month.`);
    else if (mom < 0) insights.push(`MoM down (${mom}%) – check lead quality and tighten pitch.`);
  }

  const vols = personHistory.map(r => r.sales);
  const avg = vols.reduce((s, v) => s + v, 0) / (vols.length || 1);
  const variance = vols.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / (vols.length || 1);
  if (variance > Math.max(4, avg)) insights.push('Performance is up-down – set weekly pipeline review (15 min).');

  if (current.target > 0 && current.sales > current.target * 1.25) insights.push('Target too low – increase for next month slightly.');
  if (current.target > 0 && current.sales < current.target * 0.6) insights.push('At risk – give warm leads, vernacular pitch if needed, small tactical discount.');

  if (segment === 'international') {
    if ((current.bookingsTarget || 0) > 0) {
      const bp = Math.round(((current.bookings || 0) / (current.bookingsTarget || 1)) * 100);
      insights.push(`Bookings at ${bp}% – push demos now. Share 60-sec demo video, send Calendly, and do quick WA follow-ups.`);
    }
  }

  return insights;
}

export default function MeetingPage({ canEdit = true }) {
  const [history, setHistory] = useState([]);
  const [segment, setSegment] = useState(() => {
    try { return localStorage.getItem('deyor_segment') || 'domestic'; } catch { return 'domestic'; }
  });
  const [index, setIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);

  // Admin overrides for statuses
  const [overrides, setOverrides] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const ov = await apiFetchOverrides();
      if (!alive) return;
      setOverrides(ov || {});
    })();
    const onStorage = (e) => {
      if (e.key === 'deyor_status_overrides') {
        try { setOverrides(JSON.parse(e.newValue || '{}')); } catch { /* noop */ }
      }
      if (e.key === 'deyor_sales_history') {
        try {
          const arr = JSON.parse(e.newValue || '[]');
          setHistory((arr || []).map(r => ({ segment: r.segment || 'domestic', ...r, month: ensureFullMonth(r.month) })));
        } catch { /* noop */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => { alive = false; window.removeEventListener('storage', onStorage); };
  }, []);

  // Load history for both segments from API/Supabase
  useEffect(() => {
    let alive = true;
    (async () => {
      const [dom, intl] = await Promise.all([
        apiFetchHistory('domestic'),
        apiFetchHistory('international'),
      ]);
      if (!alive) return;
      const rows = [...(dom || []), ...(intl || [])].map(r => ({ segment: r.segment || 'domestic', ...r, month: ensureFullMonth(r.month) }));
      setHistory(rows);
    })();
    return () => { alive = false; };
  }, []);

  // Meeting month selection
  const months = useMemo(() => {
    const end = maxMonthFromHistory(history);
    const arr = [];
    let y = 2024, m = 0; // Jan 2024
    while (y < end.y || (y === end.y && m <= end.m)) {
      arr.push(monthLabel(y, m));
      const [ny, nm] = addOneMonth(y, m);
      y = ny; m = nm;
    }
    return arr;
  }, [history]);
  const [meetingMonth, setMeetingMonth] = useState(() => months?.[months.length - 1] || monthLabel(2024,0));
  // Prefer defaulting to the latest month that actually has data for the selected segment.
  const monthsWithDataSeg = useMemo(() => {
    const uniq = Array.from(new Set(history
      .filter(h => (h.segment || 'domestic') === segment)
      .map(h => h.month)
    ));
    return uniq.sort(compareMonthLabels);
  }, [history, segment]);
  useEffect(() => {
    const preferred = (monthsWithDataSeg && monthsWithDataSeg.length > 0) ? monthsWithDataSeg : months;
    if (!preferred.includes(meetingMonth)) {
      setMeetingMonth(preferred[preferred.length - 1] || monthLabel(2024,0));
    }
  }, [months, monthsWithDataSeg, meetingMonth]);

  // remove direct history writes; dataApi keeps local cache in sync on writes

  useEffect(() => {
    try { localStorage.setItem('deyor_segment', segment); } catch {}
  }, [segment]);

  const filteredHistory = useMemo(() => history.filter(h => (h.segment || 'domestic') === segment), [history, segment]);
  // Only show people with targets entered for the selected month
  const monthRows = useMemo(() => history.filter(h => (h.segment || 'domestic') === segment && h.month === meetingMonth), [history, segment, meetingMonth]);
  const latest = monthRows;
  const current = latest[index] ?? latest[0];
  const currentHistory = useMemo(() => filteredHistory.filter(h => h.name === current?.name), [filteredHistory, current?.name]);
  const currentHistorySorted = useMemo(() => {
    return [...currentHistory].sort((a,b) => compareMonthLabels(a.month, b.month));
  }, [currentHistory]);

  const prevMonth = useMemo(() => {
    if (!current) return null;
    const sorted = currentHistorySorted;
    if (sorted.length < 2) return null;
    return sorted[sorted.length - 2] ?? null;
  }, [current, currentHistorySorted]);

  const percentAch = useMemo(() => {
    if (!current || current.target <= 0) return 0;
    return Math.round((current.sales / current.target) * 100);
  }, [current]);
  const percentBookings = useMemo(() => {
    if (!current || !current.bookingsTarget || current.bookingsTarget <= 0) return 0;
    return Math.round((Number(current.bookings || 0) / Number(current.bookingsTarget || 0)) * 100);
  }, [current]);

  const avgBookingValue = useMemo(() => {
    if (!current || segment !== 'international') return 0;
    const b = Number(current.bookings || 0);
    if (b <= 0) return 0;
    const val = Number(current.sales || 0) / b;
    return Math.round(val * 100) / 100; // 2 decimals
  }, [current, segment]);

  // --- Vigilance/PIP/Terminated status computation ---
  // earliestMonthFor removed (unused)

  function findRow(name, seg, mlabel) {
    return history.find(r => (r.segment || 'domestic') === seg && r.name === name && r.month === mlabel) || null;
  }

  function isEvalSkippedForRow(row, seg) {
    if (!row) return true;
    const salesTargetOk = Number(row.target || 0) > 0;
    const bookingsTargetOk = seg !== 'international' ? true : Number(row.bookingsTarget || 0) > 0;
    return !(salesTargetOk && bookingsTargetOk);
  }

  function performanceOK(row, seg) {
    if (!row) return true; // if missing row, treat as OK (no penalty)
    const salesPct = Number(row.target || 0) > 0 ? (Number(row.sales || 0) / Number(row.target || 1)) * 100 : 100;
    if (seg === 'international') {
      const bPct = Number(row.bookingsTarget || 0) > 0 ? (Number(row.bookings || 0) / Number(row.bookingsTarget || 1)) * 100 : 100;
      return salesPct >= 60 && bPct >= 60;
    }
    return salesPct >= 60;
  }

  function computeStatusTimeline(name, seg) {
    const personMonths = Array.from(new Set(history
      .filter(r => (r.segment || 'domestic') === seg && r.name === name)
      .map(r => r.month)
    )).sort(compareMonthLabels);
    const statusByMonth = {};
    if (personMonths.length === 0) return statusByMonth;
    const earliest = personMonths[0];
    for (const m of personMonths) {
      // Manual override wins
      const ov = overrides?.[seg]?.[name]?.[m];
      if (ov) { statusByMonth[m] = ov; continue; }

      const pm = prevMonthLabel(m);
      const prevRow = findRow(name, seg, pm);

      // If no previous row, or previous row is the grace month (earliest), or targets missing => Safe
      if (!prevRow || pm === earliest || isEvalSkippedForRow(prevRow, seg)) {
        statusByMonth[m] = 'Safe';
        continue;
      }

      const ok = performanceOK(prevRow, seg);
      const prevStatus = statusByMonth[pm] || 'Safe';
      if (ok) statusByMonth[m] = 'Safe';
      else if (prevStatus === 'PIP') statusByMonth[m] = 'Terminated';
      else if (prevStatus === 'Vigilance') statusByMonth[m] = 'PIP';
      else statusByMonth[m] = 'Vigilance';
    }
    return statusByMonth;
  }

  function statusFor(name, seg, mlabel) {
    const ov = overrides?.[seg]?.[name]?.[mlabel];
    if (ov) return ov;
    const timeline = computeStatusTimeline(name, seg);
    return timeline[mlabel] || 'Safe';
  }

  // Worst-of-segments status for a person-month (within MeetingPage scope)
  function worstStatus(name, mlabel) {
    const segs = ['domestic', 'international'];
    const severity = { Terminated: 3, PIP: 2, Vigilance: 1, Safe: 0 };
    let worst = 'Safe';
    for (const s of segs) {
      // Only consider segments where the person has any history
      const hasHistory = history.some(r => (r.segment || 'domestic') === s && r.name === name);
      if (!hasHistory) continue;
      const st = statusFor(name, s, mlabel);
      if (severity[st] > severity[worst]) worst = st;
    }
    return worst;
  }

  function statusBadgeClass(s) {
    if (s === 'Vigilance') return 'bg-amber-100 text-amber-700';
    if (s === 'PIP') return 'bg-rose-100 text-rose-700';
    if (s === 'Terminated') return 'border border-rose-200 bg-gray-100 text-rose-700';
    return 'bg-emerald-100 text-emerald-700'; // Safe (unused in UI)
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

  const timerRef = useRef(null);
  useEffect(() => {
    if (!autoplay || latest.length === 0) return;
    timerRef.current = setInterval(() => setIndex(i => (i + 1) % latest.length), intervalMs);
    return () => clearInterval(timerRef.current);
  }, [autoplay, intervalMs, latest.length]);
  useEffect(() => {
    // Reset index if month or dataset changes
    if (index >= latest.length) setIndex(0);
  }, [latest.length, index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setIndex(i => (i + 1) % latest.length);
      if (e.key === 'ArrowLeft') setIndex(i => (i - 1 + latest.length) % latest.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [latest.length]);

  const statusByName = useMemo(() => {
    const out = {};
    latest.forEach(r => { out[r.name] = worstStatus(r.name, meetingMonth); });
    return out;
  }, [latest, meetingMonth, overrides, history, segment, worstStatus]);

  const orderItems = useMemo(() => {
    const severity = { Terminated: 0, PIP: 1, Vigilance: 2, Safe: 3 };
    return latest.map((r, i) => ({ name: r.name, idx: i })).sort((a, b) => {
      const sa = severity[statusByName[a.name] || 'Safe'];
      const sb = severity[statusByName[b.name] || 'Safe'];
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
  }, [latest, statusByName]);

  const currentStatus = statusByName[current?.name || ''] || 'Safe';
  const insights = useMemo(() => buildInsights(currentHistory, current, prevMonth, segment), [currentHistory, current, prevMonth, segment]);

  // onUploadHistory removed (unused; import flow lives in Setup)

  const [liveSales, setLiveSales] = useState('');
  const [liveTarget, setLiveTarget] = useState('');
  const [liveBookings, setLiveBookings] = useState('');
  const [liveBookingsTarget, setLiveBookingsTarget] = useState('');
  const [quickValue, setQuickValue] = useState('');

  useEffect(() => {
    setLiveSales(current?.sales ?? '');
    setLiveTarget(current?.target ?? DEFAULT_SALES_TARGET);
    setLiveBookings(current?.bookings ?? '');
    setLiveBookingsTarget(current?.bookingsTarget ?? ((current?.segment || segment) === 'international' ? DEFAULT_BOOKINGS_TARGET : 0));
    setQuickValue(current?.sales ?? '');
  }, [current?.name, current?.sales, current?.target, current?.bookings, current?.bookingsTarget, current?.segment, segment]);

  function applyLiveUpdate() {
    if (!canEdit || !current) return;
    const month = current.month;
    const newRow = {
      segment: current.segment || segment,
      name: current.name,
      month,
      sales: Number(liveSales ?? current.sales ?? 0),
      target: Number(liveTarget ?? current.target ?? DEFAULT_SALES_TARGET),
      bookings: Number(liveBookings ?? current.bookings ?? 0),
      bookingsTarget: Number(liveBookingsTarget ?? current.bookingsTarget ?? (((current.segment || segment) === 'international') ? DEFAULT_BOOKINGS_TARGET : 0)),
    };
    setHistory(prev => {
      const idx = prev.findIndex(r => r.name === current.name && r.month === month && (r.segment || 'domestic') === (current.segment || segment));
      const next = [...prev];
      if (idx >= 0) next[idx] = newRow; else next.push(newRow);
      return next;
    });
    apiUpsertHistory([newRow]);
  }

  function applyQuickUpdate(moveNext = false) {
    if (!canEdit || !current) return;
    const month = current.month;
    const newSales = Number(quickValue ?? current.sales ?? 0);
    const upsertRow = { segment: current.segment || segment, name: current.name, month, sales: newSales, target: Number(current?.target ?? DEFAULT_SALES_TARGET), bookings: Number(current?.bookings ?? 0), bookingsTarget: Number(current?.bookingsTarget ?? (((current.segment || segment) === 'international') ? DEFAULT_BOOKINGS_TARGET : 0)) };
    setHistory(prev => {
      const idx = prev.findIndex(r => r.name === current.name && r.month === month && (r.segment || 'domestic') === (current.segment || segment));
      const next = [...prev];
      if (idx >= 0) {
        const row = next[idx];
        next[idx] = { ...row, sales: newSales };
      } else {
        next.push(upsertRow);
      }
      return next;
    });
    apiUpsertHistory([upsertRow]);
    if (moveNext) setIndex(i => (i + 1) % latest.length);
  }

  function nudge(field, delta) {
    if (!canEdit) return;
    if (field === 'sales') setLiveSales(v => Number(v || 0) + delta);
    if (field === 'target') setLiveTarget(v => Number(v || 0) + delta);
    if (field === 'bookings') setLiveBookings(v => Number(v || 0) + delta);
    if (field === 'bookingsTarget') setLiveBookingsTarget(v => Number(v || 0) + delta);
  }

  const onLiveKeyDown = (e) => { if (!canEdit) return; if (e.key === 'Enter') applyLiveUpdate(); };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Users2 size={18} />
          <span>Order:</span>
          <div className="overflow-x-auto" style={{ width: 520 }}>
            <div className="flex gap-2">
              {orderItems.map((it) => (
                <button
                  key={it.name}
                  onClick={() => setIndex(it.idx)}
                  className={`cursor-pointer rounded-full px-3 py-1 ${it.idx === index ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200'}`}
                  style={{ minWidth: 120 }}
                  title={`Go to ${it.name}`}
                >
                  {it.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-2xl bg-brand-600 px-3 py-2 text-white hover:bg-brand-700" onClick={() => setIndex(i => (i - 1 + latest.length) % latest.length)} title="Previous">
            <ArrowLeft size={18} />
          </button>
          <button className="rounded-2xl bg-brand-600 px-3 py-2 text-white hover:bg-brand-700" onClick={() => setIndex(i => (i + 1) % latest.length)} title="Next">
            <ArrowRight size={18} />
          </button>
          <button className={`rounded-2xl px-3 py-2 text-white ${autoplay ? 'bg-neutral-900 hover:bg-neutral-800' : 'bg-brand-600 hover:bg-brand-700'}`} onClick={() => setAutoplay(a => !a)} title="Toggle Autoplay">
            {autoplay ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <select className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))} title="Slide duration">
            <option value={4000}>4s</option>
            <option value={5000}>5s</option>
            <option value={7000}>7s</option>
            <option value={10000}>10s</option>
          </select>
          <select className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm" value={meetingMonth} onChange={(e)=>setMeetingMonth(e.target.value)} title="Meeting month">
            {months.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {/* Import moved to Setup tab */}
          <div className="hidden items-center gap-2 md:flex">
            <button className={`rounded-2xl px-3 py-2 text-sm ${segment==='domestic'?'bg-neutral-900 text-white hover:bg-neutral-800':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setSegment('domestic')}>Domestic</button>
            <button className={`rounded-2xl px-3 py-2 text-sm ${segment==='international'?'bg-neutral-900 text-white hover:bg-neutral-800':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setSegment('international')}>International</button>
          </div>
          {canEdit && (
            <div className="hidden items-center gap-2 md:flex md:flex-wrap">
              <input
                type="number"
                inputMode="numeric"
                className="w-28 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm"
                placeholder="Current"
                value={quickValue}
                onChange={(e) => setQuickValue(e.target.value === '' ? '' : Number(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') applyQuickUpdate(true); }}
                title="Enter current number"
              />
              <button className="rounded-xl bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700" onClick={() => applyQuickUpdate(false)}>
                Save
              </button>
              <button className="rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800" onClick={() => applyQuickUpdate(true)}>
                Save+Next
              </button>
            </div>
          )}
        </div>
      </div>

      {latest.length === 0 ? (
        <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h3 className="mb-2 text-base font-semibold">No data for {meetingMonth}</h3>
          <p className="text-sm text-neutral-600">
            No salespeople with targets in {segment === 'international' ? 'International' : 'Domestic'} for {meetingMonth}.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Add targets via Setup → Import or enter rows in the Historical Data tab, then select this month.
          </p>
        </div>
      ) : (
      <motion.div key={current?.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="col-span-1 space-y-4">
          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight">{current?.name}</h2>
              <div className="flex items-center gap-2">
                {currentStatus && currentStatus !== 'Safe' && (
                  <span className={`rounded-full px-3 py-1 text-sm ${statusBadgeClass(currentStatus)}`}>{currentStatus}</span>
                )}
                <span className={`rounded-full px-3 py-1 text-sm ${gradeClass(percentAch)}`}>{percentAch}% sales</span>
                {segment==='international' && (
                  <span className={`rounded-full px-3 py-1 text-sm ${gradeClass(percentBookings)}`}>{percentBookings}% bookings</span>
                )}
              </div>
            </div>
            <div className="text-sm text-neutral-600">Meeting month: <b>{meetingMonth}</b></div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <KPI label="Target" value={current?.target ?? 0} icon={<BarChart3 size={16} />} />
              <KPI label="Achieved" value={current?.sales ?? 0} icon={<TrendingUp size={16} />} />
              {segment==='international' && (
                <>
                  <KPI label="Bookings Target" value={current?.bookingsTarget ?? 0} icon={<Users2 size={16} />} />
                  <KPI label="Bookings" value={current?.bookings ?? 0} icon={<Users2 size={16} />} />
                  <KPI label="Avg Booking Value" value={avgBookingValue} icon={<TrendingUp size={16} />} />
                </>
              )}
            </div>
            <div className="mt-4 h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[{ name: 'Achieved', value: current?.sales || 0 }, { name: 'Remaining', value: Math.max((current?.target || 0) - (current?.sales || 0), 0) }]} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72}>
                    <Cell fill="#FF385C" />
                    <Cell fill="#e5e7eb" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {prevMonth && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Percent size={16} />
                <span>MoM change: </span>
                <BadgeDelta curr={current.sales} prev={prevMonth.sales} />
              </div>
            )}
          </div>

          {canEdit && (
          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-semibold">Live Update (during meeting)</h3>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <label className="w-24 text-neutral-600">Achieved</label>
                <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={liveSales} onChange={(e)=>setLiveSales(e.target.value === '' ? '' : Number(e.target.value))} onKeyDown={onLiveKeyDown} />
                <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('sales', -1)} title="-1"><Minus size={16} /></button>
                <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('sales', +1)} title="+1"><Plus size={16} /></button>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-24 text-neutral-600">Target</label>
                <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={liveTarget} onChange={(e)=>setLiveTarget(e.target.value === '' ? '' : Number(e.target.value))} onKeyDown={onLiveKeyDown} />
                <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('target', -1)} title="-1"><Minus size={16} /></button>
                <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('target', +1)} title="+1"><Plus size={16} /></button>
              </div>
              {segment==='international' && (
                <>
                  <div className="flex items-center gap-2">
                    <label className="w-24 text-neutral-600">Bookings</label>
                    <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={liveBookings ?? ''} onChange={(e)=>setLiveBookings(e.target.value === '' ? '' : Number(e.target.value))} onKeyDown={onLiveKeyDown} />
                    <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('bookings', -1)} title="-1"><Minus size={16} /></button>
                    <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('bookings', +1)} title="+1"><Plus size={16} /></button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="w-24 text-neutral-600">Bkgs Target</label>
                    <input type="number" inputMode="numeric" className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2" value={liveBookingsTarget ?? ''} onChange={(e)=>setLiveBookingsTarget(e.target.value === '' ? '' : Number(e.target.value))} onKeyDown={onLiveKeyDown} />
                    <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('bookingsTarget', -1)} title="-1"><Minus size={16} /></button>
                    <button className="rounded-xl bg-brand-600 p-2 text-white hover:bg-brand-700" onClick={()=>nudge('bookingsTarget', +1)} title="+1"><Plus size={16} /></button>
                  </div>
                </>
              )}
              <button className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-2 text-white hover:bg-brand-700" onClick={applyLiveUpdate}>
                <Save size={16}/> Save to dashboard
              </button>
              <p className="text-xs text-neutral-500">Tip: Press Enter in a box to save.</p>
            </div>
          </div>
          )}

          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">AI Insights</h3>
              <button className="flex items-center gap-1 rounded-2xl bg-brand-600 px-3 py-1 text-xs text-white hover:bg-brand-700" onClick={() => setHistory(arr => [...arr])}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
            <ul className="list-disc space-y-2 pl-5 text-sm text-neutral-700">
              {insights.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="col-span-2 space-y-4">
          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-semibold">{current?.name}'s monthly trend</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={currentHistorySorted} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="sales" stroke="#FF385C" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="target" stroke="#a3a3a3" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-semibold">Team snapshot (current month)</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latest} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="sales" name="Achieved" fill="#FF385C" />
                  <Bar dataKey="target" name="Target" fill="#e5e7eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </motion.div>
      )}
    </main>
  );
}
