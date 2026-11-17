import crypto from 'crypto';
import express from 'express';
import type { Client } from '@libsql/client';

// Credential login + roles ('admin' | 'user') for the Express app. Sessions are stateless signed cookies;
// the user row is re-read on every request so deactivating or demoting an account takes effect immediately.

export type Role = 'admin' | 'user';
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

const COOKIE = 'lirika_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

// ---- Passwords (scrypt) ----
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used to keep login timing similar when the username does not exist
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

// ---- Session tokens (HMAC-signed) ----
function getSecret(): string | null {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  return isProduction ? null : 'lirika-dev-only-secret';
}

function signToken(userId: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function readToken(token: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof uid === 'string' && typeof exp === 'number' && exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}

function readCookie(req: express.Request, name: string): string | null {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res: express.Response, token: string, maxAgeMs: number) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; ${flags.join('; ')}`);
}

// ---- Login throttling (best effort: per server instance) ----
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

function lockedFor(key: string): number {
  const a = attempts.get(key);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}

function registerFailure(key: string) {
  const a = attempts.get(key);
  const count = (a && a.until === 0 ? a.count : 0) + 1;
  attempts.set(key, count >= MAX_ATTEMPTS ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 });
}

// ---- Setup ----
type AuthedRequest = express.Request & { user?: AuthUser };

export function setupAuth(app: express.Express, db: Client) {
  const toUser = (r: any): AuthUser => ({
    id: String(r.id),
    username: String(r.username),
    role: r.role === 'admin' ? 'admin' : 'user',
    active: Number(r.active) === 1,
    createdAt: String(r.created_at),
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
  });

  const initAuth = async () => {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS users (
         id TEXT PRIMARY KEY,
         username TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         role TEXT NOT NULL DEFAULT 'user',
         active INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL,
         last_login_at TEXT
       )`
    );
    const { rows } = await db.execute('SELECT COUNT(*) AS n FROM users');
    if (Number(rows[0].n) === 0) {
      const password = process.env.ADMIN_PASSWORD;
      if (!password) {
        console.warn('No users yet: set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) to create the first admin.');
        return;
      }
      const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
      await db.execute({
        sql: 'INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        args: [crypto.randomUUID(), username, hashPassword(password), 'admin', new Date().toISOString()],
      });
      console.log(`First admin "${username}" created.`);
    }
  };
  const authReady = initAuth();
  authReady.catch((err) => console.error('Auth init failed:', err));

  const findUserById = async (id: string) => {
    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
    return rows[0] ?? null;
  };

  // Attach the user (if any) from the session cookie
  const loadUser: express.RequestHandler = async (req: AuthedRequest, _res, next) => {
    try {
      await authReady;
      const token = readCookie(req, COOKIE);
      const uid = token ? readToken(token) : null;
      const row = uid ? await findUserById(uid) : null;
      const user = row ? toUser(row) : null;
      if (user?.active) req.user = user;
    } catch (err) {
      console.error('Session lookup failed:', err);
    }
    next();
  };

  const requireUser: express.RequestHandler = (req: AuthedRequest, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar' });
    next();
  };
  const requireAdmin: express.RequestHandler = (req: AuthedRequest, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo para administradores' });
    next();
  };

  // Everything under /api needs a session except the healthcheck and the login endpoint
  app.use('/api', loadUser);
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/login') return next();
    requireUser(req, res, next);
  });

  const validPassword = (p: unknown): p is string =>
    typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;

  app.post('/api/auth/login', async (req, res) => {
    try {
      await authReady;
      const username = String(req.body?.username ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const key = `${req.ip}|${username}`;
      const wait = lockedFor(key);
      if (wait) return res.status(429).json({ error: `Demasiados intentos. Espera ${wait} s.` });

      const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
      const row = rows[0];
      const ok = verifyPassword(password, row ? String(row.password_hash) : DUMMY_HASH) && Boolean(row);
      if (!ok) {
        registerFailure(key);
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }
      if (Number(row.active) !== 1) return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta al administrador.' });

      const token = signToken(String(row.id));
      if (!token) return res.status(500).json({ error: 'Falta configurar AUTH_SECRET en el servidor' });
      attempts.delete(key);
      const now = new Date().toISOString();
      await db.execute({ sql: 'UPDATE users SET last_login_at = ? WHERE id = ?', args: [now, String(row.id)] });
      setSessionCookie(res, token, SESSION_MS);
      res.json({ user: toUser({ ...row, last_login_at: now }) });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'No se pudo iniciar sesión' });
    }
  });

  app.post('/api/auth/logout', (_req, res) => {
    setSessionCookie(res, '', 0);
    res.json({ success: true });
  });

  app.get('/api/auth/me', (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/password', async (req: AuthedRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body ?? {};
      if (!validPassword(newPassword)) {
        return res.status(400).json({ error: `La nueva contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres` });
      }
      const row = await findUserById(req.user!.id);
      if (!row || !verifyPassword(String(currentPassword ?? ''), String(row.password_hash))) {
        return res.status(401).json({ error: 'La contraseña actual no es correcta' });
      }
      await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hashPassword(newPassword), req.user!.id] });
      res.json({ success: true });
    } catch (err) {
      console.error('Password change error:', err);
      res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
    }
  });

  // ---- Admin: account management ----
  const countActiveAdmins = async () => {
    const { rows } = await db.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1");
    return Number(rows[0].n);
  };

  app.get('/api/admin/users', requireAdmin, async (_req, res) => {
    try {
      const { rows } = await db.execute('SELECT * FROM users ORDER BY created_at ASC');
      res.json({ users: rows.map(toUser) });
    } catch (err) {
      console.error('List users error:', err);
      res.status(500).json({ error: 'No se pudo leer la lista de cuentas' });
    }
  });

  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    try {
      const username = String(req.body?.username ?? '').trim().toLowerCase();
      const { password } = req.body ?? {};
      const role: Role = req.body?.role === 'admin' ? 'admin' : 'user';
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'Usuario: 3 a 32 caracteres (letras, números, punto, guion o guion bajo)' });
      }
      if (!validPassword(password)) {
        return res.status(400).json({ error: `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres` });
      }
      const exists = await db.execute({ sql: 'SELECT 1 FROM users WHERE username = ?', args: [username] });
      if (exists.rows.length) return res.status(409).json({ error: 'Ese usuario ya existe' });
      const id = crypto.randomUUID();
      await db.execute({
        sql: 'INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        args: [id, username, hashPassword(password), role, new Date().toISOString()],
      });
      res.status(201).json({ user: toUser((await findUserById(id))!) });
    } catch (err) {
      console.error('Create user error:', err);
      res.status(500).json({ error: 'No se pudo crear la cuenta' });
    }
  });

  app.patch('/api/admin/users/:id', requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const target = await findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'Cuenta no encontrada' });
      const isSelf = target.id === req.user!.id;
      const sets: string[] = [];
      const args: (string | number)[] = [];

      if (req.body?.role !== undefined) {
        const role: Role = req.body.role === 'admin' ? 'admin' : 'user';
        if (isSelf && role !== 'admin') return res.status(400).json({ error: 'No puedes quitarte el rol de administrador' });
        sets.push('role = ?');
        args.push(role);
      }
      if (req.body?.active !== undefined) {
        const active = req.body.active ? 1 : 0;
        if (isSelf && !active) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
        sets.push('active = ?');
        args.push(active);
      }
      if (req.body?.password !== undefined) {
        if (!validPassword(req.body.password)) {
          return res.status(400).json({ error: `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres` });
        }
        sets.push('password_hash = ?');
        args.push(hashPassword(req.body.password));
      }
      if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

      await db.execute({ sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args: [...args, req.params.id] });
      if ((await countActiveAdmins()) === 0) {
        // Safety net: never leave the system without an active admin
        await db.execute({ sql: "UPDATE users SET role = 'admin', active = 1 WHERE id = ?", args: [req.user!.id] });
      }
      res.json({ user: toUser((await findUserById(req.params.id))!) });
    } catch (err) {
      console.error('Update user error:', err);
      res.status(500).json({ error: 'No se pudo actualizar la cuenta' });
    }
  });

  app.delete('/api/admin/users/:id', requireAdmin, async (req: AuthedRequest, res) => {
    try {
      if (req.params.id === req.user!.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
      const target = await findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'Cuenta no encontrada' });
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.params.id] });
      res.json({ success: true });
    } catch (err) {
      console.error('Delete user error:', err);
      res.status(500).json({ error: 'No se pudo eliminar la cuenta' });
    }
  });
}
