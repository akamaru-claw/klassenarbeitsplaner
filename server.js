'use strict';
/*
 * Klassenarbeitsplaner – Server
 * Node.js ab Version 20, keine npm-Pakete. Daten: DATA_DIR/db.json
 * Konfiguration über Umgebungsvariablen oder eine .env-Datei im Projektordner.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// ---------------------------------------------------------------- .env
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const KAP = require('./public/core.js');
const qrcode = require('./lib/qrcode-generator.js');

// ------------------------------------------------------------ Konfiguration
const PORT = +process.env.PORT || 3020;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://klassenarbeiten.mauri-tools.de').replace(/\/+$/, '');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const QR_FILE = path.join(PUBLIC_DIR, 'img', 'qr-login.png');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== '0';
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS || "'self'";
const STAFF_DAYS = +process.env.STAFF_SESSION_DAYS || 180;
const ADMIN_HOURS = 8;

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.warn('Hinweis: SESSION_SECRET fehlt (mind. 32 Zeichen). Anmeldungen gelten dann nur bis zum nächsten Neustart.');
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------- Daten
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : KAP.newDatabase();
KAP.migrate(db);
db.auth = db.auth || {};

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const a = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Verwaltung: ADMIN_PASSWORD ist maßgeblich, gespeichert wird nur der Hash.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (ADMIN_PASSWORD) {
  if (ADMIN_PASSWORD.length < 10) { console.error('ADMIN_PASSWORD ist kürzer als 10 Zeichen.'); process.exit(1); }
  if (!verifyPassword(ADMIN_PASSWORD, db.auth.admin)) db.auth.admin = hashPassword(ADMIN_PASSWORD);
} else if (!db.auth.admin) {
  console.error('ADMIN_PASSWORD fehlt (in .env oder als Umgebungsvariable).');
  process.exit(1);
}

// Kollegium: KOLLEGIUM_PASSWORD gilt beim ersten Start, danach über die Verwaltung änderbar.
const KOLLEGIUM_PASSWORD = process.env.KOLLEGIUM_PASSWORD || '';
if (!db.auth.staff) {
  if (KOLLEGIUM_PASSWORD.length < 6) {
    console.error('Beim ersten Start KOLLEGIUM_PASSWORD setzen (mind. 6 Zeichen). Später lässt es sich in der Verwaltung ändern.');
    process.exit(1);
  }
  db.auth.staff = hashPassword(KOLLEGIUM_PASSWORD);
  db.auth.gen = 1;
}
db.auth.gen = db.auth.gen || 1;

function save() {
  const today = new Date().toISOString().slice(0, 10);
  const backup = path.join(BACKUP_DIR, `db-${today}.json`);
  if (fs.existsSync(DB_FILE) && !fs.existsSync(backup)) {
    fs.copyFileSync(DB_FILE, backup);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -60);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
save();

// ------------------------------------------------------------ QR-Code (PNG)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function qrPng(text, scale, margin) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), size = (n + 2 * margin) * scale;
  const raw = Buffer.alloc((size + 1) * size, 255);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - margin;
      if (my >= 0 && mx >= 0 && my < n && mx < n && qr.isDark(my, mx)) raw[y * (size + 1) + 1 + x] = 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
const loginUrl = pw => `${PUBLIC_URL}/?login=${encodeURIComponent(pw)}`;
function writeQR(pw) {
  try { fs.writeFileSync(QR_FILE, qrPng(loginUrl(pw), 12, 4)); }
  catch (e) { console.warn('QR-Code konnte nicht geschrieben werden:', e.message); }
}
// Klartext kennt der Server nur aus der .env oder beim Ändern in der Verwaltung.
if (KOLLEGIUM_PASSWORD && verifyPassword(KOLLEGIUM_PASSWORD, db.auth.staff)) writeQR(KOLLEGIUM_PASSWORD);
else if (!fs.existsSync(QR_FILE)) console.warn('Kein QR-Code erzeugt: KOLLEGIUM_PASSWORD fehlt oder passt nicht zum gespeicherten Passwort. Neu setzen in der Verwaltung.');

// ------------------------------------------------------------- Sitzungen
const b64 = s => Buffer.from(s).toString('base64url');
const sign = s => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('base64url');

function makeToken(role, ms) {
  const payload = b64(JSON.stringify({ r: role, e: Date.now() + ms, g: db.auth.gen }));
  return payload + '.' + sign(payload);
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [payload, sig] = tok.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (t.e < Date.now() || t.g !== db.auth.gen) return null;
    return t;
  } catch { return null; }
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignorieren */ } }
  }
  return out;
}
function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (COOKIE_SECURE ? '; Secure' : '');
}
function roleOf(req) {
  const c = cookies(req);
  if (!readToken(c.kap)) return null;
  const admin = readToken(c.kapa);
  return admin && admin.r === 'admin' ? 'admin' : 'staff';
}

// ------------------------------------------------ Schutz vor Rateversuchen
// Zählt nur Fehlversuche. Großzügig, weil die ganze Schule oft über eine IP ins Netz geht.
const failures = new Map();
const MAX_FAILURES = 20;
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}
function isLocked(ip) { const f = failures.get(ip); return !!f && f.reset > Date.now() && f.n >= MAX_FAILURES; }
function noteFailure(ip) {
  const now = Date.now(), f = failures.get(ip);
  if (!f || f.reset < now) failures.set(ip, { n: 1, reset: now + 15 * 60e3 }); else f.n++;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of failures) if (v.reset < now) failures.delete(k); }, 10 * 60e3).unref();

// --------------------------------------------------------------- Antworten
function security(res) {
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; ` +
    `object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${FRAME_ANCESTORS}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
function sendJSON(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Zu groß'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Ungültige Daten'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ API
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (m !== 'GET' && m !== 'HEAD') {
    // Herkunftsprüfung für alle schreibenden Anfragen
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return sendJSON(res, 403, { error: 'Anfrage abgelehnt.' }); }
      catch { return sendJSON(res, 403, { error: 'Anfrage abgelehnt.' }); }
    }
    // Eigener Header erzwingt Same-Origin. Ausnahme: Anmeldung (das Konto ist ohnehin gemeinsam).
    if (p !== '/api/login' && req.headers['x-requested-with'] !== 'kap') return sendJSON(res, 403, { error: 'Anfrage abgelehnt.' });
  }

  let body = {};
  if (m === 'POST' || m === 'PUT' || m === 'DELETE') {
    try { body = await readBody(req, 4 * 1024 * 1024); }
    catch (e) { return sendJSON(res, e.status || 400, { error: e.status === 413 ? 'Die Daten sind zu groß.' : 'Ungültige Daten.' }); }
  }

  const role = roleOf(req);

  if (m === 'GET' && p === '/api/session') return sendJSON(res, 200, { role });

  if (m === 'POST' && p === '/api/login') {
    const ip = clientIp(req);
    if (isLocked(ip)) return sendJSON(res, 429, { error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut probieren.' });
    const pw = String(body.password || '');
    if (body.role === 'admin') {
      if (!role) return sendJSON(res, 401, { error: 'Bitte zuerst anmelden.' });
      if (!verifyPassword(pw, db.auth.admin)) { noteFailure(ip); return sendJSON(res, 401, { error: 'Das Passwort für die Verwaltung stimmt nicht.' }); }
      return sendJSON(res, 200, { role: 'admin' }, { 'Set-Cookie': cookie('kapa', makeToken('admin', ADMIN_HOURS * 3600e3), ADMIN_HOURS * 3600) });
    }
    if (!verifyPassword(pw, db.auth.staff)) { noteFailure(ip); return sendJSON(res, 401, { error: 'Das Passwort stimmt nicht.' }); }
    return sendJSON(res, 200, { role: 'staff' }, { 'Set-Cookie': cookie('kap', makeToken('staff', STAFF_DAYS * 864e5), STAFF_DAYS * 86400) });
  }

  if (m === 'POST' && p === '/api/logout') {
    return sendJSON(res, 200, { role: null }, { 'Set-Cookie': [cookie('kap', '', 0), cookie('kapa', '', 0)] });
  }
  if (m === 'POST' && p === '/api/admin/logout') {
    return sendJSON(res, 200, { role: role ? 'staff' : null }, { 'Set-Cookie': cookie('kapa', '', 0) });
  }

  if (m === 'PUT' && p === '/api/admin/password') {
    if (role !== 'admin') return sendJSON(res, role ? 403 : 401, { error: 'Nur für die Verwaltung.' });
    const pw = String(body.password || '');
    if (pw.length < 6) return sendJSON(res, 400, { error: 'Das neue Passwort braucht mindestens 6 Zeichen.' });
    db.auth.staff = hashPassword(pw);
    db.auth.gen = (db.auth.gen || 1) + 1;
    db.log.push({ t: new Date().toISOString(), who: 'Verwaltung', text: 'Kollegiums-Passwort geändert, alle Geräte abgemeldet, QR-Code erneuert' });
    save();
    writeQR(pw);
    // Die eigene Sitzung bleibt bestehen
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': [
      cookie('kap', makeToken('staff', STAFF_DAYS * 864e5), STAFF_DAYS * 86400),
      cookie('kapa', makeToken('admin', ADMIN_HOURS * 3600e3), ADMIN_HOURS * 3600)
    ] });
  }

  if (m === 'GET' && p === '/api/admin/qr') {
    if (role !== 'admin') return sendJSON(res, role ? 403 : 401, { error: 'Nur für die Verwaltung.' });
    return sendJSON(res, 200, { exists: fs.existsSync(QR_FILE), url: PUBLIC_URL });
  }

  const etag = `"v${db.version}"`;
  if (m === 'GET' && p === '/api/state' && role && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
    return res.end();
  }

  let who = '';
  try { who = decodeURIComponent(req.headers['x-kuerzel'] || ''); } catch { /* ignorieren */ }
  const r = KAP.handle(db, { method: m, path: p, body, role, who, now: new Date().toISOString() });
  if (r.changed) save();
  const headers = (m === 'GET' && p === '/api/state' && r.status === 200) ? { ETag: `"v${db.version}"`, 'Cache-Control': 'no-cache' } : undefined;
  return sendJSON(res, r.status, r.body, headers);
}

// --------------------------------------------------------- Statische Dateien
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon'
};
const NO_STORE = 'no-store, no-cache, must-revalidate';
const VERSIONED = ['app.css', 'core.js', 'app.js'];

function assetVersion(name) {
  try { const st = fs.statSync(path.join(PUBLIC_DIR, name)); return st.size.toString(36) + Math.floor(st.mtimeMs).toString(36); }
  catch { return '0'; }
}
function sendIndex(req, res) {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  for (const name of VERSIONED) {
    html = html.replace(new RegExp(`(["'/])${name.replace('.', '\\.')}(\\?v=[^"']*)?(["'])`, 'g'), `$1${name}?v=${assetVersion(name)}$3`);
  }
  const buf = Buffer.from(html);
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': NO_STORE, 'Content-Length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/' || rel === '/index.html') return sendIndex(req, res);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  // Der QR-Code enthält das Kollegiums-Passwort: nur für angemeldete Geräte
  const secret = file === QR_FILE;
  if (secret && !roleOf(req)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    const ext = path.extname(file);
    const tag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const longCache = !secret && (ext === '.woff2' || ext === '.png' || ext === '.jpg');
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': secret ? 'private, no-store' : longCache ? 'public, max-age=2592000' : NO_STORE,
      ETag: tag
    };
    if (longCache && req.headers['if-none-match'] === tag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ------------------------------------------------------------------ Start
const server = http.createServer(async (req, res) => {
  try {
    security(res);
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Interner Fehler. Bitte später erneut versuchen.' });
    else res.end();
  }
});
server.listen(PORT, HOST, () => console.log(`Klassenarbeitsplaner läuft auf http://${HOST}:${PORT}, Daten in ${DATA_DIR}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
