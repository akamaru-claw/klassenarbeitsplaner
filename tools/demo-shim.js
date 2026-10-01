/* Demo-Modus: beantwortet /api/* direkt im Browser mit derselben Logik wie der Server. */
(function () {
  'use strict';
  const K = window.KAP;
  window.KAP_DEMO = true;
  const db = K.newDatabase();
  db.entries = window.KAP_DEMO_DATA(K, db.settings);
  let role = 'staff';
  const json = (status, body, headers) => new Response(body === undefined ? null : JSON.stringify(body),
    { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, opts);
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    const headers = opts.headers || {};
    let body = {};
    try { body = opts.body ? JSON.parse(opts.body) : {}; } catch (e) { return json(400, { error: 'Ungültige Daten.' }); }
    const path = url.split('?')[0];
    await new Promise(r => setTimeout(r, 40));
    if (path === '/api/session') return json(200, { role });
    if (path === '/api/login') {
      if (body.role === 'admin') {
        if (body.password !== 'demo') return json(401, { error: 'Das Passwort stimmt nicht. In der Demo lautet es „demo“.' });
        role = 'admin'; return json(200, { role });
      }
      role = 'staff'; return json(200, { role });
    }
    if (path === '/api/logout') { role = null; return json(200, { role: null }); }
    if (path === '/api/admin/logout') { role = 'staff'; return json(200, { role }); }
    if (path === '/api/admin/password') return role === 'admin' ? json(200, { ok: true }) : json(403, { error: 'Nur für die Verwaltung.' });
    if (path === '/api/state' && method === 'GET' && headers['If-None-Match'] === `"v${db.version}"`) return new Response(null, { status: 304 });
    let who = '';
    try { who = decodeURIComponent(headers['X-Kuerzel'] || ''); } catch (e) { /* egal */ }
    const r = K.handle(db, { method, path, body, role, who, now: new Date().toISOString() });
    return json(r.status, r.body, path === '/api/state' ? { ETag: `"v${db.version}"` } : undefined);
  };
})();
