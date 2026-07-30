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
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
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
});

// Wipe all data (used by the "保存データを全消去" button)
app.delete('/api/data', async (req, res) => {
  await queueWrite(DATA_FILE, {});
  res.json({ ok: true });
});

app.get('/api/settings', (req, res) => {
  res.json(readJSON(SETTINGS_FILE));
});

app.post('/api/settings', async (req, res) => {
  const settings = req.body || {};
  await queueWrite(SETTINGS_FILE, settings);
  res.json({ ok: true });
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
  const filename = `csv_${Date.now()}.csv`;
  fs.writeFileSync(path.join(INCOMING_DIR, filename), req.body, 'utf-8');
  res.json({ ok: true, filename });
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

// ---- static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Revenue Pilot server running: http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (API_KEY) console.log('API key auth is ENABLED for /api routes.');
});
