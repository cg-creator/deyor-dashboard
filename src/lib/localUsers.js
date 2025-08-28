// Local users store using localStorage. Passwords hashed with SHA-256 (js-sha256).
// WARNING: This is a client-side store, suitable only for local/dev usage.

import { sha256 } from 'js-sha256';

const LS_USERS = 'deyor_users_v1';
const LS_CURRENT = 'deyor_current_user_v1';
export const ADMIN_EMAIL = 'cg@deyor.in';
export const ROLES = ['Admin', 'Manager', 'Finance', 'Cofounder', 'TL', 'User'];
const HASH_SALT = 'deyor_local_v1_salt';

function hashPassword(password, email) {
  // Simple salted hash for local/dev only
  return sha256(`${email.toLowerCase()}|${password}|${HASH_SALT}`);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function loadUsers() {
  return readJSON(LS_USERS, []);
}

export function saveUsers(users) {
  writeJSON(LS_USERS, users || []);
}

export function ensureSeedAdmin() {
  const users = loadUsers() || [];
  const password = 'Deyorrules@123';
  const adminHash = hashPassword(password, ADMIN_EMAIL);

  let foundAdmin = false;
  let changed = false;
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      foundAdmin = true;
      if (u.role !== 'Admin') { u.role = 'Admin'; changed = true; }
      // Enforce the requested password for the admin account
      if (!u.password_hash || u.password_hash !== adminHash) {
        u.password_hash = adminHash;
        changed = true;
      }
    } else if (u.role === 'Admin') {
      // Demote any other admins to User
      u.role = 'User';
      changed = true;
    }
  }
  if (!foundAdmin) {
    users.push({
      name: 'Admin',
      email: ADMIN_EMAIL,
      role: 'Admin',
      approved: true,
      password_hash: adminHash,
      created_at: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) saveUsers(users);
}

export function getAllUsers() {
  return loadUsers();
}

export function addUser({ name, email, role, password }) {
  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return { ok: false, error: 'exists' };
  }
  const hash = hashPassword(password, email);
  // Determine effective role: only ADMIN_EMAIL can be Admin; others can be any non-Admin role from ROLES
  let desired = role || 'User';
  if (!ROLES.includes(desired)) desired = 'User';
  let effectiveRole = desired;
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    effectiveRole = 'Admin';
  } else if (desired === 'Admin') {
    effectiveRole = 'User';
  }
  users.push({ name, email, role: effectiveRole, approved: true, password_hash: hash, created_at: new Date().toISOString() });
  saveUsers(users);
  return { ok: true };
}

export function updatePassword(email, newPassword) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return { ok: false, error: 'not_found' };
  users[idx].password_hash = hashPassword(newPassword, email);
  saveUsers(users);
  return { ok: true };
}

export function deleteUser(email) {
  const users = loadUsers();
  // Do not allow deleting the sole admin account
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return { ok: false, error: 'forbidden' };
  }
  const filtered = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
  if (filtered.length === users.length) return { ok: false, error: 'not_found' };
  saveUsers(filtered);
  return { ok: true };
}

export function verifyPassword(email, password) {
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
  if (!u) return { ok: false };
  const hash = hashPassword(password, email);
  const match = u.password_hash === hash;
  return { ok: !!match, user: match ? { name: u.name, email: u.email, role: u.role } : null };
}

export function setUserRole(email, role) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return { ok: false, error: 'not_found' };
  // Guardrails: cannot change Admin email's role; cannot assign Admin to non-admin email
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return { ok: false, error: 'forbidden' };
  }
  if (!ROLES.includes(role)) return { ok: false, error: 'invalid' };
  if (role === 'Admin') return { ok: false, error: 'forbidden' };
  users[idx].role = role;
  saveUsers(users);
  return { ok: true };
}

export function getCurrentUser() {
  return readJSON(LS_CURRENT, null);
}
export function setCurrentUser(user) {
  writeJSON(LS_CURRENT, user);
}
export function clearCurrentUser() {
  try { localStorage.removeItem(LS_CURRENT); } catch {}
}
