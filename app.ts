import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';

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

async function getSongs(): Promise<any[]> {
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

const dbReady = initDb();
dbReady.catch((err) => console.error('Turso init failed:', err));

// API: Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API: Cloud sync pull
app.get('/api/sync/pull', async (_req, res) => {
  try {
    await dbReady;
    res.json({ success: true, songs: await getSongs(), lastSyncAt: new Date().toISOString() });
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
    await upsertSongs(songs);
    const merged = await getSongs();
    res.json({ success: true, count: merged.length, lastSyncAt: new Date().toISOString(), songs: merged });
  } catch (err: any) {
    console.error('Error in sync push:', err);
    res.status(500).json({ error: 'Error interno al sincronizar con la nube' });
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
