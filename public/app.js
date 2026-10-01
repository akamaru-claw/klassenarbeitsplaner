/* Klassenarbeitsplaner – Oberfläche */
'use strict';
(function () {
  const K = window.KAP;
  const DEMO = !!window.KAP_DEMO;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('kap.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kap.' + k, JSON.stringify(v)); } catch (e) { /* egal */ } }
  };
  const isSmall = () => matchMedia('(max-width: 720px)').matches;

  const S = {
    role: null, state: null, etag: null, idx: null,
    view: store.get('view', isSmall() ? 'klasse' : 'plan'),
    grade: store.get('grade', 'alle'),
    cls: store.get('cls', ''),
    me: store.get('me', ''),
    mineScope: 'kommend',
    adminTab: 'kalender',
    hintClosed: store.get('hint', false),
    needScroll: true,
    jumpTo: null,
    editor: null
  };
  if (S.view === 'admin') S.view = 'plan';

  // ------------------------------------------------------------ Server
  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'kap', 'X-Kuerzel': encodeURIComponent(S.me || '') } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opts); }
    catch (e) { throw Object.assign(new Error('Keine Verbindung zum Server. Bitte die Internetverbindung prüfen.'), { status: 0 }); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* leer */ }
    if (res.status === 401 && path !== '/api/login') { S.role = null; renderLogin(); }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `Fehler ${res.status}`), { status: res.status, data });
    return data;
  }

  async function loadState(force) {
    const headers = { 'X-Requested-With': 'kap' };
    if (!force && S.etag) headers['If-None-Match'] = S.etag;
    let res;
    try { res = await fetch('/api/state', { headers, credentials: 'same-origin', cache: 'no-store' }); } catch (e) { return false; }
    if (res.status === 304) return false;
    if (res.status === 401) { S.role = null; renderLogin(); return false; }
    if (!res.ok) return false;
    S.state = await res.json();
    S.etag = res.headers.get('ETag');
    S.idx = null;
    return true;
  }
  async function refresh(force) {
    if (!S.role) return;
    const changed = await loadState(force);
    if (changed && $('#main')) { renderView(true); if (S.editor) S.editor.update(); }
  }
  setInterval(() => { if (S.role && document.visibilityState === 'visible') refresh(false); }, 30000);
  document.addEventListener('visibilitychange', () => { if (S.role && document.visibilityState === 'visible') refresh(false); });

  // ------------------------------------------------------------ Hilfen
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  const longDate = d => `${K.WD[K.dow(d)]} ${K.fmtDate(d)}`;
  function grades() {
    const out = [];
    for (const c of S.state.settings.classes) { const g = K.grade(c); if (!out.includes(g)) out.push(g); }
    return out;
  }
  function visibleClasses() {
    const cs = S.state.settings.classes;
    return S.grade === 'alle' ? cs : cs.filter(c => K.grade(c) === S.grade);
  }
  function indexState() {
    const st = S.state;
    if (S.idx && S.idx.v === st.version && S.idx.n === st.entries.length) return S.idx;
    const ka = new Map(), term = new Map(), byId = new Map();
    const push = (m, k, e) => { const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); };
    for (const e of st.entries) {
      byId.set(e.id, e);
      if (e.type === 'termin') {
        for (let d = e.date; d <= (e.dateTo || e.date); d = K.addDays(d, 1)) for (const c of e.classes) push(term, d + '|' + c, e);
      } else for (const c of e.classes) push(ka, e.date + '|' + c, e);
    }
    S.idx = { v: st.version, n: st.entries.length, ka, term, byId, wk: K.weekCounts(st.entries) };
    return S.idx;
  }
  function slots(n, max) {
    let s = '';
    for (let i = 0; i < Math.max(n, max); i++) s += `<i class="${i < n ? (i >= max ? 'x' : 'on') : ''}"></i>`;
    return `<span class="sl" aria-hidden="true">${s}</span><span class="sr">${n} von ${max}</span>`;
  }
  function chip(e, forPrint) {
    const set = S.state.settings;
    const mine = !forPrint && S.me && e.teacher === S.me;
    const t = [K.subjectName(set, e.subject), e.teacher, e.classes.length > 1 ? 'gemeinsam: ' + e.classes.join(', ') : '', e.note]
      .filter(Boolean).join(', ') + (e.reason ? `. Ausnahme: ${e.reason}` : '');
    return `<button type="button" class="chip${e.reason ? ' ex' : ''}${mine ? ' mine' : ''}" data-id="${esc(e.id)}" title="${esc(t)}"><b>${esc(e.subject)}</b><small>${esc(e.teacher)}</small></button>`;
  }
  function closeDialog() {
    const d = $('#dlg');
    if (d.open) d.close();
    S.editor = null;
  }
  $('#dlg').addEventListener('close', () => { S.editor = null; });

  // ------------------------------------------------------------ Start
  async function boot() {
    // Auto-Login via QR-Code (?login=Passwort)
    const params = new URLSearchParams(location.search);
    const autoPw = params.get('login');
    if (autoPw) {
      try {
        await api('POST', '/api/login', { password: autoPw, role: 'staff' });
        S.role = 'staff';
        params.delete('login');
        history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params.toString() : ''));
        await startApp();
        toast('Automatisch angemeldet.');
        return;
      } catch (e) { /* fall through to normal login */ }
    }
    try { S.role = (await api('GET', '/api/session')).role; } catch (e) { S.role = null; }
    if (!S.role) return renderLogin();
    await startApp();
  }
  async function startApp() {
    await loadState(true);
    if (!S.state) {
      $('#app').innerHTML = '<p class="booting">Der Plan konnte nicht geladen werden. Bitte die Seite neu laden.</p>';
      return;
    }
    renderApp();
    if (!S.me) askKuerzel(true);
  }

  function renderLogin() {
    closeDialog();
    $('#app').innerHTML = `
      <div class="login"><form id="loginForm">
        <img src="img/logo-green.png" alt="Mauritius-Gymnasium" width="190" height="108">
        <h1>Klassenarbeitsplaner</h1>
        <p>Für das Kollegium. Bitte mit dem gemeinsamen Passwort anmelden.</p>
        <label class="field"><span>Passwort</span><input class="inp" type="password" id="pw" autocomplete="current-password" required></label>
        <p class="err" id="loginErr" role="alert"></p>
        <button class="btn primary" type="submit">Anmelden</button>
      </form></div>`;
    $('#pw').focus();
    $('#loginForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      $('#loginErr').textContent = '';
      try {
        await api('POST', '/api/login', { password: $('#pw').value, role: 'staff' });
        S.role = 'staff';
        await startApp();
      } catch (e) { $('#loginErr').textContent = e.message; $('#pw').select(); }
    });
  }

  async function logout() {
    try { await api('POST', '/api/logout', {}); } catch (e) { /* trotzdem abmelden */ }
    S.role = null; S.state = null; S.etag = null;
    renderLogin();
  }

  function renderApp() {
    $('#app').innerHTML = `
      <header class="top">
        <div class="brand"><img src="img/emblem-white.png" alt="" width="49" height="34">
          <div><strong>Klassenarbeitsplaner</strong><span>Mauritius-Gymnasium Büren, Schuljahr <b id="sy"></b></span></div></div>
        <nav class="views" aria-label="Ansicht">
          <button type="button" data-view="plan"><span class="hide-sm">Gesamtplan</span><span class="show-sm">Plan</span></button>
          <button type="button" data-view="klasse">Klasse</button>
          <button type="button" data-view="mine">Meine<span class="hide-sm"> Einträge</span></button>
          <button type="button" data-view="admin">Verwaltung</button>
        </nav>
        <div class="me"><button type="button" id="btnMe" title="Kürzel ändern"></button><button type="button" id="btnOut">Abmelden</button></div>
      </header>
      ${DEMO ? '<div class="demo">Demo mit Beispieldaten. Änderungen gehen beim Neuladen verloren. Passwort für die Verwaltung: demo</div>' : ''}
      <div class="notice" id="notice" hidden></div>
      <main id="main"></main>`;
    $('.views').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
    $('#btnMe').addEventListener('click', () => askKuerzel(false));
    $('#btnOut').addEventListener('click', logout);
    renderView();
  }

  function setView(v) {
    if (v === 'admin' && S.role !== 'admin') return askAdmin();
    S.view = v;
    if (v !== 'admin') store.set('view', v);
    S.needScroll = true;
    $('#main').innerHTML = '';
    renderView();
  }

  function renderView(fromPoll) {
    if (!S.state || !$('#main')) return;
    const set = S.state.settings;
    $('#sy').textContent = set.schoolYear;
    $('#btnMe').textContent = S.me ? `Kürzel: ${S.me}` : 'Kürzel festlegen';
    $$('.views button').forEach(b => { if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const n = $('#notice'); n.hidden = !set.notice; n.textContent = set.notice || '';
    if (S.view === 'admin') { if (!fromPoll) renderAdmin(); return; }
    if (S.view === 'klasse') return renderClass(fromPoll);
    if (S.view === 'mine') return renderMine();
    return renderPlan(fromPoll);
  }

  // ------------------------------------------------------------ Gesamtplan
  function planTable(cols, from, to, forPrint) {
    const set = S.state.settings, cal = K.calendar(set), I = indexState(), today = K.todayISO();
    const n = cols.length;
    const colClass = forPrint ? 'cc' : 'cc';
    let h = `<table class="plan${forPrint ? ' p-plan' : ''}"><colgroup><col class="cd" width="92">`;
    h += cols.map(() => `<col class="${colClass}" width="62">`).join('');
    h += `</colgroup><thead><tr><th class="cd" scope="col"><span class="sr">Datum</span></th>`;
    h += cols.map(c => forPrint ? `<th scope="col">${esc(c)}</th>`
      : `<th scope="col"><button type="button" class="colhead" data-cls="${esc(c)}" title="Plan der ${esc(c)} öffnen">${esc(c)}</button></th>`).join('');
    h += '</tr></thead><tbody>';
    let band = null, week = null;
    const flush = () => {
      if (!band) return;
      h += `<tr class="band"><td colspan="${n + 1}"><div><strong>${esc(band.label)}</strong>${K.fmtRange(band.span[0], band.span[1])}</div></td></tr>`;
      band = null;
    };
    for (const d of cal.days) {
      if (d.date < from || d.date > to) continue;
      if (d.kind === 'ferien') {
        if (band && band.label === d.label) continue;
        flush(); band = { label: d.label, span: d.span || [d.date, d.date] };
        continue;
      }
      flush();
      if (d.week !== week) {
        week = d.week;
        const wk = K.isoWeek(d.date);
        const now = today >= wk.monday && today <= K.addDays(wk.monday, 6);
        h += `<tr class="wk${now ? ' now' : ''}" id="w-${wk.key}"><th class="cd" scope="row"><span class="kw">KW ${wk.week}</span><span class="rng">${K.fmtDM(wk.monday)}–${K.fmtDM(wk.friday)}</span></th>`;
        for (const c of cols) {
          const cnt = I.wk.get(wk.key + '|' + c) || 0, r = K.rulesFor(set, c);
          h += `<td class="slots${cnt > r.max ? ' over' : cnt === r.max ? ' full' : ''}" title="${esc(c)}: ${cnt} von ${r.max} Arbeiten in KW ${wk.week}">${slots(cnt, r.max)}</td>`;
        }
        h += '</tr>';
      }
      const cls = ['day'];
      if (d.date === today) cls.push('today'); else if (d.date < today) cls.push('past');
      h += `<tr class="${cls.join(' ')}" data-d="${d.date}"><th class="cd" scope="row">${K.fmtShort(d.date)}</th>`;
      if (d.kind !== 'school') {
        h += `<td class="off" colspan="${n}"><div>${esc(d.label)}${d.kind === 'sperre' ? ': keine Klassenarbeiten' : ''}</div></td></tr>`;
        continue;
      }
      const wkKey = d.week;
      for (const c of cols) {
        const t = I.term.get(d.date + '|' + c);
        if (t) {
          const e = t[0], first = d.date === e.date || d.dow === 1;
          h += `<td class="term" data-tid="${esc(e.id)}" title="${esc(e.subject)} (${K.fmtRange(e.date, e.dateTo)})">${first ? esc(e.subject) : ''}</td>`;
          continue;
        }
        const es = I.ka.get(d.date + '|' + c) || [];
        const cnt = I.wk.get(wkKey + '|' + c) || 0, r = K.rulesFor(set, c);
        const st = cnt > r.max ? ' over' : cnt >= r.max ? ' full' : '';
        h += `<td class="cell${st}${es.length ? '' : ' free'}" data-c="${esc(c)}">${es.map(e => chip(e, forPrint)).join('')}</td>`;
      }
      h += '</tr>';
    }
    flush();
    return h + '</tbody></table>';
  }

  function renderPlan(fromPoll) {
    const main = $('#main');
    if (!$('#gridwrap', main)) {
      main.innerHTML = `
        <div class="bar">
          <div class="grades" role="group" aria-label="Jahrgang filtern" id="grades"></div>
          <span class="spacer"></span>
          <button type="button" class="btn" id="btnToday">Heute</button>
          <button type="button" class="btn hide-sm" id="btnPrint">Drucken</button>
          <button type="button" class="btn primary" id="btnNew"><span class="plus" aria-hidden="true">+</span>Klassenarbeit eintragen</button>
        </div>
        <div class="hint" id="hint" hidden>
          <p>Freies Feld anklicken, Fach wählen, eintragen. Die Kästchen in der KW-Zeile zeigen, wie viele Arbeiten eine Klasse in der Woche hat:
          <span class="sl"><i class="on"></i><i></i></span> noch Platz, <span class="full"><span class="sl"><i class="on"></i><i class="on"></i></span></span> Woche voll.
          Der Planer prüft die Regeln beim Eintragen automatisch.</p>
          <button type="button" class="btn small" id="hintOk">Verstanden</button>
        </div>
        <div class="gridwrap" id="gridwrap"></div>
        <div class="legend">
          <span><span class="sl"><i class="on"></i><i></i></span>1 von 2 Arbeiten</span>
          <span class="full"><span class="sl"><i class="on"></i><i class="on"></i></span>Woche voll</span>
          <span class="over"><span class="sl"><i class="on"></i><i class="on"></i><i class="on"></i></span>Ausnahme mit Begründung</span>
          <span><i class="sw mine"></i>Ihre Einträge</span>
          <span><i class="sw term"></i>Termin, z. B. Klassenfahrt</span>
        </div>`;
      $('#btnToday').onclick = () => scrollToWeek(K.todayISO());
      $('#btnPrint').onclick = () => openPrint('plan');
      $('#btnNew').onclick = () => openEditor({ classes: S.grade !== 'alle' && visibleClasses().length === 1 ? visibleClasses() : [] });
      $('#hintOk').onclick = () => { S.hintClosed = true; store.set('hint', true); $('#hint').hidden = true; };
      $('#grades').onclick = e => {
        const b = e.target.closest('[data-grade]'); if (!b) return;
        S.grade = b.dataset.grade; store.set('grade', S.grade); renderPlan(false);
      };
      $('#gridwrap').onclick = gridClick;
      S.needScroll = true;
    }
    const gs = grades();
    if (S.grade !== 'alle' && !gs.includes(S.grade)) S.grade = 'alle';
    $('#grades').innerHTML = '<span class="lbl">Jahrgang</span>' + ['alle'].concat(gs)
      .map(g => `<button type="button" class="pill" data-grade="${esc(g)}" aria-pressed="${g === S.grade}">${g === 'alle' ? 'Alle' : esc(g)}</button>`).join('');
    $('#hint').hidden = S.hintClosed;
    const wrap = $('#gridwrap');
    const top = wrap.scrollTop, left = wrap.scrollLeft;
    const set = S.state.settings;
    wrap.innerHTML = planTable(visibleClasses(), set.start, set.end, false);
    if (S.jumpTo) { scrollToWeek(S.jumpTo); S.jumpTo = null; S.needScroll = false; }
    else if (S.needScroll) { scrollToWeek(K.todayISO()); S.needScroll = false; }
    else { wrap.scrollTop = top; wrap.scrollLeft = left; }
  }

  function scrollToWeek(date) {
    const key = K.isoWeek(date).key;
    if (S.view === 'plan') {
      const wrap = $('#gridwrap'); if (!wrap) return;
      const rows = $$('tr.wk', wrap);
      const target = rows.find(r => r.id.slice(2) >= key) || rows[rows.length - 1];
      if (!target) return;
      const head = $('thead', wrap);
      wrap.scrollTop += target.getBoundingClientRect().top - wrap.getBoundingClientRect().top - (head ? head.offsetHeight : 0);
    } else if (S.view === 'klasse') {
      const sc = $('#cscroll'); if (!sc) return;
      const rows = $$('tr[id^="cw-"]', sc);
      const target = rows.find(r => r.id.slice(3) >= key) || rows[rows.length - 1];
      if (!target) return;
      sc.scrollTop += target.getBoundingClientRect().top - sc.getBoundingClientRect().top - 80;
    }
  }

  function gridClick(e) {
    const ch = e.target.closest('.chip'); if (ch) return openEntry(ch.dataset.id);
    const col = e.target.closest('.colhead');
    if (col) { S.cls = col.dataset.cls; store.set('cls', S.cls); return setView('klasse'); }
    const term = e.target.closest('td.term'); if (term) return openEntry(term.dataset.tid);
    const td = e.target.closest('td.cell');
    if (td) openEditor({ date: td.dataset.d || td.parentElement.dataset.d, classes: [td.dataset.c] });
  }

  // ------------------------------------------------------------ Klasse
  function classTable(cls, from, to, forPrint) {
    const set = S.state.settings, cal = K.calendar(set), I = indexState(), today = K.todayISO(), r = K.rulesFor(set, cls);
    const weeks = []; let cur = null;
    for (const d of cal.days) {
      if (d.date < from || d.date > to) continue;
      if (!cur || cur.key !== d.week) { cur = { key: d.week, monday: d.monday, days: {} }; weeks.push(cur); }
      cur.days[d.dow] = d;
    }
    let h = `<table class="cls${forPrint ? ' p-klasse' : ''}"><thead><tr><th class="wkc" scope="col">Woche</th>` +
      ['Mo', 'Di', 'Mi', 'Do', 'Fr'].map(x => `<th scope="col">${x}</th>`).join('') +
      '<th class="cnt" scope="col"><span class="sr">Anzahl</span></th></tr></thead><tbody>';
    let band = null;
    const flush = () => {
      if (!band) return;
      h += `<tr class="band"><td colspan="7"><strong>${esc(band.label)}</strong>${K.fmtRange(band.span[0], band.span[1])}</td></tr>`;
      band = null;
    };
    for (const w of weeks) {
      const ds = Object.values(w.days);
      if (ds.every(d => d.kind === 'ferien')) {
        if (!band || band.label !== ds[0].label) { flush(); band = { label: ds[0].label, span: ds[0].span || [ds[0].date, ds[ds.length - 1].date] }; }
        continue;
      }
      flush();
      const wk = K.isoWeek(w.monday);
      const cnt = I.wk.get(w.key + '|' + cls) || 0;
      const stc = cnt > r.max ? ' over' : cnt >= r.max ? ' full' : '';
      const now = today >= wk.monday && today <= K.addDays(wk.monday, 6);
      h += `<tr class="${now ? 'now' : ''}" id="cw-${w.key}"><th class="wkc" scope="row"><b>KW ${wk.week}</b><span>${K.fmtDM(wk.monday)}–${K.fmtDM(wk.friday)}</span></th>`;
      for (let dw = 1; dw <= 5; dw++) {
        const d = w.days[dw];
        if (!d) { h += '<td class="none"></td>'; continue; }
        const dn = `<span class="dn">${K.fmtDM(d.date)}</span>`;
        if (d.kind !== 'school') { h += `<td class="off">${dn}${esc(d.label)}</td>`; continue; }
        const t = I.term.get(d.date + '|' + cls);
        if (t) { h += `<td class="term" data-tid="${esc(t[0].id)}">${dn}${esc(t[0].subject)}</td>`; continue; }
        const es = I.ka.get(d.date + '|' + cls) || [];
        h += `<td class="cell${stc}${es.length ? '' : ' free'}${d.date === today ? ' today' : ''}" data-c="${esc(cls)}" data-d="${d.date}">${dn}${es.map(e => chip(e, forPrint)).join('')}</td>`;
      }
      h += `<td class="cnt slots${stc}" title="${cnt} von ${r.max} Arbeiten">${slots(cnt, r.max)}</td></tr>`;
    }
    flush();
    return h + '</tbody></table>';
  }

  function renderClass(fromPoll) {
    const main = $('#main'), set = S.state.settings, today = K.todayISO();
    if (!set.classes.includes(S.cls)) S.cls = '';
    const old = $('#cscroll');
    const keep = old && fromPoll ? old.scrollTop : null;
    const pick = grades().map(g => `<div class="row"><span class="g">${esc(g)}</span>` +
      set.classes.filter(c => K.grade(c) === g).map(c => `<button type="button" class="pill" data-cls="${esc(c)}" aria-pressed="${c === S.cls}">${esc(c)}</button>`).join('') + '</div>').join('');
    let body;
    if (!S.cls) body = '<div class="empty"><p>Klasse oben auswählen, dann erscheint ihr Plan für das ganze Schuljahr.</p></div>';
    else {
      const kas = S.state.entries.filter(e => e.type !== 'termin' && e.classes.includes(S.cls));
      const open = kas.filter(e => e.date >= today).length;
      body = `<div class="chead"><h2>Klasse ${esc(S.cls)}</h2>
          <p>${kas.length} ${kas.length === 1 ? 'Arbeit' : 'Arbeiten'} eingetragen, ${open} davon anstehend</p>
          <button type="button" class="btn hide-sm" id="btnPrint">Drucken</button>
          <button type="button" class="btn primary" id="btnNew"><span class="plus" aria-hidden="true">+</span>Eintragen</button></div>
        ${classTable(S.cls, set.start, set.end, false)}`;
    }
    main.innerHTML = `<div class="scroll" id="cscroll"><div class="page">
      <div class="cpick" role="group" aria-label="Klasse wählen">${pick}</div>${body}</div></div>`;
    $('.cpick').onclick = e => {
      const b = e.target.closest('[data-cls]'); if (!b) return;
      S.cls = b.dataset.cls; store.set('cls', S.cls); S.needScroll = true; renderClass(false);
    };
    if (S.cls) {
      $('#btnNew').onclick = () => openEditor({ classes: [S.cls] });
      $('#btnPrint').onclick = () => openPrint('klasse');
      $('table.cls').onclick = gridClick;
    }
    if (keep !== null) $('#cscroll').scrollTop = keep;
    else if (S.needScroll && S.cls) { scrollToWeek(today); S.needScroll = false; }
  }

  // ------------------------------------------------------------ Meine Einträge
  function renderMine() {
    const main = $('#main'), set = S.state.settings, today = K.todayISO();
    if (!S.me) {
      main.innerHTML = `<div class="scroll"><div class="page"><div class="empty">
        <p>Legen Sie Ihr Kürzel fest, dann erscheinen hier alle Arbeiten, die Sie eingetragen haben.</p>
        <button type="button" class="btn primary" id="setMe">Kürzel festlegen</button></div></div></div>`;
      $('#setMe').onclick = () => askKuerzel(false);
      return;
    }
    const all = S.state.entries.filter(e => e.teacher === S.me || e.createdBy === S.me);
    const up = all.filter(e => (e.dateTo || e.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = all.filter(e => (e.dateTo || e.date) < today).sort((a, b) => b.date.localeCompare(a.date));
    const list = S.mineScope === 'kommend' ? up : past;
    const rows = list.map(e => {
      const isT = e.type === 'termin';
      return `<tr>
        <td class="nowrap">${isT ? K.fmtRange(e.date, e.dateTo) : longDate(e.date)}</td>
        <td>${esc(e.classes.join(', '))}</td>
        <td>${isT ? `<span class="tag term">Termin</span> ${esc(e.subject)}` : `<b>${esc(e.subject)}</b> <span class="muted hide-sm">${esc(K.subjectName(set, e.subject))}</span>`}</td>
        <td class="hide-sm">${esc(e.note)}${e.reason ? ` <span class="tag red" title="${esc(e.reason)}">Ausnahme</span>` : ''}</td>
        <td><button type="button" class="btn small" data-id="${esc(e.id)}">Bearbeiten</button></td></tr>`;
    }).join('');
    main.innerHTML = `<div class="scroll"><div class="page">
      <div class="chead"><h2>Meine Einträge</h2>
        <div class="seg" role="group" aria-label="Zeitraum">
          <button type="button" data-scope="kommend" aria-pressed="${S.mineScope === 'kommend'}">Anstehend (${up.length})</button>
          <button type="button" data-scope="vergangen" aria-pressed="${S.mineScope === 'vergangen'}">Vergangen (${past.length})</button></div>
        <button type="button" class="btn primary" id="btnNew"><span class="plus" aria-hidden="true">+</span>Klassenarbeit eintragen</button></div>
      ${list.length ? `<table class="list"><thead><tr><th>Datum</th><th>Klasse</th><th>Fach</th><th class="hide-sm">Bemerkung</th><th><span class="sr">Aktion</span></th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty"><p>${S.mineScope === 'kommend' ? `Keine anstehenden Einträge mit dem Kürzel ${esc(S.me)}.` : 'Noch nichts in der Vergangenheit.'}</p></div>`}
    </div></div>`;
    $('.seg').onclick = e => { const b = e.target.closest('[data-scope]'); if (b) { S.mineScope = b.dataset.scope; renderMine(); } };
    $('#btnNew').onclick = () => openEditor({});
    $('table.list') && ($('table.list').onclick = e => { const b = e.target.closest('[data-id]'); if (b) openEntry(b.dataset.id); });
  }

  // ------------------------------------------------------------ Eintragen / Bearbeiten
  function nextSchoolDay(from, dir) {
    const days = K.calendar(S.state.settings).days.filter(d => d.kind === 'school');
    if (dir < 0) { for (let i = days.length - 1; i >= 0; i--) if (days[i].date < from) return days[i].date; return from; }
    if (dir > 0) { for (const d of days) if (d.date > from) return d.date; return from; }
    const x = days.find(d => d.date >= from);
    return x ? x.date : (days[0] ? days[0].date : from);
  }
  function openEntry(id) {
    const e = indexState().byId.get(id);
    if (!e) return toast('Dieser Eintrag existiert nicht mehr.');
    openEditor(e);
  }
  const TERM_PRESETS = ['Klassenfahrt', 'Wandertag', 'Exkursion', 'Praktikum', 'Projekttage'];

  function openEditor(init) {
    const set = S.state.settings;
    const editing = !!init.id;
    const E = {
      id: init.id || null,
      type: init.type || 'ka',
      classes: new Set(init.classes || []),
      date: init.date || nextSchoolDay(K.todayISO(), 0),
      dateTo: init.dateTo || init.date || '',
      subject: init.subject || '',
      teacher: editing ? (init.teacher || '') : (S.me || ''),
      note: init.note || '',
      reason: init.reason || '',
      armed: false
    };
    if (!E.dateTo) E.dateTo = E.date;
    const d = $('#dlg');
    d.className = '';
    const groups = [];
    for (const c of set.classes) {
      const g = K.stage(c) === 'sek2' ? '' : K.grade(c);
      let grp = groups.find(x => x.g === g);
      if (!grp) groups.push(grp = { g, cs: [] });
      grp.cs.push(c);
    }
    const classTogs = groups.map(grp => `<div class="togs">${grp.g ? `<span class="g">${esc(grp.g)}</span>` : ''}` +
      grp.cs.map(c => `<button type="button" class="tog" data-cls="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('') + '</div>').join('');
    const subjTogs = set.subjects.map(s => `<button type="button" class="tog" data-subj="${esc(s.k)}" title="${esc(s.n)}" aria-pressed="false">${esc(s.k)}</button>`).join('');
    const termTogs = TERM_PRESETS.map(t => `<button type="button" class="tog" data-term="${t}" aria-pressed="false">${t}</button>`).join('');
    const meta = editing
      ? `<p class="meta">Eingetragen von ${esc(init.createdBy || init.teacher)} am ${fmtDateTime(init.createdAt)}` +
        (init.updatedAt && init.updatedAt !== init.createdAt ? `, zuletzt geändert von ${esc(init.updatedBy)} am ${fmtDateTime(init.updatedAt)}` : '') + '.</p>'
      : '';
    d.innerHTML = `<form class="dlg" id="edForm" novalidate>
      <header><h2 id="edTitle"></h2><button type="button" class="x" data-close aria-label="Schließen">×</button></header>
      <div class="body">
        ${editing ? '' : `<div class="seg" role="group" aria-label="Art des Eintrags">
          <button type="button" data-type="ka">Klassenarbeit</button><button type="button" data-type="termin">Termin, z. B. Klassenfahrt</button></div>`}
        <fieldset><legend>Klasse <span class="muted">(Kurs über mehrere Klassen: alle anklicken)</span></legend><div class="classgrid">${classTogs}</div></fieldset>
        <div class="row2">
          <label class="field"><span id="dLabel">Datum</span>
            <span class="datepick"><button type="button" class="btn" data-step="-1" aria-label="Einen Schultag früher">‹</button>
            <input class="inp" type="date" id="edDate" min="${set.start}" max="${set.end}" required>
            <button type="button" class="btn" data-step="1" aria-label="Einen Schultag später">›</button></span>
            <span class="dayinfo" id="dayInfo"></span></label>
          <label class="field" data-only="termin"><span>bis einschließlich</span><input class="inp" type="date" id="edTo" min="${set.start}" max="${set.end}"></label>
        </div>
        <fieldset data-only="ka"><legend>Fach</legend><div class="togs wide">${subjTogs}
          <input class="inp" id="edSubj" maxlength="24" placeholder="anderes" aria-label="Anderes Fach"></div></fieldset>
        <fieldset data-only="termin"><legend>Bezeichnung</legend><div class="togs wide">${termTogs}</div>
          <input class="inp" id="edLabel" maxlength="60" placeholder="z. B. Klassenfahrt nach Berlin" aria-label="Bezeichnung"></fieldset>
        <div class="check" id="edCheck" aria-live="polite"></div>
        <label class="field" id="reasonBox" hidden><span>Begründung für die Ausnahme</span>
          <textarea class="inp" id="edReason" maxlength="300" placeholder="z. B. Nachschreibtermin, Parallelarbeit der Kursgruppen F/L"></textarea></label>
        <div class="row2" data-only="ka">
          <label class="field"><span>Kürzel</span><input class="inp" id="edTeacher" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Bemerkung (freiwillig)</span><input class="inp" id="edNote" maxlength="140" placeholder="z. B. 3./4. Stunde, Kurs F"></label>
        </div>
        <p class="err" id="edErr" role="alert"></p>
        ${meta}
      </div>
      <footer>
        ${editing ? '<button type="button" class="btn danger" id="edDel">Löschen</button>' : ''}
        <span class="grow"></span>
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button type="submit" class="btn primary" id="edSave"></button>
      </footer></form>`;

    $('#edDate').value = E.date;
    $('#edTo').value = E.dateTo;
    $('#edTeacher').value = E.teacher;
    $('#edNote').value = E.note;
    $('#edReason').value = E.reason;
    if (E.type === 'ka' && E.subject && !set.subjects.some(s => s.k === E.subject)) $('#edSubj').value = E.subject;
    if (E.type === 'termin') $('#edLabel').value = E.subject;

    const candidate = () => ({
      type: E.type,
      classes: set.classes.filter(c => E.classes.has(c)),
      date: E.date, dateTo: E.type === 'termin' ? E.dateTo : undefined,
      subject: E.subject.trim(), teacher: K.cleanKuerzel(E.teacher), note: E.note.trim(), reason: E.reason.trim()
    });
    // Regelprüfung ohne fehlende Pflichtfelder, damit die Hinweise ruhig bleiben
    function evaluate() {
      const cand = candidate();
      const missing = [];
      if (!cand.classes.length) missing.push('Klasse');
      if (!K.isISO(cand.date)) missing.push('Datum');
      if (!cand.subject) missing.push(E.type === 'termin' ? 'Bezeichnung' : 'Fach');
      if (E.type === 'ka' && !cand.teacher) missing.push('Kürzel');
      const probe = Object.assign({}, cand, { subject: cand.subject || 'X', teacher: cand.teacher || 'X' });
      const chk = cand.classes.length && K.isISO(cand.date) ? K.check(set, S.state.entries, probe, E.id) : { status: 'ok', issues: [] };
      return { cand, missing, chk, probe };
    }

    function weekStrip(cand) {
      const cal = K.calendar(set), I = indexState(), wk = K.isoWeek(cand.date);
      const days = [0, 1, 2, 3, 4].map(i => K.addDays(wk.monday, i));
      const cls = cand.classes.slice(0, 6);
      let h = '<div class="strip" aria-hidden="true"><span></span>' + days.map(x => `<span class="h">${K.WD[K.dow(x)]} ${x.slice(8)}.</span>`).join('');
      for (const c of cls) {
        h += `<span class="c">${esc(c)}</span>`;
        for (const x of days) {
          const day = cal.map.get(x), sel = x === cand.date;
          if (!day || day.kind !== 'school') {
            h += `<span class="d off${sel ? ' sel bad' : ''}" title="${esc(day ? day.label : '')}">${esc(day ? day.label.split(' ')[0].slice(0, 12) : '')}</span>`;
            continue;
          }
          const t = (I.term.get(x + '|' + c) || []).filter(e => e.id !== E.id);
          if (t.length) { h += `<span class="d term${sel ? ' sel bad' : ''}">${esc(t[0].subject.slice(0, 12))}</span>`; continue; }
          const es = (I.ka.get(x + '|' + c) || []).filter(e => e.id !== E.id);
          h += `<span class="d${sel ? ' sel' : ''}">` + es.map(e => `<span class="s" title="${esc(e.teacher)}">${esc(e.subject)}</span>`).join('') +
            (sel ? `<span class="s new">${esc(cand.subject || 'neu')}</span>` : '') + '</span>';
        }
      }
      h += '</div>';
      if (cand.classes.length > 6) h += `<p class="meta">Die Wochenübersicht zeigt die ersten 6 Klassen, geprüft werden alle ${cand.classes.length}.</p>`;
      return h;
    }

    function update() {
      const isT = E.type === 'termin';
      $('#edTitle').textContent = editing ? (isT ? 'Termin bearbeiten' : 'Klassenarbeit bearbeiten') : (isT ? 'Termin eintragen' : 'Klassenarbeit eintragen');
      $$('[data-type]', d).forEach(b => b.setAttribute('aria-pressed', b.dataset.type === E.type));
      $$('[data-only]', d).forEach(x => { x.hidden = x.dataset.only !== E.type; });
      $('#dLabel').textContent = isT ? 'von' : 'Datum';
      $$('[data-cls]', d).forEach(b => b.setAttribute('aria-pressed', E.classes.has(b.dataset.cls)));
      $$('[data-subj]', d).forEach(b => b.setAttribute('aria-pressed', !isT && b.dataset.subj === E.subject));
      $$('[data-term]', d).forEach(b => b.setAttribute('aria-pressed', isT && b.dataset.term === E.subject));

      const info = $('#dayInfo');
      if (K.isISO(E.date)) {
        const day = K.calendar(set).map.get(E.date);
        info.textContent = `${K.WD_LONG[K.dow(E.date)]}, ${K.fmtDate(E.date)}, KW ${K.isoWeek(E.date).week}` + (day && day.kind !== 'school' ? `, ${day.label}` : '');
      } else info.textContent = '';

      const { cand, missing, chk, probe } = evaluate();
      let h = '';
      if (!cand.classes.length) h = '<ul><li class="info">Bitte eine Klasse auswählen.</li></ul>';
      else {
        h = '<ul>' + chk.issues.map(i => `<li class="${i.level}">${esc(i.text)}</li>`).join('') + '</ul>';
        if (!isT && K.isISO(cand.date)) h += weekStrip(cand);
        if (!isT && chk.status !== 'ok' && K.isISO(cand.date)) {
          const nf = K.nextFree(set, S.state.entries, probe, E.id, cand.date);
          if (nf) h += `<div class="suggest">Nächster Tag ohne Ausnahme: <button type="button" class="btn small" data-goto="${nf}">${K.WD_LONG[K.dow(nf)]}, ${K.fmtDate(nf)}</button></div>`;
          else h += '<div class="suggest muted">In diesem Schuljahr gibt es danach keinen freien Tag mehr für diese Auswahl.</div>';
        }
      }
      if (missing.length && cand.classes.length) h += `<p class="meta">Noch offen: ${missing.join(', ')}</p>`;
      $('#edCheck').innerHTML = h;
      $('#reasonBox').hidden = chk.status !== 'reason';

      const save = $('#edSave');
      save.textContent = editing ? 'Speichern' : (chk.status === 'reason' ? 'Als Ausnahme eintragen' : 'Eintragen');
      save.disabled = missing.length > 0 || chk.status === 'blocked' || (chk.status === 'reason' && cand.reason.length < 3);
    }
    E.update = update;
    S.editor = E;

    d.onclick = async ev => {
      if (ev.target === d) return closeDialog();
      const t = ev.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-close')) return closeDialog();
      if (t.dataset.type) {
        if (t.dataset.type !== E.type) { E.type = t.dataset.type; E.subject = ''; $('#edSubj').value = ''; $('#edLabel').value = ''; }
      } else if (t.dataset.cls) {
        if (E.classes.has(t.dataset.cls)) E.classes.delete(t.dataset.cls); else E.classes.add(t.dataset.cls);
      } else if (t.dataset.subj) {
        E.subject = t.dataset.subj; $('#edSubj').value = '';
      } else if (t.dataset.term) {
        E.subject = t.dataset.term; $('#edLabel').value = t.dataset.term;
      } else if (t.dataset.step) {
        const shift = +t.dataset.step;
        const nd = nextSchoolDay(E.date, shift);
        if (E.type === 'termin') { const len = (K.parseISO(E.dateTo) - K.parseISO(E.date)) / 864e5; E.date = nd; E.dateTo = K.addDays(nd, Math.max(0, len || 0)); $('#edTo').value = E.dateTo; }
        else E.date = nd;
        $('#edDate').value = E.date;
      } else if (t.dataset.goto) {
        E.date = t.dataset.goto; $('#edDate').value = E.date;
      } else if (t.id === 'edDel') {
        return deleteEntry(t);
      } else return;
      update();
    };
    d.oninput = ev => {
      const id = ev.target.id;
      if (id === 'edDate') {
        E.date = ev.target.value;
        if (E.type === 'termin' && K.isISO(E.date) && (!K.isISO(E.dateTo) || E.dateTo < E.date)) { E.dateTo = E.date; $('#edTo').value = E.dateTo; }
      } else if (id === 'edTo') E.dateTo = ev.target.value;
      else if (id === 'edSubj') E.subject = ev.target.value;
      else if (id === 'edLabel') E.subject = ev.target.value;
      else if (id === 'edTeacher') E.teacher = ev.target.value;
      else if (id === 'edNote') E.note = ev.target.value;
      else if (id === 'edReason') { E.reason = ev.target.value; }
      else return;
      if (id === 'edReason' || id === 'edNote') {
        const { cand, missing, chk } = evaluate();
        $('#edSave').disabled = missing.length > 0 || chk.status === 'blocked' || (chk.status === 'reason' && cand.reason.length < 3);
        return;
      }
      update();
    };

    async function deleteEntry(btn) {
      const foreign = S.me && init.teacher && init.teacher !== S.me;
      if (!E.armed) {
        E.armed = true; btn.classList.add('armed');
        btn.textContent = foreign ? `Eintrag von ${init.teacher} wirklich löschen?` : 'Wirklich löschen?';
        setTimeout(() => { if (btn.isConnected) { E.armed = false; btn.classList.remove('armed'); btn.textContent = 'Löschen'; } }, 5000);
        return;
      }
      try {
        await api('DELETE', '/api/entries/' + encodeURIComponent(E.id), {});
        closeDialog(); await refresh(true); toast('Eintrag gelöscht');
      } catch (e) { $('#edErr').textContent = e.message; if (e.status === 404) refresh(true); }
    }

    $('#edForm').onsubmit = async ev => {
      ev.preventDefault();
      const { cand, missing, chk } = evaluate();
      if (missing.length || chk.status === 'blocked') return;
      if (chk.status === 'reason' && cand.reason.length < 3) { $('#edReason').focus(); return; }
      const btn = $('#edSave'); btn.disabled = true; $('#edErr').textContent = '';
      try {
        if (E.id) await api('PUT', '/api/entries/' + encodeURIComponent(E.id), cand);
        else await api('POST', '/api/entries', cand);
        if (cand.type === 'ka' && !S.me && cand.teacher) { S.me = cand.teacher; store.set('me', S.me); }
        closeDialog();
        await refresh(true);
        toast(E.id ? 'Änderung gespeichert' : cand.type === 'termin'
          ? `Termin eingetragen: ${cand.subject}`
          : `Eingetragen: ${cand.subject} in ${cand.classes.join(', ')} am ${K.fmtShort(cand.date)}`);
      } catch (e) {
        $('#edErr').textContent = e.message;
        if (e.status === 409 || e.status === 404) await refresh(true);
        if (S.editor === E) update();
      }
    };

    update();
    d.showModal();
    const focusTarget = !E.classes.size ? $('[data-cls]', d) : (E.type === 'ka' && !E.subject ? $('[data-subj]', d) : $('#edSave'));
    if (focusTarget) focusTarget.focus();
  }

  // ------------------------------------------------------------ Kürzel
  function askKuerzel(first) {
    const d = $('#dlg');
    d.className = 'narrow';
    d.innerHTML = `<form class="dlg" id="meForm">
      <header><h2>${first ? 'Willkommen' : 'Kürzel ändern'}</h2><button type="button" class="x" data-close aria-label="Schließen">×</button></header>
      <div class="body">
        <p>Mit welchem Kürzel sollen Ihre Einträge erscheinen?</p>
        <label class="field"><span>Ihr Kürzel</span><input class="inp" id="meInp" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" required></label>
        <p class="meta">Das Kürzel wird nur auf diesem Gerät gespeichert. Es steht bei Ihren Einträgen, damit andere wissen, wen sie ansprechen können.</p>
      </div>
      <footer><span class="grow"></span><button class="btn primary" type="submit">Speichern</button></footer></form>`;
    $('#meInp').value = S.me;
    d.onclick = e => { if (e.target === d || e.target.closest('[data-close]')) closeDialog(); };
    d.oninput = null;
    $('#meForm').onsubmit = ev => {
      ev.preventDefault();
      const v = K.cleanKuerzel($('#meInp').value);
      if (!v) { $('#meInp').focus(); return; }
      S.me = v; store.set('me', v);
      closeDialog(); renderView(); toast(`Kürzel ${v} gespeichert`);
    };
    d.showModal();
    $('#meInp').focus();
  }

  // ------------------------------------------------------------ Verwaltung: Anmeldung
  function askAdmin() {
    const d = $('#dlg');
    d.className = 'narrow';
    d.innerHTML = `<form class="dlg" id="admForm">
      <header><h2>Verwaltung</h2><button type="button" class="x" data-close aria-label="Schließen">×</button></header>
      <div class="body">
        <p>Hier werden Schuljahr, Ferien, Klassen und Regeln eingestellt. Dafür gibt es ein eigenes Passwort.</p>
        <label class="field"><span>Passwort der Verwaltung</span><input class="inp" type="password" id="admPw" autocomplete="current-password" required></label>
        <p class="err" id="admErr" role="alert"></p>
      </div>
      <footer><span class="grow"></span><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary" type="submit">Anmelden</button></footer></form>`;
    d.onclick = e => { if (e.target === d || e.target.closest('[data-close]')) closeDialog(); };
    d.oninput = null;
    $('#admForm').onsubmit = async ev => {
      ev.preventDefault();
      try {
        await api('POST', '/api/login', { role: 'admin', password: $('#admPw').value });
        S.role = 'admin'; closeDialog(); setView('admin');
      } catch (e) { $('#admErr').textContent = e.message; $('#admPw').select(); }
    };
    d.showModal();
    $('#admPw').focus();
  }

  // ------------------------------------------------------------ Drucken
  function openPrint(kind) {
    const set = S.state.settings, today = K.todayISO(), mon = K.isoWeek(today).monday;
    const ranges = {
      w4: ['Ab dieser Woche, 4 Wochen', mon, K.addDays(mon, 25)],
      w8: ['Ab dieser Woche, 8 Wochen', mon, K.addDays(mon, 53)],
      h1: ['1. Halbjahr', set.start, K.addDays(set.halfYear, -1)],
      h2: ['2. Halbjahr', set.halfYear, set.end],
      all: ['Ganzes Schuljahr', set.start, set.end]
    };
    const def = kind === 'plan' ? 'w4' : (today < set.halfYear ? 'h1' : 'h2');
    const scope = kind === 'plan' ? (S.grade === 'alle' ? 'alle Klassen' : `Jahrgang ${S.grade}`) : `Klasse ${S.cls}`;
    const d = $('#dlg');
    d.className = 'narrow';
    d.innerHTML = `<form class="dlg" id="prForm">
      <header><h2>Drucken</h2><button type="button" class="x" data-close aria-label="Schließen">×</button></header>
      <div class="body">
        <p>Gedruckt wird der Plan für ${esc(scope)}.${kind === 'plan' ? ' Für weniger Spalten oben einen Jahrgang auswählen.' : ''}</p>
        <fieldset><legend>Zeitraum</legend>
          ${Object.entries(ranges).map(([k, r]) => `<label><input type="radio" name="rg" value="${k}"${k === def ? ' checked' : ''}> ${r[0]}</label>`).join('')}
        </fieldset>
        <p class="meta">${kind === 'plan' ? 'Für den Aushang im Drucker „A3 quer“ wählen.' : 'Passt auf A4 hoch, zum Beispiel für den Klassenraum.'}</p>
      </div>
      <footer><span class="grow"></span><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary" type="submit">Drucken</button></footer></form>`;
    d.onclick = e => { if (e.target === d || e.target.closest('[data-close]')) closeDialog(); };
    d.oninput = null;
    $('#prForm').onsubmit = ev => {
      ev.preventDefault();
      const r = ranges[new FormData(ev.target).get('rg')] || ranges[def];
      const from = r[1] < set.start ? set.start : r[1], to = r[2] > set.end ? set.end : r[2];
      const now = new Date();
      const stand = `${K.fmtDate(K.todayISO())}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} Uhr`;
      const title = kind === 'plan' ? `Klassenarbeitsplan${S.grade === 'alle' ? '' : ' Jahrgang ' + S.grade}` : `Klassenarbeitsplan ${S.cls}`;
      const table = kind === 'plan' ? planTable(visibleClasses(), from, to, true) : classTable(S.cls, from, to, true);
      $('#print').innerHTML = `<div class="${kind === 'plan' ? 'p-plan' : 'p-klasse'}">
        <div class="ph"><img src="img/logo-green.png" alt=""><div><h1>${esc(title)}</h1>
        <p>Schuljahr ${esc(set.schoolYear)}, ${K.fmtRange(from, to)}. Stand: ${stand}</p></div></div>
        ${table}
        <div class="p-legend"><span>Kästchen: Arbeiten der Klasse in dieser Woche</span><span>Schraffiert: Woche voll</span><span>Rot umrandet: Ausnahme mit Begründung</span></div></div>`;
      closeDialog();
      setTimeout(() => window.print(), 60);
    };
    d.showModal();
  }
  window.addEventListener('afterprint', () => { $('#print').innerHTML = ''; });

  // ------------------------------------------------------------ Verwaltung
  const ADMIN_TABS = [['kalender', 'Schuljahr und Ferien'], ['klassen', 'Klassen, Fächer, Regeln'], ['bericht', 'Prüfbericht'], ['protokoll', 'Protokoll'], ['daten', 'Daten und Zugang']];

  function adminError(e, el) {
    if (e.status === 403) { S.role = 'staff'; toast('Die Anmeldung für die Verwaltung ist abgelaufen.'); setView('plan'); return; }
    if (el) el.textContent = e.message; else toast(e.message);
  }

  function renderAdmin() {
    if (S.role !== 'admin') { S.view = 'plan'; return renderView(); }
    $('#main').innerHTML = `<div class="scroll"><div class="page">
      <div class="chead"><h2>Verwaltung</h2><button type="button" class="btn" id="admOut">Verwaltung verlassen</button></div>
      <div class="tabs" role="tablist">${ADMIN_TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.adminTab === k}">${l}</button>`).join('')}</div>
      <div id="admBody"></div></div></div>`;
    $('.tabs').onclick = e => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      S.adminTab = b.dataset.tab;
      $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
      renderAdminTab();
    };
    $('#admOut').onclick = async () => {
      try { await api('POST', '/api/admin/logout', {}); } catch (e) { /* egal */ }
      S.role = 'staff'; setView('plan');
    };
    renderAdminTab();
  }

  function renderAdminTab() {
    const el = $('#admBody');
    el.onclick = null; el.oninput = null;
    ({ kalender: admKalender, klassen: admKlassen, bericht: admBericht, protokoll: admProtokoll, daten: admDaten })[S.adminTab](el);
  }

  async function saveSettings(next, errEl) {
    errEl.textContent = '';
    try {
      const r = await api('PUT', '/api/admin/settings', next);
      await refresh(true);
      toast('Gespeichert');
      if (r.orphaned) toast(`${r.orphaned} Einträge gehören zu entfernten Klassen und werden nicht mehr angezeigt.`);
      return true;
    } catch (e) { adminError(e, errEl); return false; }
  }

  // Schuljahr und Ferien
  function admKalender(el) {
    const s = S.state.settings;
    let rows = s.freeDays.map(f => Object.assign({}, f));
    const hol = [];
    for (let y = +s.start.slice(0, 4); y <= +s.end.slice(0, 4); y++) {
      for (const [d, l] of K.holidaysNRW(y)) if (d >= s.start && d <= s.end && K.dow(d) % 6 !== 0) hol.push(`${longDate(d)} ${l}`);
    }
    const kinds = Object.entries(K.FREE_KINDS);
    el.innerHTML = `<form id="calForm">
      <div class="card"><h3>Schuljahr</h3>
        <div class="row2">
          <label class="field"><span>Bezeichnung</span><input class="inp" name="schoolYear" maxlength="20"></label>
          <label class="field"><span>Erster Schultag</span><input class="inp" type="date" name="start" required></label>
          <label class="field"><span>Letzter Schultag</span><input class="inp" type="date" name="end" required></label>
          <label class="field"><span>Beginn 2. Halbjahr</span><input class="inp" type="date" name="halfYear" required></label>
        </div></div>
      <div class="card"><h3>Ferien, freie Tage und Sperrtage</h3>
        <p class="muted">Bewegliche Ferientage, Brückentage und Tage ohne Klassenarbeiten (etwa Zeugniskonferenzen) hier ergänzen.</p>
        <div class="fd head"><span>von</span><span>bis</span><span>Bezeichnung</span><span>Art</span><span></span></div>
        <div id="fdRows"></div>
        <div class="actions"><button type="button" class="btn" id="fdAdd"><span class="plus" aria-hidden="true">+</span>Zeitraum hinzufügen</button></div>
        <p class="muted">Gesetzliche Feiertage in NRW sind automatisch berücksichtigt${hol.length ? ': ' + esc(hol.join(', ')) : ''}.</p>
      </div>
      <div class="card"><h3>Hinweis an das Kollegium</h3>
        <p class="muted">Erscheint oben im Planer, solange hier Text steht.</p>
        <textarea class="inp" name="notice" maxlength="300" placeholder="z. B. Bitte alle Arbeiten des 1. Halbjahres bis zum 30.10. eintragen."></textarea></div>
      <div class="actions"><button class="btn primary" type="submit">Speichern</button><span class="err" id="calErr" role="alert"></span></div>
    </form>`;
    const f = $('#calForm');
    f.schoolYear.value = s.schoolYear; f.start.value = s.start; f.end.value = s.end; f.halfYear.value = s.halfYear; f.notice.value = s.notice || '';
    const drawRows = () => {
      $('#fdRows').innerHTML = rows.map((r, i) => `<div class="fd" data-i="${i}">
        <input class="inp" type="date" data-k="from" aria-label="von">
        <input class="inp" type="date" data-k="to" aria-label="bis">
        <input class="inp" data-k="label" maxlength="60" placeholder="z. B. Beweglicher Ferientag" aria-label="Bezeichnung">
        <select class="inp" data-k="kind" aria-label="Art">${kinds.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <button type="button" class="x" data-del="${i}" aria-label="Zeile entfernen">×</button></div>`).join('');
      $$('#fdRows .fd').forEach(row => {
        const r = rows[+row.dataset.i];
        for (const inp of $$('[data-k]', row)) inp.value = r[inp.dataset.k] || '';
      });
    };
    drawRows();
    el.oninput = e => {
      const row = e.target.closest('.fd[data-i]'); if (!row) return;
      rows[+row.dataset.i][e.target.dataset.k] = e.target.value;
      if (e.target.dataset.k === 'from' && !rows[+row.dataset.i].to) { rows[+row.dataset.i].to = e.target.value; drawRows(); }
    };
    el.onclick = e => {
      const del = e.target.closest('[data-del]');
      if (del) { rows.splice(+del.dataset.del, 1); drawRows(); }
      if (e.target.closest('#fdAdd')) { rows.push({ from: '', to: '', label: '', kind: 'frei' }); drawRows(); $$('#fdRows [data-k="from"]').pop().focus(); }
    };
    f.onsubmit = async ev => {
      ev.preventDefault();
      const next = Object.assign({}, s, {
        schoolYear: f.schoolYear.value, start: f.start.value, end: f.end.value, halfYear: f.halfYear.value, notice: f.notice.value,
        freeDays: rows.filter(r => r.from)
      });
      if (await saveSettings(next, $('#calErr'))) admKalender(el);
    };
  }

  // Klassen, Fächer, Regeln
  function admKlassen(el) {
    const s = S.state.settings;
    el.innerHTML = `<form id="clsForm">
      <div class="card"><h3>Klassen</h3>
        <p class="muted">Eine Klasse pro Zeile oder durch Leerzeichen getrennt, in der gewünschten Reihenfolge. EF, Q1 und Q2 gelten als Oberstufe.</p>
        <textarea class="inp" name="classes" rows="6" spellcheck="false"></textarea></div>
      <div class="card"><h3>Fächer</h3>
        <p class="muted">Ein Fach pro Zeile in der Form „Kürzel = Name“. Die Kürzel erscheinen als Schaltflächen beim Eintragen, häufige Fächer also nach oben.</p>
        <textarea class="inp" name="subjects" rows="9" spellcheck="false"></textarea></div>
      <div class="card"><h3>Regeln</h3>
        <div class="rules">
          <label>Klassen 5 bis 10: normal höchstens <input class="inp" type="number" min="1" max="5" name="s1max"> Arbeiten pro Woche, mit Begründung bis zu <input class="inp" type="number" min="1" max="6" name="s1hard"></label>
          <label>Oberstufe: normal höchstens <input class="inp" type="number" min="1" max="5" name="s2max"> Klausuren pro Woche, mit Begründung bis zu <input class="inp" type="number" min="1" max="6" name="s2hard"></label>
          <p class="muted">Pro Tag ist eine Arbeit vorgesehen, eine zweite am selben Tag geht nur mit Begründung (etwa getrennte Kursgruppen). Stehen beide Zahlen gleich, ist keine Ausnahme möglich. Grundlage in NRW: BASS 12-63 Nr. 3.</p>
        </div></div>
      <div class="actions"><button class="btn primary" type="submit">Speichern</button><span class="err" id="clsErr" role="alert"></span></div>
    </form>`;
    const f = $('#clsForm');
    f.classes.value = s.classes.join('\n');
    f.subjects.value = s.subjects.map(x => `${x.k} = ${x.n}`).join('\n');
    f.s1max.value = s.rules.sek1.max; f.s1hard.value = s.rules.sek1.hardMax;
    f.s2max.value = s.rules.sek2.max; f.s2hard.value = s.rules.sek2.hardMax;
    f.onsubmit = async ev => {
      ev.preventDefault();
      const classes = f.classes.value.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
      const subjects = f.subjects.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^([^=:\t]+?)\s*[=:\t]\s*(.+)$/) || l.match(/^(\S+)\s+(.+)$/);
        return m ? { k: m[1].trim(), n: m[2].trim() } : { k: l, n: l };
      });
      const removed = s.classes.filter(c => !classes.includes(c));
      if (removed.length && !confirm(`Diese Klassen werden entfernt: ${removed.join(', ')}. Ihre Einträge bleiben gespeichert, werden aber nicht mehr angezeigt. Fortfahren?`)) return;
      const next = Object.assign({}, s, {
        classes, subjects,
        rules: { sek1: { max: +f.s1max.value, hardMax: +f.s1hard.value }, sek2: { max: +f.s2max.value, hardMax: +f.s2hard.value }, perDay: s.rules.perDay || 1 }
      });
      if (await saveSettings(next, $('#clsErr'))) admKlassen(el);
    };
  }

  // Prüfbericht
  async function admBericht(el) {
    el.innerHTML = '<p class="muted">Der Plan wird geprüft …</p>';
    let r;
    try { r = await api('GET', '/api/admin/report'); } catch (e) { return adminError(e); }
    if (!r.issues.length) {
      el.innerHTML = '<div class="empty"><p>Keine Konflikte und keine Ausnahmen. Alle Klassen liegen im Rahmen.</p></div>';
      return;
    }
    el.innerHTML = `<div class="card"><p>${r.issues.length} ${r.issues.length === 1 ? 'Hinweis' : 'Hinweise'}, nach Datum sortiert. „Ausnahme“ heißt: mehr als vorgesehen, mit Begründung eingetragen oder importiert. „Konflikt“ heißt: so nicht zulässig, bitte mit den Lehrkräften klären.</p>
      <div>${r.issues.map(i => `<div class="issue"><span class="tag ${i.level === 'block' ? 'red' : 'amber'}">${i.level === 'block' ? 'Konflikt' : 'Ausnahme'}</span>
        <span>${esc(i.text)}</span><button type="button" class="btn small" data-jump="${i.date}">Im Plan zeigen</button></div>`).join('')}</div></div>`;
    el.onclick = e => {
      const b = e.target.closest('[data-jump]'); if (!b) return;
      S.jumpTo = b.dataset.jump; S.grade = 'alle'; store.set('grade', 'alle'); setView('plan');
    };
  }

  // Protokoll
  async function admProtokoll(el) {
    el.innerHTML = '<p class="muted">Wird geladen …</p>';
    let r;
    try { r = await api('GET', '/api/admin/log'); } catch (e) { return adminError(e); }
    el.innerHTML = r.log.length
      ? `<p class="muted">Die letzten ${r.log.length} Änderungen, neueste zuerst.</p>
         <table class="list"><thead><tr><th>Zeit</th><th>Wer</th><th>Was</th></tr></thead><tbody>
         ${r.log.map(l => `<tr><td class="nowrap">${fmtDateTime(l.t)}</td><td>${esc(l.who)}</td><td>${esc(l.text)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty"><p>Noch keine Änderungen.</p></div>';
  }

  // Daten und Zugang
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function admDaten(el) {
    const sy = S.state.settings.schoolYear.replace(/[^\w-]+/g, '-');
    el.innerHTML = `
      <div class="card"><h3>Export</h3>
        <p>Alle Einträge als Tabelle für Excel oder als vollständige Sicherung mit Einstellungen und Protokoll.</p>
        <div class="actions"><button type="button" class="btn" id="csvBtn">Als Excel-Tabelle (CSV)</button><button type="button" class="btn" id="bakBtn">Sicherung herunterladen</button></div>
        <p class="muted">Zusätzlich legt der Server bei der ersten Änderung jedes Tages automatisch eine Sicherung an und hebt die letzten 60 auf.</p></div>
      <div class="card"><h3>Einträge aus dem Papierplan übernehmen</h3>
        <p>Eine Zeile pro Arbeit, Spalten mit Semikolon getrennt: Datum; Klasse(n); Fach; Kürzel; Bemerkung. Beispiel: <code>12.10.2026; 7b; M; KÜ</code>. Aus Excel als „CSV UTF-8“ speichern und hier auswählen oder die Zeilen direkt einfügen.</p>
        <textarea class="inp" id="impText" rows="6" spellcheck="false" placeholder="12.10.2026; 7b; M; KÜ&#10;14.10.2026; 9a 9b 9c; WP; AB; Informatik und Biologie parallel"></textarea>
        <div class="actions"><input type="file" id="impFile" accept=".csv,.txt,text/csv"><span class="spacer"></span>
          <button type="button" class="btn" id="impCheck">Prüfen</button><button type="button" class="btn primary" id="impGo" disabled>Importieren</button></div>
        <div id="impOut"></div></div>
      <div class="card"><h3>Kollegiums-Passwort</h3>
        <p>Nach dem Ändern müssen sich alle Geräte neu anmelden. Sinnvoll zum Schuljahreswechsel oder wenn das Passwort die Runde gemacht hat.</p>
        <div class="actions"><input class="inp" type="text" id="pwNew" minlength="6" autocomplete="off" placeholder="Neues Passwort, mindestens 6 Zeichen"><button type="button" class="btn" id="pwBtn">Passwort ändern</button></div>
        <p class="err" id="pwErr" role="alert"></p></div>
      <div class="card"><h3>Sicherung einspielen</h3>
        <p>Ersetzt alle Einträge und Einstellungen durch den Stand der gewählten Sicherung.</p>
        <div class="actions"><input type="file" id="resFile" accept=".json,application/json"></div><p class="err" id="resErr" role="alert"></p></div>
      <div class="card"><h3>Neues Schuljahr</h3>
        <p>Erst die Sicherung herunterladen, dann alle Einträge löschen und anschließend unter „Schuljahr und Ferien“ die neuen Daten eintragen.</p>
        <div class="actions"><input class="inp" id="wipeConfirm" autocomplete="off" placeholder="Zum Bestätigen LÖSCHEN eintippen"><button type="button" class="btn danger" id="wipeBtn">Alle Einträge löschen</button></div>
        <p class="err" id="wipeErr" role="alert"></p></div>`;

    $('#csvBtn').onclick = () => download(`Klassenarbeiten-${sy}.csv`, K.toCSV(S.state.settings, S.state.entries), 'text/csv;charset=utf-8');
    $('#bakBtn').onclick = async () => {
      try { const b = await api('GET', '/api/admin/backup'); download(`Klassenarbeitsplaner-Sicherung-${K.todayISO()}.json`, JSON.stringify(b, null, 1), 'application/json'); }
      catch (e) { adminError(e); }
    };
    $('#impFile').onchange = async e => { const f = e.target.files[0]; if (f) { $('#impText').value = await f.text(); $('#impGo').disabled = true; $('#impOut').innerHTML = ''; } };
    $('#impText').oninput = () => { $('#impGo').disabled = true; };
    $('#impCheck').onclick = async () => {
      try {
        const r = await api('POST', '/api/admin/import', { csv: $('#impText').value, dryRun: true });
        $('#impOut').innerHTML = `<p><b>${r.count}</b> Einträge erkannt.</p>` +
          (r.errors.length ? `<p class="err">Nicht übernommen:</p><ul>${r.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '') +
          (r.issues.length ? `<p>Nach dem Import im Prüfbericht:</p><ul>${r.issues.map(x => `<li>${esc(x.text)}</li>`).join('')}</ul>` : (r.count ? '<p class="muted">Keine Konflikte.</p>' : ''));
        $('#impGo').disabled = !r.count;
      } catch (e) { adminError(e, $('#impOut')); }
    };
    $('#impGo').onclick = async () => {
      try {
        const r = await api('POST', '/api/admin/import', { csv: $('#impText').value });
        $('#impOut').innerHTML = `<p><b>${r.count}</b> Einträge importiert.</p>`;
        $('#impText').value = ''; $('#impGo').disabled = true;
        await refresh(true); toast(`${r.count} Einträge importiert`);
      } catch (e) { adminError(e, $('#impOut')); }
    };
    $('#pwBtn').onclick = async () => {
      $('#pwErr').textContent = '';
      try { await api('PUT', '/api/admin/password', { password: $('#pwNew').value }); $('#pwNew').value = ''; toast('Kollegiums-Passwort geändert'); }
      catch (e) { adminError(e, $('#pwErr')); }
    };
    $('#resFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#resErr').textContent = '';
      let data;
      try { data = JSON.parse(await f.text()); } catch (err) { $('#resErr').textContent = 'Die Datei ist keine gültige Sicherung.'; return; }
      if (!confirm(`Sicherung vom ${String(data.exportedAt || '').slice(0, 10)} mit ${(data.entries || []).length} Einträgen einspielen? Der aktuelle Stand wird ersetzt.`)) return;
      try { await api('POST', '/api/admin/restore', { data }); await refresh(true); toast('Sicherung eingespielt'); }
      catch (err) { adminError(err, $('#resErr')); }
      e.target.value = '';
    };
    $('#wipeBtn').onclick = async () => {
      $('#wipeErr').textContent = '';
      try { await api('DELETE', '/api/admin/entries', { confirm: $('#wipeConfirm').value.trim() }); $('#wipeConfirm').value = ''; await refresh(true); toast('Alle Einträge gelöscht'); }
      catch (e) { adminError(e, $('#wipeErr')); }
    };
  }

  boot();
})();
