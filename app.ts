import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';
import { setupAuth } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express app with every /api route. Shared by the local dev server (server.ts) and the Vercel function (api/[...path].ts).
export const app = express();
app.use(express.json({ limit: '10mb' }));

// Turso (libSQL) database for cloud sync storage
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'libsql://lirika-anthonycs.aws-us-west-2.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Credential login + roles; must be registered before the routes it protects
const { authReady, requireAdmin } = setupAuth(app, db);

const LEGACY_FILE = path.resolve(__dirname, 'data', 'cloud_sync.json');

async function initDb() {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)'
  );
  // Readable columns so the table is browsable in the Turso panel (data JSON stays the source of truth)
  for (const col of ['title', 'artist', 'deleted_at']) {
    try {
      await db.execute(`ALTER TABLE songs ADD COLUMN ${col} TEXT`);
    } catch {
      // column already exists
    }
  }
  await db.execute(
    `UPDATE songs SET title = json_extract(data, '$.title'), artist = json_extract(data, '$.artist'),
     deleted_at = json_extract(data, '$.deletedAt') WHERE title IS NULL`
  );
  // User-created folders ("grupos") for organizing songs; songs reference them by id (song.groupIds)
  await db.execute(
    'CREATE TABLE IF NOT EXISTS song_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL)'
  );
  // Groups belong to one user each
  try {
    await db.execute('ALTER TABLE song_groups ADD COLUMN user_id TEXT');
  } catch {
    // column already exists
  }
  // Each account's own songs (the old shared "songs" table is only kept as a backup of the pre-copies catalog)
  await db.execute(
    'CREATE TABLE IF NOT EXISTS user_songs (user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, id))'
  );
  // Per-user favorites and group membership of the shared songs
  await db.execute(
    "CREATE TABLE IF NOT EXISTS song_meta (user_id TEXT NOT NULL, song_id TEXT NOT NULL, is_favorite INTEGER NOT NULL DEFAULT 0, group_ids TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL, PRIMARY KEY (user_id, song_id))"
  );
  // Master songs: created by admins, shared with every account, editable only by admins (everyone else edits a personal copy)
  await db.execute(
    'CREATE TABLE IF NOT EXISTS master_songs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)'
  );
  // Each account's own order of its songs inside a group (used for master songs, whose content it does not own)
  try {
    await db.execute("ALTER TABLE song_meta ADD COLUMN group_order TEXT NOT NULL DEFAULT '{}'");
  } catch {
    // column already exists
  }
  // Songs the admin picked to preload into the guest account, and which of them were already copied
  await db.execute('CREATE TABLE IF NOT EXISTS guest_seed (song_id TEXT PRIMARY KEY)');
  await db.execute('CREATE TABLE IF NOT EXISTS guest_seeded (song_id TEXT PRIMARY KEY)');
  await db.execute('CREATE TABLE IF NOT EXISTS app_flags (key TEXT PRIMARY KEY)');
  // One-time import of the old local JSON store
  const { rows } = await db.execute('SELECT COUNT(*) AS n FROM songs');
  if (Number(rows[0].n) === 0 && fs.existsSync(LEGACY_FILE)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
      await upsertSongs(Array.isArray(legacy.songs) ? legacy.songs : []);
    } catch (err) {
      console.error('Legacy import failed:', err);
    }
  }
}

// Deleted songs are kept forever as tombstones (deleted_at set) so they can be restored later

// Shared catalog (admins and regular users)
async function getPoolSongs(): Promise<any[]> {
  const { rows } = await db.execute('SELECT data FROM songs');
  return rows.map((r) => JSON.parse(r.data as string));
}

// Insert or replace only when the incoming song is at least as recent
async function upsertSongs(songs: any[]) {
  const valid = songs.filter((s) => s && s.id);
  if (valid.length === 0) return;
  await db.batch(
    valid.map((s) => ({
      sql: `INSERT INTO songs (id, data, updated_at, title, artist, deleted_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
              title = excluded.title, artist = excluded.artist, deleted_at = excluded.deleted_at
            WHERE excluded.updated_at >= songs.updated_at`,
      args: [
        String(s.id),
        JSON.stringify(s),
        new Date(s.updatedAt || 0).toISOString(),
        s.title ?? null,
        s.artist ?? null,
        s.deletedAt ?? null,
      ],
    })),
    'write'
  );
}

type Me = { id: string; isGuest: boolean; role?: string };
const me = (req: express.Request) => (req as any).user as Me;

// Every account (guest included) has its own copy of the songs: edits, favorites and groups are private
async function getUserSongs(userId: string): Promise<any[]> {
  const { rows } = await db.execute({ sql: 'SELECT data FROM user_songs WHERE user_id = ?', args: [userId] });
  return rows.map((r) => JSON.parse(r.data as string));
}

async function upsertUserSongs(userId: string, songs: any[]) {
  const valid = songs.filter((s) => s && s.id);
  if (valid.length === 0) return;
  await db.batch(
    valid.map((s) => ({
      sql: `INSERT INTO user_songs (user_id, id, data, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
            WHERE excluded.updated_at >= user_songs.updated_at`,
      args: [userId, String(s.id), JSON.stringify(s), new Date(s.updatedAt || 0).toISOString()],
    })),
    'write'
  );
}

const LINK_KEYS = ['youtube', 'spotify', 'appleMusic', 'ytMusic', 'deezer', 'soundcloud'];

// Reference links: only known platforms and only http(s) addresses are ever stored
function cleanLinks(links: any): Record<string, string> | undefined {
  if (!links || typeof links !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const k of LINK_KEYS) {
    const v = typeof links[k] === 'string' ? links[k].trim() : '';
    if (/^https?:\/\//i.test(v) && v.length <= 600) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// A song the account owns: never flagged as master; it is a copy only when its id is the master's id
function cleanPersonal(song: any) {
  const { isMaster: _m, metaUpdatedAt: _t, unmaster: _u, ...rest } = song;
  if (rest.masterId && String(rest.masterId) !== String(rest.id)) delete rest.masterId;
  return { ...rest, links: cleanLinks(rest.links) };
}

// What a master is on the server: content only (favorites and groups are per account)
function masterContent(song: any) {
  const { isMaster: _m, masterId: _i, metaUpdatedAt: _t, isFavorite: _f, groupIds: _g, groupOrder: _o, ...rest } = song;
  return { ...rest, links: cleanLinks(rest.links) };
}

async function getMasters(): Promise<any[]> {
  const { rows } = await db.execute('SELECT data FROM master_songs');
  return rows.map((r) => JSON.parse(r.data as string));
}

async function upsertMasters(songs: any[]) {
  if (!songs.length) return;
  await db.batch(
    songs.map((s) => ({
      sql: `INSERT INTO master_songs (id, data, updated_at, deleted_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
            WHERE excluded.updated_at >= master_songs.updated_at`,
      args: [String(s.id), JSON.stringify(s), new Date(s.updatedAt || 0).toISOString(), s.deletedAt ?? null],
    })),
    'write'
  );
}

// This account's own favorite / groups / order for the master songs
async function getMasterMeta(userId: string) {
  const { rows } = await db.execute({
    sql: 'SELECT song_id, is_favorite, group_ids, group_order, updated_at FROM song_meta WHERE user_id = ?',
    args: [userId],
  });
  const parse = <T,>(v: unknown, fallback: T): T => {
    try {
      return JSON.parse(String(v)) as T;
    } catch {
      return fallback;
    }
  };
  return new Map(
    rows.map((r) => [
      String(r.song_id),
      {
        fav: Number(r.is_favorite) === 1,
        groups: parse<string[]>(r.group_ids, []),
        order: parse<Record<string, number>>(r.group_order, {}),
        at: String(r.updated_at),
      },
    ])
  );
}

async function saveMasterMeta(userId: string, songs: any[]) {
  if (!songs.length) return;
  await db.batch(
    songs.map((s) => ({
      sql: `INSERT INTO song_meta (user_id, song_id, is_favorite, group_ids, group_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, song_id) DO UPDATE SET is_favorite = excluded.is_favorite, group_ids = excluded.group_ids,
              group_order = excluded.group_order, updated_at = excluded.updated_at WHERE excluded.updated_at >= song_meta.updated_at`,
      args: [
        userId,
        String(s.id),
        s.isFavorite ? 1 : 0,
        JSON.stringify(Array.isArray(s.groupIds) ? s.groupIds : []),
        JSON.stringify(s.groupOrder && typeof s.groupOrder === 'object' ? s.groupOrder : {}),
        new Date(s.metaUpdatedAt || s.updatedAt || 0).toISOString(),
      ],
    })),
    'write'
  );
}

// The Lirika search lists the master songs
async function getMasterCatalog(): Promise<any[]> {
  return (await getMasters()).filter((s) => !s.deletedAt).map((s) => ({ ...s, isFavorite: false, groupIds: [] }));
}

// What the admin can preload into the guest account: the songs of the admin libraries and the master songs
async function getCatalogSongs(): Promise<any[]> {
  const { rows } = await db.execute(
    "SELECT us.data FROM user_songs us JOIN users u ON u.id = us.user_id WHERE u.role = 'admin'"
  );
  const byId = new Map<string, any>();
  const add = (song: any) => {
    const cur = byId.get(String(song.id));
    if (!cur || new Date(song.updatedAt || 0) > new Date(cur.updatedAt || 0)) byId.set(String(song.id), song);
  };
  rows.forEach((r) => add(JSON.parse(r.data as string)));
  (await getMasters()).forEach(add);
  return [...byId.values()].filter((s) => !s.deletedAt);
}

// Copies the songs the admin picked into the guest's own catalog; each one is copied only once,
// so what the guest later edits or deletes is not undone.
async function seedGuest(userId: string) {
  const { rows } = await db.execute(
    'SELECT song_id FROM guest_seed WHERE song_id NOT IN (SELECT song_id FROM guest_seeded)'
  );
  if (!rows.length) return;
  const pool = new Map((await getCatalogSongs()).map((s) => [String(s.id), s]));
  const now = new Date().toISOString();
  const copies: any[] = [];
  for (const r of rows) {
    const song = pool.get(String(r.song_id));
    if (song && !song.deletedAt) copies.push({ ...song, isFavorite: false, groupIds: [], updatedAt: now });
  }
  await upsertUserSongs(userId, copies);
  await db.batch(
    rows.map((r) => ({ sql: 'INSERT OR IGNORE INTO guest_seeded (song_id) VALUES (?)', args: [String(r.song_id)] })),
    'write'
  );
}

async function getSongsFor(user: Me): Promise<any[]> {
  if (user.isGuest) await seedGuest(user.id);
  const own = await getUserSongs(user.id);
  const masters = await getMasters();
  const masterIds = new Set(masters.filter((m) => !m.deletedAt).map((m) => String(m.id)));
  const ownLive = new Set(own.filter((x) => !x.deletedAt).map((x) => String(x.id)));
  const meta = await getMasterMeta(user.id);

  // Masters this account has not copied; the favorite/groups on them are this account's own.
  // The guest account only has the masters it added itself.
  const shown = masters
    .filter((m) => !ownLive.has(String(m.id)) && (!user.isGuest || meta.has(String(m.id))))
    .map((m) => {
      const mm = meta.get(String(m.id));
      return {
        ...m,
        isMaster: true,
        isFavorite: mm?.fav ?? false,
        groupIds: mm?.groups ?? [],
        groupOrder: mm?.order ?? {},
        metaUpdatedAt: mm?.at,
      };
    });
  const shownLive = new Set(shown.filter((m) => !m.deletedAt).map((m) => String(m.id)));
  // A deleted copy must not hide the master that is visible again; a live song with a master's id is that account's copy
  const mine = own
    .filter((x) => !(x.deletedAt && shownLive.has(String(x.id))))
    .map((x) => (!x.deletedAt && masterIds.has(String(x.id)) ? { ...x, masterId: String(x.id) } : x));
  return [...mine, ...shown];
}

async function saveSongsFor(user: Me, songs: any[]) {
  const valid = songs.filter((x) => x && x.id);
  const personal = valid.filter((x) => !x.isMaster).map(cleanPersonal);
  await upsertUserSongs(user.id, personal);
  // An admin turning a master back into a normal song takes it away from every account that has not copied it
  if (user.role === 'admin') {
    const ids = valid.filter((x) => !x.isMaster && x.unmaster === true).map((x) => String(x.id));
    if (ids.length) {
      const now = new Date().toISOString();
      const live = (await getMasters()).filter((m) => ids.includes(String(m.id)) && !m.deletedAt);
      await upsertMasters(live.map((m) => ({ ...m, deletedAt: now, updatedAt: now })));
    }
  }
  const masterSongs = valid.filter((x) => x.isMaster);
  if (!masterSongs.length) return;
  if (user.role === 'admin') {
    // Admins create and edit masters. A song that becomes a master leaves the admin's own library.
    await upsertMasters(masterSongs.map(masterContent));
    await db.batch(
      masterSongs.map((x) => ({ sql: 'DELETE FROM user_songs WHERE user_id = ? AND id = ?', args: [user.id, String(x.id)] })),
      'write'
    );
  }
  // Everyone (admins included) keeps their own favorite / groups / order on a master; its content is never theirs to change
  await saveMasterMeta(user.id, masterSongs);
}

// Before accounts had their own copies, every non-guest account saw the shared catalog with its own favorites/groups on top
async function legacySharedView(userId: string): Promise<any[]> {
  const meta = new Map<string, { fav: boolean; groups: string[] }>();
  const { rows } = await db.execute({ sql: 'SELECT song_id, is_favorite, group_ids FROM song_meta WHERE user_id = ?', args: [userId] });
  for (const r of rows) {
    let groups: string[] = [];
    try {
      groups = JSON.parse(String(r.group_ids));
    } catch {
      // keep empty
    }
    meta.set(String(r.song_id), { fav: Number(r.is_favorite) === 1, groups });
  }
  return (await getPoolSongs()).map((s) => {
    const m = meta.get(String(s.id));
    return { ...s, isFavorite: m?.fav ?? false, groupIds: m?.groups ?? [] };
  });
}

// Before per-user favorites/groups existed, they were global: hand them to the first admin once.
async function migrateOwnership() {
  await authReady;
  const done = await db.execute("SELECT 1 FROM app_flags WHERE key = 'ownership_v1'");
  if (done.rows.length) return;
  const admin = (await db.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1")).rows[0];
  if (!admin) return; // no admin yet; try again on the next start
  const adminId = String(admin.id);
  await db.execute({ sql: 'UPDATE song_groups SET user_id = ? WHERE user_id IS NULL', args: [adminId] });
  const stmts = (await getPoolSongs())
    .filter((s) => s.isFavorite || (Array.isArray(s.groupIds) && s.groupIds.length))
    .map((s) => ({
      sql: 'INSERT OR IGNORE INTO song_meta (user_id, song_id, is_favorite, group_ids, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [adminId, String(s.id), s.isFavorite ? 1 : 0, JSON.stringify(s.groupIds ?? []), new Date(s.updatedAt || 0).toISOString()],
    }));
  if (stmts.length) await db.batch(stmts, 'write');
  await db.execute("INSERT OR IGNORE INTO app_flags (key) VALUES ('ownership_v1')");
}

// Gives every existing (non-guest) account its own copy of the songs it used to share. Accounts created
// afterwards start empty and add songs from the Lirika catalog or from the web.
async function migrateOwnCopies() {
  await authReady;
  const done = await db.execute("SELECT 1 FROM app_flags WHERE key = 'own_copies_v1'");
  if (done.rows.length) return;
  const guest = (process.env.VITE_GUEST_USERNAME || '').trim().toLowerCase();
  const { rows: users } = await db.execute('SELECT id, username FROM users');
  for (const u of users) {
    if (guest && String(u.username).toLowerCase() === guest) continue;
    await upsertUserSongs(String(u.id), await legacySharedView(String(u.id)));
  }
  await db.execute("INSERT OR IGNORE INTO app_flags (key) VALUES ('own_copies_v1')");
}

const dbReady = initDb().then(migrateOwnership).then(migrateOwnCopies);
dbReady.catch((err) => console.error('Turso init failed:', err));

// API: Healthcheck
// Reports whether the Turso database is configured and reachable (never returns secrets).
app.get('/api/health', async (_req, res) => {
  const url = process.env.TURSO_DATABASE_URL || '';
  const database: { configured: boolean; reachable: boolean; songs?: number; error?: string } = {
    configured: Boolean(url) && (Boolean(process.env.TURSO_AUTH_TOKEN) || url.startsWith('file:')),
    reachable: false,
  };
  try {
    await dbReady;
    const { rows } = await db.execute('SELECT COUNT(*) AS n FROM user_songs');
    database.reachable = true;
    database.songs = Number(rows[0].n);
  } catch (err: any) {
    database.error = String(err?.message || err).slice(0, 160);
  }
  res.status(database.reachable ? 200 : 503).json({
    status: database.reachable ? 'ok' : 'degraded',
    database,
    time: new Date().toISOString(),
  });
});

// API: Cloud sync pull
app.get('/api/sync/pull', async (req, res) => {
  try {
    await dbReady;
    res.json({ success: true, songs: await getSongsFor(me(req)), lastSyncAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error in sync pull:', err);
    res.status(500).json({ error: 'Error interno al leer de la nube' });
  }
});

// API: Cloud sync push & merge
app.post('/api/sync/push', async (req, res) => {
  try {
    const { songs } = req.body;
    if (!Array.isArray(songs)) {
      return res.status(400).json({ error: 'Formato inválido de canciones' });
    }

    await dbReady;
    await saveSongsFor(me(req), songs);
    const merged = await getSongsFor(me(req));
    res.json({ success: true, count: merged.length, lastSyncAt: new Date().toISOString(), songs: merged });
  } catch (err: any) {
    console.error('Error in sync push:', err);
    res.status(500).json({ error: 'Error interno al sincronizar con la nube' });
  }
});

// API: Lirika catalog search. Looks through the master songs, ignoring case and accents.
// It is listed first in the lyrics search; web engines follow.
const normalize = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

app.get('/api/songs/search', async (req, res) => {
  const q = normalize(String(req.query.q || '').trim());
  if (!q) return res.json({ results: [] });
  try {
    await dbReady;
    const words = q.split(/\s+/).filter(Boolean);
    const results = (await getMasterCatalog())
      .map((s) => {
        const head = normalize(`${s.title || ''} ${s.artist || ''}`);
        const haystack = `${head} ${normalize(s.lyrics || '')}`;
        const matches = words.every((w) => haystack.includes(w));
        // Title/artist hits first (full phrase best), lyrics-only hits last
        const score = head.includes(q) ? 0 : words.every((w) => head.includes(w)) ? 1 : 2;
        return { s, matches, score };
      })
      .filter((x) => x.matches)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.s)
      .slice(0, 20)
      .map((s) => ({
        id: `general_${s.id}`,
        songId: String(s.id),
        title: s.title || 'Sin título',
        artist: s.artist || 'Artista desconocido',
        album: s.album || '',
        plainLyrics: s.lyrics || '',
        // The copy a user receives starts clean: no favorite, no groups
        song: { ...s, isFavorite: false, groupIds: [], isMaster: true },
        source: 'lirika',
        needsFetch: false,
      }));
    res.json({ results });
  } catch (err) {
    console.error('Error in general search:', err);
    res.status(500).json({ error: 'No se pudo consultar la base de datos general', results: [] });
  }
});

// API: Song groups (folders). At most MAX_GROUPS per account; every account has its own.
const MAX_GROUPS = 5;
const GROUP_NAME_MAX = 20;

const groupName = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

app.get('/api/groups', async (req, res) => {
  try {
    await dbReady;
    const { rows } = await db.execute({
      sql: 'SELECT id, name, position FROM song_groups WHERE user_id = ? ORDER BY position ASC, created_at ASC',
      args: [me(req).id],
    });
    res.json({ groups: rows.map((r) => ({ id: String(r.id), name: String(r.name), position: Number(r.position) })) });
  } catch (err) {
    console.error('Error listing groups:', err);
    res.status(500).json({ error: 'No se pudieron leer los grupos' });
  }
});

app.post('/api/groups', async (req, res) => {
  const name = groupName(req.body?.name);
  if (!name || name.length > GROUP_NAME_MAX) {
    return res.status(400).json({ error: `El nombre debe tener entre 1 y ${GROUP_NAME_MAX} caracteres` });
  }
  try {
    await dbReady;
    const { rows } = await db.execute({ sql: 'SELECT name, position FROM song_groups WHERE user_id = ?', args: [me(req).id] });
    if (rows.length >= MAX_GROUPS) {
      return res.status(409).json({ error: `Máximo ${MAX_GROUPS} grupos` });
    }
    if (rows.some((r) => normalize(String(r.name)) === normalize(name)) || normalize(name) === 'favoritas') {
      return res.status(409).json({ error: 'Ya existe un grupo con ese nombre' });
    }
    const id = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const position = rows.reduce((m, r) => Math.max(m, Number(r.position)), -1) + 1;
    await db.execute({
      sql: 'INSERT INTO song_groups (id, name, position, created_at, user_id) VALUES (?, ?, ?, ?, ?)',
      args: [id, name, position, new Date().toISOString(), me(req).id],
    });
    res.status(201).json({ group: { id, name, position } });
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'No se pudo crear el grupo' });
  }
});

app.patch('/api/groups/:id', async (req, res) => {
  const name = groupName(req.body?.name);
  if (!name || name.length > GROUP_NAME_MAX) {
    return res.status(400).json({ error: `El nombre debe tener entre 1 y ${GROUP_NAME_MAX} caracteres` });
  }
  try {
    await dbReady;
    const { rows } = await db.execute({ sql: 'SELECT id, name, position FROM song_groups WHERE user_id = ?', args: [me(req).id] });
    const target = rows.find((r) => r.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Grupo no encontrado' });
    if (
      rows.some((r) => r.id !== target.id && normalize(String(r.name)) === normalize(name)) ||
      normalize(name) === 'favoritas'
    ) {
      return res.status(409).json({ error: 'Ya existe un grupo con ese nombre' });
    }
    await db.execute({ sql: 'UPDATE song_groups SET name = ? WHERE id = ? AND user_id = ?', args: [name, req.params.id, me(req).id] });
    res.json({ group: { id: String(target.id), name, position: Number(target.position) } });
  } catch (err) {
    console.error('Error renaming group:', err);
    res.status(500).json({ error: 'No se pudo renombrar el grupo' });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    await dbReady;
    await db.execute({ sql: 'DELETE FROM song_groups WHERE id = ? AND user_id = ?', args: [req.params.id, me(req).id] });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting group:', err);
    res.status(500).json({ error: 'No se pudo eliminar el grupo' });
  }
});

// API (admin): songs of the shared catalog that get preloaded into the guest account.
// Each pick is copied once into the guest's own catalog; unpicking later does not remove what was already copied.
app.get('/api/admin/guest-seed', requireAdmin, async (_req, res) => {
  try {
    await dbReady;
    const songs = (await getCatalogSongs())
      .map((s) => ({ id: String(s.id), title: s.title || 'Sin título', artist: s.artist || '' }))
      .sort((a, b) => a.title.localeCompare(b.title, 'es'));
    const { rows } = await db.execute('SELECT song_id FROM guest_seed');
    res.json({ songs, selected: rows.map((r) => String(r.song_id)) });
  } catch (err) {
    console.error('Error reading guest seed:', err);
    res.status(500).json({ error: 'No se pudo leer la lista de canciones' });
  }
});

app.put('/api/admin/guest-seed', requireAdmin, async (req, res) => {
  const ids: unknown = req.body?.ids;
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) {
    return res.status(400).json({ error: 'Formato inválido' });
  }
  try {
    await dbReady;
    await db.batch(
      [
        'DELETE FROM guest_seed',
        ...(ids as string[]).map((id) => ({ sql: 'INSERT OR IGNORE INTO guest_seed (song_id) VALUES (?)', args: [id] })),
      ],
      'write'
    );
    res.json({ success: true, count: ids.length });
  } catch (err) {
    console.error('Error saving guest seed:', err);
    res.status(500).json({ error: 'No se pudo guardar la selección' });
  }
});

// API: Lyrics search proxy (queries public LRCLIB API to avoid CORS and fallback)
app.get('/api/lyrics/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.trim().length === 0) {
    return res.json({ results: [] });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query.trim())}`;
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'LirikaLyricsApp/1.0 (https://ais-dev.run.app)',
      },
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const results = data.slice(0, 15).map((item: any) => ({
          id: `online_${item.id || Math.random().toString(36).substring(2, 9)}`,
          title: item.trackName || item.name || 'Sin título',
          artist: item.artistName || 'Artista desconocido',
          album: item.albumName || '',
          duration: item.duration || 0,
          plainLyrics: item.plainLyrics || '',
          syncedLyrics: item.syncedLyrics || '',
          source: 'lrclib',
        }));
        return res.json({ results });
      }
    }

    // Fallback to rich curated catalog if external API returns 0 or fails
    const fallbackResults = matchFallbackCatalog(query);
    return res.json({ results: fallbackResults });
  } catch (err) {
    // Return matching fallback catalog
    const fallbackResults = matchFallbackCatalog(query);
    return res.json({ results: fallbackResults });
  }
});

// ---- Web lyrics search (used by the "Buscar" modal) ----
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchWithTimeout(url: string, headers: Record<string, string> = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': BROWSER_UA, ...headers } });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

// Search a source. Returns { results, error? }
async function searchWebLyrics(source: string, q: string) {
  if (source === 'letras') {
    // Letras.com public autocomplete endpoint (JSONP)
    const r = await fetchWithTimeout(
      `https://solr.sscdn.co/letras/m1/?q=${encodeURIComponent(q)}&wt=json&callback=LetrasSug`
    );
    if (!r.ok) throw new Error(`Letras.com respondió ${r.status}`);
    const text = await r.text();
    const json = JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')));
    const docs: any[] = json?.response?.docs || [];
    return docs
      .filter((d) => d.t === '2' && d.dns && d.url) // t=2 → song entries
      .slice(0, 15)
      .map((d) => ({
        id: `letras_${d.id}`,
        title: String(d.txt || '').trim(),
        artist: d.art || '',
        source: 'letras',
        pageUrl: `https://www.letras.com/${d.dns}/${d.url}/`,
        needsFetch: true,
      }));
  }

  // LRCLIB (default): free, open lyrics database
  const r = await fetchWithTimeout(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`LRCLIB respondió ${r.status}`);
  const data = await r.json();
  return (Array.isArray(data) ? data : []).slice(0, 20).map((item: any) => ({
    id: `lrclib_${item.id}`,
    title: item.trackName || item.name || 'Sin título',
    artist: item.artistName || 'Artista desconocido',
    album: item.albumName || '',
    source: 'lrclib',
    plainLyrics: item.plainLyrics || '',
    syncedLyrics: item.syncedLyrics || '',
    needsFetch: false,
  }));
}

app.get('/api/lyrics/web-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const source = String(req.query.source || 'lrclib');
  if (!q) return res.json({ results: [] });
  try {
    res.json({ results: await searchWebLyrics(source, q) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'No se pudo consultar la fuente', results: [] });
  }
});

// Extract the lyrics text from a Letras.com song page
app.get('/api/lyrics/web-fetch', async (req, res) => {
  const pageUrl = String(req.query.url || '');
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return res.status(400).json({ error: 'URL inválida' });
  }
  // Only letras.com — prevents this endpoint from being used as an open proxy
  if (!/^(www\.)?letras\.com$/.test(parsed.hostname) || parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Fuente no permitida' });
  }
  try {
    const r = await fetchWithTimeout(parsed.toString(), { 'Accept-Language': 'es-ES,es;q=0.9' });
    if (!r.ok) {
      return res.status(502).json({
        blocked: true,
        error: `Letras.com bloqueó la descarga automática (${r.status}).`,
        pageUrl: parsed.toString(),
      });
    }
    const html = await r.text();
    const block = html.match(/<div class="lyric-original[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!block) {
      return res.status(502).json({ blocked: true, error: 'No se encontró la letra en la página.', pageUrl: parsed.toString() });
    }
    const lyrics = decodeEntities(
      block[1]
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    ).trim();
    res.json({ lyrics });
  } catch (err: any) {
    res.status(502).json({ blocked: true, error: 'No se pudo descargar la letra.', pageUrl: parsed.toString() });
  }
});

// Built-in catalog of iconic songs for search (pure lyrics with stanzas)
const CURATED_CATALOG = [
  {
    id: 'lamento-boliviano',
    title: 'Lamento Boliviano',
    artist: 'Los Enanitos Verdes',
    album: 'Big Yanqui (1994)',
    plainLyrics: `[Intro]\n(Introducción musical)\n\n[Verso 1]\nMe quieren agitar, me incitan a gritar\nSoy como una roca, palabras no me tocan\nAdentro hay un volcán que pronto va a estallar\nYo quiero estar tranquilo\n\n[Coro]\nY mi corazón idiota siempre brillará\nY yo te amaré, te amaré por siempre\nNena, no te peines en la cama\nQue los viajantes se van a atrasar\n\n[Solo]\n(Solo de guitarra)\n\n[Outro]\nY yo te amaré, te amaré por siempre`,
  },
  {
    id: 'flaca-calamaro',
    title: 'Flaca',
    artist: 'Andrés Calamaro',
    album: 'Alta Suciedad (1997)',
    plainLyrics: `[Intro]\n(Introducción acústica)\n\n[Verso 1]\nFlaca, no me claves tus puñales\nPor la espalda, tan profundo\nNo me duelen, no me hacen daño\nLejos en el centro de la Tierra\n\n[Coro]\nAunque casi te confieso que también\nHe sido un perro compañero\nUn perro de la calle\n\n[Verso 2]\nNo me mientas, no me digas la verdad\nNo te quedes callada\nNo levantes la voz, ni me pidas perdón`,
  },
  {
    id: 'camisa-negra',
    title: 'La Camisa Negra',
    artist: 'Juanes',
    album: 'Mi Sangre (2004)',
    plainLyrics: `[Intro]\n(Introducción rítmica)\n\n[Verso 1]\nTengo la camisa negra\nHoy mi amor está de luto\nHoy tengo en el alma una pena\nY es por culpa de tu embrujo\n\n[Coro]\nPor beber del veneno malevo de tu amor\nYo quedé moribundo y lleno de dolor\nTengo la camisa negra\nYa tu amor no me interesa\n\n[Verso 2]\nLo que ayer me supo a gloria\nHoy me sabe a pura...`,
  },
  {
    id: 'let-it-be',
    title: 'Let It Be',
    artist: 'The Beatles',
    album: 'Let It Be (1970)',
    plainLyrics: `[Intro]\n(Piano Introduction)\n\n[Verso 1]\nWhen I find myself in times of trouble\nMother Mary comes to me\nSpeaking words of wisdom, let it be\nAnd in my hour of darkness she is standing right in front of me\nSpeaking words of wisdom, let it be\n\n[Coro]\nLet it be, let it be, let it be, let it be\nWhisper words of wisdom, let it be\n\n[Verso 2]\nAnd when the broken hearted people living in the world agree\nThere will be an answer, let it be`,
  },
  {
    id: 'wonderwall',
    title: 'Wonderwall',
    artist: 'Oasis',
    album: '(What\'s the Story) Morning Glory? (1995)',
    plainLyrics: `[Intro]\n(Acoustic guitar intro)\n\n[Verso 1]\nToday is gonna be the day\nThat they're gonna throw it back to you\nBy now you should've somehow\nRealized what you gotta do\nI don't believe that anybody feels the way I do\nAbout you now\n\n[Pre-Coro]\nAnd all the roads we have to walk are winding\nAnd all the lights that lead us there are blinding\nThere are many things that I would like to say to you\nBut I don't know how\n\n[Coro]\nBecause maybe\nYou're gonna be the one that saves me\nAnd after all\nYou're my wonderwall`,
  },
];

function matchFallbackCatalog(query: string) {
  const q = query.toLowerCase().trim();
  return CURATED_CATALOG.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.artist.toLowerCase().includes(q) ||
      item.plainLyrics.toLowerCase().includes(q)
  );
}

export default app;
