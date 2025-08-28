import React, { useEffect, useState } from 'react';
import LoginPage from './pages/LoginPage.jsx';
import MeetingPage from './pages/MeetingPage.jsx';
import CompanyOverview from './pages/CompanyOverview.jsx';
import SetupPage from './pages/SetupPage.jsx';
import HistoricalData from './pages/HistoricalData.jsx';
import UsersPage from './pages/UsersPage.jsx';
import { getSavedUser, apiLogout } from './lib/api';
export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('meeting');
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Restore current user from token storage
    const u = getSavedUser();
    if (u) setUser(u);
    setAuthLoading(false);
  }, []);

  // Backup safety: never let the UI hang on Loading forever
  useEffect(() => {
    const t = setTimeout(() => {
      setAuthLoading(false);
      try { console.debug('[App] backup timeout cleared authLoading'); } catch {}
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  const handleLogout = async () => {
    try { apiLogout(); } catch {}
    setUser(null);
  };

  // RBAC
  const role = user?.role || 'User';
  const isAdmin = role === 'Admin';
  useEffect(() => {
    if (!isAdmin && tab !== 'meeting') setTab('meeting');
  }, [isAdmin, tab]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-600">Loading…</div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u)} />;
  }

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/deyor-logo.png" alt="Deyor" className="h-8 w-auto object-contain" />
            <span className="text-lg font-semibold tracking-tight">Deyor Sales</span>
            <span className="ml-2 text-sm text-neutral-500">Welcome, {user.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <>
                <button className={`rounded-2xl px-3 py-2 text-sm font-medium ${tab === 'meeting' ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={() => setTab('meeting')}>Meeting</button>
                <button className={`rounded-2xl px-3 py-2 text-sm font-medium ${tab === 'company' ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={() => setTab('company')}>Company Overview</button>
                <button className={`rounded-2xl px-3 py-2 text-sm font-medium ${tab === 'setup' ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={() => setTab('setup')}>Setup</button>
                <button className={`rounded-2xl px-3 py-2 text-sm font-medium ${tab === 'historical' ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={() => setTab('historical')}>Historical Data</button>
                <button className={`rounded-2xl px-3 py-2 text-sm font-medium ${tab === 'users' ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={() => setTab('users')}>Users</button>
              </>
            ) : (
              <button className={`rounded-2xl px-3 py-2 text-sm font-medium ${tab === 'meeting' ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'}`} onClick={() => setTab('meeting')}>Meeting</button>
            )}
            <button className="rounded-2xl bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800" onClick={handleLogout}>Logout</button>
          </div>
        </div>
        <div className="h-0.5 w-full bg-brand-600" />
      </header>

      {tab === 'meeting' && <MeetingPage canEdit={isAdmin} />}
      {isAdmin && tab === 'company' && <CompanyOverview />}
      {isAdmin && tab === 'setup' && <SetupPage canEdit={isAdmin} />}
      {isAdmin && tab === 'historical' && <HistoricalData canEdit={isAdmin} />}
      {isAdmin && tab === 'users' && <UsersPage />}

      <footer className="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-neutral-500">
        Tip: Use ← → in Meeting. Import data from the Setup tab.
      </footer>
    </div>
  );
}

