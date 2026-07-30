// Revenue Pilot (by OVERA) — backend server
// - Serves the frontend (public/index.html) as static files
// - Stores all booking-curve data in a JSON file so every device/user hitting this server sees the SAME data.
// - No native modules (no SQLite build step) so it runs anywhere Node.js runs.
//
// Run:   npm install && npm start
// Then open http://<this-machine's-ip>:3000 from any device on the network.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Data must live in a WRITABLE location. Inside a packaged Electron app, __dirname points into
// app.asar, which is read-only — writing there throws ENOTDIR/EROFS. When running inside Electron
// we use the OS's proper per-user app-data folder instead; when run as plain `node server.js`
// (no Electron), we fall back to a local ./data folder next to this file.
let baseDir;
try {
  const { app: electronApp } = require('electron');
  baseDir = electronApp.getPath('userData');
} catch (e) {
  baseDir = __dirname;
}

const DATA_DIR = path.join(baseDir, 'data');
const DATA_FILE = path.join(DATA_DIR, 'all_data.json');
const DATA_GROSS_FILE = path.join(DATA_DIR, 'all_data_gross.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
if (!fs.existsSync(DATA_GROSS_FILE)) fs.writeFileSync(DATA_GROSS_FILE, '{}');
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ capacity: 68 }));

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (e) { return {}; }
}

// Serialize writes so two near-simultaneous uploads never corrupt the file
// (each write waits for the previous one to finish; last one wins on conflicting keys).
let writeChain = Promise.resolve();
function queueWrite(file, data) {
  writeChain = writeChain.then(() => fs.promises.writeFile(file, JSON.stringify(data)));
  return writeChain;
}

app.use(express.json({ limit: '20mb' }));

// Optional shared API key. Leave BOOKING_CURVE_KEY unset for open LAN/internal use.
const API_KEY = process.env.BOOKING_CURVE_KEY || '';
app.use('/api', (req, res, next) => {
  if (!API_KEY) return next();
  if (req.header('x-api-key') !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
});

// ---- API ----

// Full dataset: { [stayISO]: { [snapshotISO]: {rooms,sales,adr,revpar} } }
app.get('/api/data', (req, res) => {
  res.json(readJSON(DATA_FILE));
});

// Merge in new snapshot points from a client-side Excel/CSV import.
// body: { points: [{ stayISO, snapshotISO, rooms, sales, adr, revpar }, ...] }
app.post('/api/data', async (req, res) => {
  const { points } = req.body || {};
  if (!Array.isArray(points)) return res.status(400).json({ error: 'points array required' });

  try {
    const data = readJSON(DATA_FILE);
    for (const p of points) {
      if (!p || !p.stayISO || !p.snapshotISO) continue;
      if (!data[p.stayISO]) data[p.stayISO] = {};
      data[p.stayISO][p.snapshotISO] = {
        rooms: Number(p.rooms) || 0,
        sales: Number(p.sales) || 0,
        adr: Number(p.adr) || 0,
        revpar: Number(p.revpar) || 0
      };
    }
    await queueWrite(DATA_FILE, data);
    res.json({ ok: true, merged: points.length });
  } catch (err) {
    console.error('POST /api/data failed:', err);
    res.status(500).json({ error: 'save failed', message: err.message });
  }
});

// Wipe all data (used by the "保存データを全消去" button)
app.delete('/api/data', async (req, res) => {
  try {
    await queueWrite(DATA_FILE, {});
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/data failed:', err);
    res.status(500).json({ error: 'delete failed', message: err.message });
  }
});

// ---- gross (cancellation-inclusive) dataset, for "total demand" analysis alongside the
// normal on-the-books curve. Same shape and merge behavior as /api/data. ----
app.get('/api/data-gross', (req, res) => {
  res.json(readJSON(DATA_GROSS_FILE));
});

app.post('/api/data-gross', async (req, res) => {
  const { points } = req.body || {};
  if (!Array.isArray(points)) return res.status(400).json({ error: 'points array required' });

  try {
    const data = readJSON(DATA_GROSS_FILE);
    for (const p of points) {
      if (!p || !p.stayISO || !p.snapshotISO) continue;
      if (!data[p.stayISO]) data[p.stayISO] = {};
      data[p.stayISO][p.snapshotISO] = {
        rooms: Number(p.rooms) || 0,
        sales: Number(p.sales) || 0,
        adr: Number(p.adr) || 0,
        revpar: Number(p.revpar) || 0
      };
    }
    await queueWrite(DATA_GROSS_FILE, data);
    res.json({ ok: true, merged: points.length });
  } catch (err) {
    console.error('POST /api/data-gross failed:', err);
    res.status(500).json({ error: 'save failed', message: err.message });
  }
});

app.delete('/api/data-gross', async (req, res) => {
  try {
    await queueWrite(DATA_GROSS_FILE, {});
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/data-gross failed:', err);
    res.status(500).json({ error: 'delete failed', message: err.message });
  }
});

app.get('/api/settings', (req, res) => {
  res.json(readJSON(SETTINGS_FILE));
});

app.post('/api/settings', async (req, res) => {
  const settings = req.body || {};
  try {
    await queueWrite(SETTINGS_FILE, settings);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/settings failed:', err);
    res.status(500).json({ error: 'save failed', message: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- CSV intake (for the Lincoln bookmarklet to POST directly, bypassing manual download/upload) ----
// CORS is enabled ONLY on these routes since the bookmarklet runs on a different origin (the Lincoln
// site itself). The raw CSV is just staged on disk here; the frontend picks it up, parses it with the
// existing browser-side CSV parser, and merges it in — no server-side duplicate of the parsing logic.
function allowCors(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
}

const INCOMING_DIR = path.join(DATA_DIR, 'incoming');
if (!fs.existsSync(INCOMING_DIR)) fs.mkdirSync(INCOMING_DIR, { recursive: true });

app.options('/api/csv/incoming', allowCors);
app.post('/api/csv/incoming', allowCors, express.text({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const filename = `csv_${Date.now()}.csv`;
    fs.writeFileSync(path.join(INCOMING_DIR, filename), req.body, 'utf-8');
    res.json({ ok: true, filename });
  } catch (err) {
    console.error('POST /api/csv/incoming failed:', err);
    res.status(500).json({ error: 'save failed', message: err.message });
  }
});

app.get('/api/csv/incoming', allowCors, (req, res) => {
  const files = fs.readdirSync(INCOMING_DIR).filter(f => f.endsWith('.csv')).sort();
  res.json({ files });
});

app.options('/api/csv/incoming/:filename', allowCors);
app.get('/api/csv/incoming/:filename', allowCors, (req, res) => {
  const p = path.join(INCOMING_DIR, req.params.filename);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.type('text/plain; charset=utf-8').send(fs.readFileSync(p, 'utf-8'));
});

app.delete('/api/csv/incoming/:filename', allowCors, (req, res) => {
  const p = path.join(INCOMING_DIR, req.params.filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ---- reservation-number intake (richer, more robust alternative to the CSV path: keyed by
// 予約番号 instead of name+checkin, scraped from the Lincoln search-results screen). Runs
// alongside the CSV intake above — neither replaces the other. ----
const INCOMING_RES_DIR = path.join(DATA_DIR, 'incoming_reservations');
if (!fs.existsSync(INCOMING_RES_DIR)) fs.mkdirSync(INCOMING_RES_DIR, { recursive: true });

app.options('/api/reservations/incoming', allowCors);
app.post('/api/reservations/incoming', allowCors, express.json({ limit: '20mb' }), (req, res) => {
  try {
    const filename = `res_${Date.now()}.json`;
    fs.writeFileSync(path.join(INCOMING_RES_DIR, filename), JSON.stringify(req.body), 'utf-8');
    res.json({ ok: true, filename });
  } catch (err) {
    console.error('POST /api/reservations/incoming failed:', err);
    res.status(500).json({ error: 'save failed', message: err.message });
  }
});

app.get('/api/reservations/incoming', allowCors, (req, res) => {
  const files = fs.readdirSync(INCOMING_RES_DIR).filter(f => f.endsWith('.json')).sort();
  res.json({ files });
});

app.options('/api/reservations/incoming/:filename', allowCors);
app.get('/api/reservations/incoming/:filename', allowCors, (req, res) => {
  const p = path.join(INCOMING_RES_DIR, req.params.filename);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.type('application/json; charset=utf-8').send(fs.readFileSync(p, 'utf-8'));
});

app.delete('/api/reservations/incoming/:filename', allowCors, (req, res) => {
  const p = path.join(INCOMING_RES_DIR, req.params.filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ---- static frontend ----
// Disable caching entirely for the frontend. Without this, Electron's Chromium engine can keep
// serving a stale cached copy of index.html/app.js across app UPDATES, since the URL is always
// the same (http://localhost:3000/) even though the underlying files changed between versions.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }));

function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`Revenue Pilot server running: http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    if (API_KEY) console.log('API key auth is ENABLED for /api routes.');
  });
  return server;
}

module.exports = startServer;
