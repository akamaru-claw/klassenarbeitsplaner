'use strict';
/*
 * Klassenarbeitsplaner – Server
 * Node.js ab Version 20, keine npm-Pakete. Daten: DATA_DIR/db.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const KAP = require('./public/core.js');

// ------------------------------------------------------------ Konfiguration
const PORT = +process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== '0';
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS || "'self'";
const STAFF_DAYS = +process.env.STAFF_SESSION_DAYS || 180;
const ADMIN_HOURS = 8;

if (ADMIN_PASSWORD.length < 10) {
  console.error('ADMIN_PASSWORD fehlt oder ist kürzer als 10 Zeichen.');
  process.exit(1);
}
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
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const a = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

if (!db.auth.staff) {
  const pw = process.env.KOLLEGIUM_PASSWORD || '';
  if (pw.length < 6) {
    console.error('Beim ersten Start KOLLEGIUM_PASSWORD setzen (mind. 6 Zeichen). Später lässt es sich in der Verwaltung ändern.');
    process.exit(1);
  }
  db.auth.staff = hashPassword(pw);
  db.auth.gen = 1;
}

function save() {
  const today = new Date().toISOString().slice(0, 10);
  const backup = path.join(BACKUP_DIR, `db-${today}.json`);
  if (fs.existsSync(DB_FILE) && !fs.existsSync(backup)) {
    fs.copyFileSync(DB_FILE, backup);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -60);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
save();

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
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (COOKIE_SECURE ? '; Secure' : '');
}
function roleOf(req) {
  const c = cookies(req);
  const staff = readToken(c.kap);
  if (!staff) return null;
  const admin = readToken(c.kapa);
  return admin && admin.r === 'admin' ? 'admin' : 'staff';
}

// ------------------------------------------------ Schutz vor Rateversuchen
const attempts = new Map();
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) { attempts.set(ip, { n: 1, reset: now + 15 * 60e3 }); return false; }
  a.n++;
  return a.n > 10;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k); }, 10 * 60e3).unref();

// --------------------------------------------------------------- Antworten
function security(res) {
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; ` +
    `object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${FRAME_ANCESTORS}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
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
    // CSRF: eigener Header (erzwingt Same-Origin) und Herkunftsprüfung
    if (req.headers['x-requested-with'] !== 'kap') return sendJSON(res, 403, { error: 'Anfrage abgelehnt.' });
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return sendJSON(res, 403, { error: 'Anfrage abgelehnt.' }); }
      catch { return sendJSON(res, 403, { error: 'Anfrage abgelehnt.' }); }
    }
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
    if (tooManyAttempts(ip)) return sendJSON(res, 429, { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut probieren.' });
    const pw = String(body.password || '');
    if (body.role === 'admin') {
      if (!role) return sendJSON(res, 401, { error: 'Bitte zuerst anmelden.' });
      if (!sameSecret(pw, ADMIN_PASSWORD)) return sendJSON(res, 401, { error: 'Das Passwort für die Verwaltung stimmt nicht.' });
      attempts.delete(ip);
      return sendJSON(res, 200, { role: 'admin' }, { 'Set-Cookie': cookie('kapa', makeToken('admin', ADMIN_HOURS * 3600e3), ADMIN_HOURS * 3600) });
    }
    if (!verifyPassword(pw, db.auth.staff)) return sendJSON(res, 401, { error: 'Das Passwort stimmt nicht.' });
    attempts.delete(ip);
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
    db.log.push({ t: new Date().toISOString(), who: 'Verwaltung', text: 'Kollegiums-Passwort geändert, alle Geräte abgemeldet' });
    save();
    // Die eigene Sitzung bleibt bestehen
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': [
      cookie('kap', makeToken('staff', STAFF_DAYS * 864e5), STAFF_DAYS * 86400),
      cookie('kapa', makeToken('admin', ADMIN_HOURS * 3600e3), ADMIN_HOURS * 3600)
    ] });
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
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon'
};
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/' || rel === '/index.html') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    const ext = path.extname(file);
    const tag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    const longCache = ext === '.woff2' || ext === '.png';
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=2592000' : 'no-cache',
      ETag: tag
    };
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, headers); return res.end(); }
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
server.listen(PORT, () => console.log(`Klassenarbeitsplaner läuft auf Port ${PORT}, Daten in ${DATA_DIR}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
