import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart, Line } from 'recharts';
import { TrendingUp, BarChart3, Percent, Users2, RefreshCw } from 'lucide-react';

const SAMPLE_HISTORY = [
  { name: 'Aarav', month: 'Apr', sales: 8, target: 200000 },
  { name: 'Aarav', month: 'May', sales: 12, target: 200000 },
  { name: 'Aarav', month: 'Jun', sales: 10, target: 200000 },
  { name: 'Aarav', month: 'Jul', sales: 14, target: 200000 },
  { name: 'Aarav', month: 'Aug', sales: 18, target: 200000 },

  { name: 'Isha', month: 'Apr', sales: 7, target: 200000 },
  { name: 'Isha', month: 'May', sales: 9, target: 200000 },
  { name: 'Isha', month: 'Jun', sales: 11, target: 200000 },
  { name: 'Isha', month: 'Jul', sales: 12, target: 200000 },
  { name: 'Isha', month: 'Aug', sales: 13, target: 200000 },

  { name: 'Kabir', month: 'Apr', sales: 6, target: 200000 },
  { name: 'Kabir', month: 'May', sales: 8, target: 200000 },
  { name: 'Kabir', month: 'Jun', sales: 10, target: 200000 },
  { name: 'Kabir', month: 'Jul', sales: 9, target: 200000 },
  { name: 'Kabir', month: 'Aug', sales: 12, target: 200000 },
];

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ABBR_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

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
  // already like 'February 2025'
  const parts = String(label).split(' ');
  if (parts.length === 2 && !isNaN(Number(parts[1]))) return label;
  const abbr = String(label).slice(0,3);
  const idx = ABBR_MAP[abbr];
  const y = new Date().getFullYear();
  if (idx !== undefined) return `${MONTHS_FULL[idx]} ${y}`;
  return label;
}

function getLatestPerPerson(history) {
  const byPerson = new Map();
  history.forEach(r => {
    const prev = byPerson.get(r.name);
    if (!prev) byPerson.set(r.name, r);
    else if (compareMonthLabels(r.month, prev.month) > 0) byPerson.set(r.name, r);
  });
  return Array.from(byPerson.values());
}

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

function buildCompanyInsights(latest, monthlyTotals, scope) {
  if (!latest || latest.length === 0) return ['No data yet. Import CSV/XLSX to begin.'];
  const tips = [];
  const totalSales = latest.reduce((s, r) => s + (r.sales || 0), 0);
  const totalTarget = latest.reduce((s, r) => s + (r.target || 0), 0);
  const achievement = totalTarget > 0 ? Math.round((totalSales / totalTarget) * 100) : 0;
  tips.push(`Company at ${achievement}% of target this month.`);

  if (monthlyTotals.length >= 2) {
    const prev = monthlyTotals[monthlyTotals.length - 2].total;
    const curr = monthlyTotals[monthlyTotals.length - 1].total;
    const mom = prev <= 0 ? 100 : Math.round(((curr - prev) / prev) * 100);
    tips.push(`MoM ${mom >= 0 ? 'up' : 'down'} ${mom >= 0 ? '+' : ''}${mom}%. Plan push in last 7 days of month.`);
  }

  const sortedBySales = [...latest].sort((a,b) => (b.sales||0) - (a.sales||0));
  const top = sortedBySales[0];
  if (top) tips.push(`Top performer: ${top.name}. Record a short Loom/Zoom on talk track and share.`);

  const atRisk = latest.filter(r => (r.target || 0) > 0 && Math.round(((r.sales || 0) / (r.target || 1)) * 100) < 60).map(r => r.name);
  if (atRisk.length) tips.push(`At risk: ${atRisk.join(', ')}. Give warm leads, WhatsApp follow-ups, and manager-assisted demos.`);

  if (scope === 'combined') {
    const segTotals = latest.reduce((m, r) => {
      const key = (r.segment || 'domestic');
      m[key] = (m[key] || 0) + (r.sales || 0);
      return m;
    }, {});
    const d = segTotals['domestic'] || 0;
    const i = segTotals['international'] || 0;
    const sum = d + i || 1;
    tips.push(`Mix: Domestic ${(Math.round((d/sum)*100))}%, International ${(Math.round((i/sum)*100))}%. Allocate SDR time where CAC is lower.`);
  }

  tips.push('India playbook: daily WhatsApp nudges, referral ask after each demo, weekend campaigns, Hindi/vernacular pitch when needed.');
  return tips;
}

// Use Tailwind brand utilities from tailwind.config.js

function KPI({ label, value, icon, helper }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-neutral-600">
        <span className="text-neutral-500">{icon}</span>
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {helper && <div className="mt-1 text-xs text-neutral-500">{helper}</div>}
    </div>
  );
}

export default function CompanyOverview() {
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('deyor_sales_history');
      const arr = saved ? JSON.parse(saved) : SAMPLE_HISTORY;
      return (arr || []).map(r => ({ segment: r.segment || 'domestic', ...r, month: ensureFullMonth(r.month) }));
    } catch { return SAMPLE_HISTORY; }
  });
  const [scope, setScope] = useState(() => {
    try { return localStorage.getItem('deyor_company_segment') || 'domestic'; } catch { return 'domestic'; }
  });
  const allMonths = useMemo(() => Array.from(new Set((history||[]).map(r => r.month))).sort(compareMonthLabels), [history]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    try {
      const saved = localStorage.getItem('company_overview_month');
      return saved || (allMonths[allMonths.length - 1] || null);
    } catch { return allMonths[allMonths.length - 1] || null; }
  });

  useEffect(() => {
    localStorage.setItem('deyor_sales_history', JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    try { localStorage.setItem('deyor_company_segment', scope); } catch {}
  }, [scope]);
  useEffect(() => {
    try { if (selectedMonth) localStorage.setItem('company_overview_month', selectedMonth); } catch {}
  }, [selectedMonth]);

  // keep selectedMonth valid if history changes
  useEffect(() => {
    if (!selectedMonth && allMonths.length > 0) setSelectedMonth(allMonths[allMonths.length - 1]);
    else if (selectedMonth && !allMonths.includes(selectedMonth)) setSelectedMonth(allMonths[allMonths.length - 1] || null);
  }, [allMonths, selectedMonth]);

  const filteredHistory = useMemo(() => scope === 'combined' ? history : history.filter(r => (r.segment || 'domestic') === scope), [history, scope]);
  // Filter data for the selected month (if set); aggregate by person just in case
  const monthRows = useMemo(() => {
    const rows = selectedMonth ? filteredHistory.filter(r => r.month === selectedMonth) : getLatestPerPerson(filteredHistory);
    const byPerson = new Map();
    rows.forEach(r => {
      const prev = byPerson.get(r.name) || { name: r.name, sales: 0, target: 0, bookings: 0, bookingsTarget: 0, segment: r.segment, month: r.month };
      byPerson.set(r.name, {
        ...prev,
        sales: Number(prev.sales || 0) + Number(r.sales || 0),
        target: Number(prev.target || 0) + Number(r.target || 0),
        bookings: Number(prev.bookings || 0) + Number(r.bookings || 0),
        bookingsTarget: Number(prev.bookingsTarget || 0) + Number(r.bookingsTarget || 0),
      });
    });
    return Array.from(byPerson.values());
  }, [filteredHistory, selectedMonth]);

  const totals = useMemo(() => {
    const totalSales = monthRows.reduce((s, r) => s + (r.sales || 0), 0);
    const totalTarget = monthRows.reduce((s, r) => s + (r.target || 0), 0);
    const achievement = totalTarget > 0 ? Math.round((totalSales / totalTarget) * 100) : 0;
    return { totalSales, totalTarget, achievement };
  }, [monthRows]);

  const monthlyTotals = useMemo(() => {
    const map = new Map();
    filteredHistory.forEach(r => {
      const key = r.month;
      map.set(key, (map.get(key) || 0) + (r.sales || 0));
    });
    const arr = Array.from(map.entries()).sort((a, b) => compareMonthLabels(a[0], b[0]))
      .map(([month, total]) => ({ month, total }));
    return arr;
  }, [filteredHistory]);

  const mom = useMemo(() => {
    if (monthlyTotals.length < 2) return 0;
    const prev = monthlyTotals[monthlyTotals.length - 2].total;
    const curr = monthlyTotals[monthlyTotals.length - 1].total;
    if (prev <= 0) return 100;
    return Math.round(((curr - prev) / prev) * 100);
  }, [monthlyTotals]);

  function onUploadHistory(file) {
    const name = (file?.name || '').toLowerCase();
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls');
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = isExcel ? parseXLSX(reader.result) : parseCSV(String(reader.result || ''));
      if (parsed.length) setHistory(parsed);
    };
    if (isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Company Overview</h2>
        <div className="hidden items-center gap-2 md:flex">
          <button className={`rounded-2xl px-3 py-2 text-sm ${scope==='domestic'?'bg-neutral-900 text-white hover:bg-neutral-800':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setScope('domestic')}>Domestic</button>
          <button className={`rounded-2xl px-3 py-2 text-sm ${scope==='international'?'bg-neutral-900 text-white hover:bg-neutral-800':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setScope('international')}>International</button>
          <button className={`rounded-2xl px-3 py-2 text-sm ${scope==='combined'?'bg-neutral-900 text-white hover:bg-neutral-800':'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={()=>setScope('combined')}>Combined</button>
          {/* Import moved to Setup tab */}
          <select className="ml-2 rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm" value={selectedMonth || ''} onChange={(e)=>setSelectedMonth(e.target.value || null)} title="Select month">
            {allMonths.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KPI label="Total Sales" value={totals.totalSales} icon={<TrendingUp size={16} />} />
        <KPI label="Total Target" value={totals.totalTarget} icon={<BarChart3 size={16} />} />
        <KPI label="Achievement" value={`${totals.achievement}%`} icon={<Percent size={16} />} />
        <KPI label="MoM Growth" value={`${mom >= 0 ? '+' : ''}${mom}%`} icon={<Users2 size={16} />} helper="Based on total monthly sales" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-base font-semibold">Sales by person {selectedMonth ? `(${selectedMonth})` : '(latest)'}</h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthRows} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
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

        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-base font-semibold">Total sales by month</h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTotals} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total" name="Total Sales" stroke="#FF385C" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold">AI Insights (CEO view)</h3>
          <button className="flex items-center gap-1 rounded-2xl bg-brand-600 px-3 py-1 text-xs text-white hover:bg-brand-700" onClick={() => setHistory(arr => [...arr])}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <ul className="list-disc space-y-2 pl-5 text-sm text-neutral-700">
          {useMemo(() => buildCompanyInsights(monthRows, monthlyTotals, scope), [monthRows, monthlyTotals, scope]).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
