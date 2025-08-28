import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
const { Database } = sqlite3;
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_EMAIL = 'cg@deyor.in';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Deyorrules@123';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

app.use(cors({ origin: true, credentials: false }));
app.use(express.json());

// Database layer: SQLite (dev) or Postgres (prod)
const USE_PG = !!process.env.DATABASE_URL;
let pool = null;
if (USE_PG) {
  const { Pool } = pg;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
}

// Convert '?' placeholders to $1..$n for Postgres
function toPg(sql) {
  let i = 0; return sql.replace(/\?/g, () => `$${++i}`);
}

// Low-level helpers
let sqlite = null;
if (!USE_PG) {
  sqlite = new Database('./db.sqlite');
}
function run(sql, params = []) {
  if (USE_PG) return pool.query(toPg(sql), params).then(() => ({ changes: undefined }));
  return new Promise((resolve, reject) => {
    sqlite.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
  });
}
function get(sql, params = []) {
  if (USE_PG) return pool.query(toPg(sql), params).then(r => r.rows[0]);
  return new Promise((resolve, reject) => {
    sqlite.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}
function all(sql, params = []) {
  if (USE_PG) return pool.query(toPg(sql), params).then(r => r.rows);
  return new Promise((resolve, reject) => {
    sqlite.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'Admin') return res.status(403).json({ error: 'forbidden' });
  return next();
}

async function init() {
  if (USE_PG) {
    await run(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  } else {
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  }

  // Ensure sole admin exists and others are not admin
  const admin = await get('SELECT * FROM users WHERE LOWER(email)=LOWER(?)', [ADMIN_EMAIL]);
  const desiredHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  if (!admin) {
    await run('INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?,?,?,?,?)', [
      'Admin', ADMIN_EMAIL, 'Admin', desiredHash, new Date().toISOString()
    ]);
  } else {
    // Ensure role and password
    if (admin.role !== 'Admin') {
      await run('UPDATE users SET role=? WHERE id=?', ['Admin', admin.id]);
    }
    // Reset password to known value if different
    if (!bcrypt.compareSync(ADMIN_PASSWORD, admin.password_hash)) {
      await run('UPDATE users SET password_hash=? WHERE id=?', [desiredHash, admin.id]);
    }
  }
  // Demote any other admins
  await run("UPDATE users SET role='User' WHERE LOWER(email)<>LOWER(?) AND role='Admin'", [ADMIN_EMAIL]);
}

// Auth: Login -> returns JWT token + user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing' });
    const u = await get('SELECT * FROM users WHERE LOWER(email)=LOWER(?)', [email]);
    if (!u) return res.status(401).json({ error: 'invalid' });
    const ok = bcrypt.compareSync(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid' });
    const payload = { sub: u.email, role: u.role, name: u.name };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
    return res.json({ token, user: { name: u.name, email: u.email, role: u.role } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// JWT auth middleware
function auth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const parts = hdr.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

// Users
app.get('/api/users', auth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all('SELECT name, email, role FROM users ORDER BY email ASC');
    res.json({ users: rows });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/users', auth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'missing' });
    const exists = await get('SELECT 1 FROM users WHERE LOWER(email)=LOWER(?)', [email]);
    if (exists) return res.status(409).json({ error: 'exists' });
    const hash = bcrypt.hashSync(password, 10);
    let effectiveRole = role && typeof role === 'string' ? role : 'User';
    if (effectiveRole === 'Admin' && email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) effectiveRole = 'User';
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) effectiveRole = 'Admin';
    await run('INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?,?,?,?,?)', [
      name, email, effectiveRole, hash, new Date().toISOString()
    ]);
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/users/:email', auth, requireAdmin, async (req, res) => {
  try {
    const email = req.params.email;
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return res.status(403).json({ error: 'forbidden' });
    const r = await run('DELETE FROM users WHERE LOWER(email)=LOWER(?)', [email]);
    if (r.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

app.patch('/api/users/:email/password', auth, requireAdmin, async (req, res) => {
  try {
    const email = req.params.email;
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'missing' });
    const hash = bcrypt.hashSync(password, 10);
    await run('UPDATE users SET password_hash=? WHERE LOWER(email)=LOWER(?)', [hash, email]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

app.patch('/api/users/:email/role', auth, requireAdmin, async (req, res) => {
  try {
    const email = req.params.email;
    const { role } = req.body || {};
    if (!role) return res.status(400).json({ error: 'missing' });
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return res.status(403).json({ error: 'forbidden' });
    if (role === 'Admin') return res.status(403).json({ error: 'forbidden' });
    await run('UPDATE users SET role=? WHERE LOWER(email)=LOWER(?)', [role, email]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

init().then(() => {
  // Serve React build if present
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const buildDir = path.resolve(__dirname, '../build');
    app.use(express.static(buildDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      return res.sendFile(path.join(buildDir, 'index.html'));
    });
    console.log(`[server] static serving from ${buildDir}`);
  } catch (e) {
    console.warn('[server] build folder not found, API only');
  }
  app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to init DB', err);
  process.exit(1);
});
