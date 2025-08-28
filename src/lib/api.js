// Minimal API client for server-backed auth & users
const API_BASE = process.env.REACT_APP_API_BASE || '';
const LS_TOKEN = 'deyor_token_v1';
const LS_USER = 'deyor_user_v1';

function saveToken(token) { try { localStorage.setItem(LS_TOKEN, token); } catch {} }
function getToken() { try { return localStorage.getItem(LS_TOKEN); } catch { return null; } }
function clearToken() { try { localStorage.removeItem(LS_TOKEN); } catch {} }

function saveUser(user) { try { localStorage.setItem(LS_USER, JSON.stringify(user)); } catch {} }
export function getSavedUser() { try { const v = localStorage.getItem(LS_USER); return v ? JSON.parse(v) : null; } catch { return null; } }
export function clearSavedUser() { try { localStorage.removeItem(LS_USER); } catch {} }

async function authFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) throw new Error('unauthorized');
  return res;
}

export async function apiLogin(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'login_failed');
  }
  const data = await res.json();
  saveToken(data.token);
  saveUser(data.user);
  return data.user;
}

export function apiLogout() { clearToken(); clearSavedUser(); }

// Users
export async function apiListUsers() {
  const res = await authFetch('/api/users');
  if (!res.ok) throw new Error('failed');
  const data = await res.json();
  return data.users || [];
}

export async function apiAddUser({ name, email, password, role }) {
  const res = await authFetch('/api/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || 'failed' };
  }
  return { ok: true };
}

export async function apiDeleteUser(email) {
  const res = await authFetch(`/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || 'failed' };
  }
  return { ok: true };
}

export async function apiUpdatePassword(email, password) {
  const res = await authFetch(`/api/users/${encodeURIComponent(email)}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });
  if (!res.ok) return { ok: false };
  return { ok: true };
}

export async function apiSetUserRole(email, role) {
  const res = await authFetch(`/api/users/${encodeURIComponent(email)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || 'failed' };
  }
  return { ok: true };
}

export const ADMIN_EMAIL = 'cg@deyor.in';
export const ROLES = ['Admin', 'Manager', 'Finance', 'Cofounder', 'TL', 'User'];
