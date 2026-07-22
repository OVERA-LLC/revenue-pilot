// Booking Curve backend server
// - Serves the frontend (public/index.html) as static files
// - Stores all booking-curve data in a JSON file on the server (data/all_data.json)
//   so every device/user hitting this server sees the SAME data.
// - No native modules (no SQLite build step) so it runs anywhere Node.js runs.
//
// Run:   npm install && npm start
// Then open http://<this-machine's-ip>:3000 from any device on the network.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
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

// Merge in new snapshot points from a client-side Excel import.
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

// ---- static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`Revenue Pilot server running: http://localhost:${PORT}`);
    if (API_KEY) console.log('API key auth is ENABLED for /api routes.');
  });
  return server;
}

module.exports = startServer;

// "node server.js" で直接実行したときは、そのまま起動する
if (require.main === module) {
  startServer();
}