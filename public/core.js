/*
 * Klassenarbeitsplaner – gemeinsame Logik
 * Läuft im Browser (window.KAP) und auf dem Server (require).
 * Enthält: Datumsfunktionen, Schulkalender mit NRW-Feiertagen,
 * Regelprüfung und die API-Handler (ohne Anmeldung, die macht server.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- Datum
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function toISO(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s; }
  function addDays(s, n) { return toISO(parseISO(s) + n * DAY); }
  function dow(s) { return new Date(parseISO(s)).getUTCDay(); }
  function todayISO(now) { const d = now ? new Date(now) : new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function isoWeek(s) {
    const t = parseISO(s);
    const day = (new Date(t).getUTCDay() + 6) % 7;           // Mo = 0
    const monday = t - day * DAY;
    const thursday = monday + 3 * DAY;
    const year = new Date(thursday).getUTCFullYear();
    const jan4 = Date.UTC(year, 0, 4);
    const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
    const week = 1 + Math.round((monday - week1) / (7 * DAY));
    return { key: `${year}-W${pad(week)}`, week, year, monday: toISO(monday), friday: toISO(monday + 4 * DAY) };
  }

  function fmtDate(s) { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; }
  function fmtShort(s) { const [, m, d] = s.split('-'); return `${WD[dow(s)]} ${d}.${m}.`; }
  function fmtDM(s) { const [, m, d] = s.split('-'); return `${d}.${m}.`; }
  function fmtRange(a, b) {
    if (!b || a === b) return fmtDate(a);
    const [ya, ma] = a.split('-'), [yb, mb] = b.split('-');
    if (ya === yb && ma === mb) return `${a.slice(8)}.–${fmtDate(b)}`;
    if (ya === yb) return `${fmtDM(a)}–${fmtDate(b)}`;
    return `${fmtDate(a)}–${fmtDate(b)}`;
  }
  /** Akzeptiert 12.10.2026, 12.10.26, 1.2.2027 und 2026-10-12 */
  function parseDate(s) {
    s = String(s || '').trim();
    if (isISO(s)) return s;
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    const iso = `${y}-${pad(+m[2])}-${pad(+m[1])}`;
    return isISO(iso) ? iso : null;
  }

  // ------------------------------------------------------ Feiertage NRW
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${y}-${pad(month)}-${pad(day)}`;
  }
  function holidaysNRW(y) {
    const e = easter(y);
    return [
      [`${y}-01-01`, 'Neujahr'], [addDays(e, -2), 'Karfreitag'], [addDays(e, 1), 'Ostermontag'],
      [`${y}-05-01`, 'Tag der Arbeit'], [addDays(e, 39), 'Christi Himmelfahrt'], [addDays(e, 50), 'Pfingstmontag'],
      [addDays(e, 60), 'Fronleichnam'], [`${y}-10-03`, 'Tag der Deutschen Einheit'], [`${y}-11-01`, 'Allerheiligen'],
      [`${y}-12-25`, '1. Weihnachtstag'], [`${y}-12-26`, '2. Weihnachtstag']
    ];
  }

  // ------------------------------------------------------------ Kalender
  const FREE_KINDS = {
    ferien: 'Ferien',
    frei: 'Unterrichtsfrei',
    sperre: 'Unterricht, aber keine Klassenarbeiten'
  };

  let calCache = { key: '', days: [], map: new Map() };
  /** Alle Wochentage des Schuljahres mit Art (school, ferien, feiertag, frei, sperre) */
  function calendar(settings) {
    const key = JSON.stringify([settings.start, settings.end, settings.freeDays]);
    if (calCache.key === key) return calCache;
    const hol = new Map();
    for (let y = +settings.start.slice(0, 4); y <= +settings.end.slice(0, 4); y++) holidaysNRW(y).forEach(([d, l]) => hol.set(d, l));
    const free = new Map();
    const rank = { ferien: 3, frei: 2, sperre: 1 };
    for (const f of settings.freeDays || []) {
      if (!isISO(f.from) || !isISO(f.to) || f.to < f.from) continue;
      for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
        const cur = free.get(d);
        if (!cur || rank[f.kind] > rank[cur.kind]) free.set(d, { kind: f.kind, label: f.label, span: [f.from, f.to] });
      }
    }
    const days = [], map = new Map();
    if (isISO(settings.start) && isISO(settings.end)) {
      for (let d = settings.start; d <= settings.end; d = addDays(d, 1)) {
        const w = dow(d);
        if (w === 0 || w === 6) continue;
        let kind = 'school', label = '', span = null;
        const f = free.get(d);
        if (f && f.kind === 'ferien') { kind = 'ferien'; label = f.label; span = f.span; }
        else if (hol.has(d)) { kind = 'feiertag'; label = hol.get(d); }
        else if (f) { kind = f.kind; label = f.label; span = f.span; }
        const wk = isoWeek(d);
        const day = { date: d, dow: w, week: wk.key, weekNo: wk.week, monday: wk.monday, kind, label, span };
        days.push(day); map.set(d, day);
      }
    }
    calCache = { key, days, map, holidays: hol };
    return calCache;
  }

  // -------------------------------------------------------------- Klassen
  function stage(cls) { return /^(EF|Q1|Q2|E\b|1[1-3])/i.test(cls) ? 'sek2' : 'sek1'; }
  function grade(cls) {
    const m = String(cls).match(/^(\d{1,2})/); if (m) return m[1];
    const m2 = String(cls).match(/^(EF|Q1|Q2)/i); if (m2) return m2[1].toUpperCase();
    return String(cls);
  }
  function rulesFor(settings, cls) { return settings.rules[stage(cls)]; }

  // -------------------------------------------------------- Voreinstellung
  function defaultSettings() {
    const classes = [];
    for (const g of [5, 6, 7, 8, 9, 10]) for (const c of 'abcd') classes.push(g + c);
    classes.push('EF', 'Q1', 'Q2');
    return {
      schoolYear: '2026/27',
      start: '2026-09-02',
      end: '2027-07-16',
      halfYear: '2027-02-01',
      classes,
      subjects: [
        ['D', 'Deutsch'], ['M', 'Mathematik'], ['E', 'Englisch'], ['F', 'Französisch'], ['L', 'Latein'],
        ['S', 'Spanisch'], ['WP', 'Wahlpflichtfach'], ['Bi', 'Biologie'], ['Ch', 'Chemie'], ['Ph', 'Physik'],
        ['Ek', 'Erdkunde'], ['Ge', 'Geschichte'], ['SoWi', 'Sozialwissenschaften'], ['If', 'Informatik'],
        ['Pa', 'Pädagogik'], ['Ku', 'Kunst'], ['Mu', 'Musik'], ['Re', 'Religion'], ['PL', 'Philosophie']
      ].map(([k, n]) => ({ k, n })),
      rules: { sek1: { max: 2, hardMax: 3 }, sek2: { max: 3, hardMax: 3 }, perDay: 1 },
      freeDays: [
        { id: 'f1', from: '2026-10-17', to: '2026-10-31', label: 'Herbstferien', kind: 'ferien' },
        { id: 'f2', from: '2026-12-23', to: '2027-01-06', label: 'Weihnachtsferien', kind: 'ferien' },
        { id: 'f3', from: '2027-03-22', to: '2027-04-03', label: 'Osterferien', kind: 'ferien' },
        { id: 'f4', from: '2027-05-18', to: '2027-05-18', label: 'Pfingstferien', kind: 'ferien' }
      ],
      notice: ''
    };
  }
  function newDatabase() { return { schema: 1, version: 1, settings: defaultSettings(), entries: [], log: [] }; }
  function migrate(db) {
    const def = defaultSettings();
    db.schema = db.schema || 1;
    db.version = db.version || 1;
    db.entries = Array.isArray(db.entries) ? db.entries : [];
    db.log = Array.isArray(db.log) ? db.log : [];
    db.settings = Object.assign({}, def, db.settings || {});
    db.settings.rules = Object.assign({}, def.rules, db.settings.rules || {});
    return db;
  }

  // ---------------------------------------------------------- Hilfsdinge
  const rid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 13).replace(/-/g, '')
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const cleanKuerzel = s => clean(s, 8).replace(/[^\p{L}\p{N}.\-]/gu, '').toUpperCase();

  function subjectName(settings, k) {
    const s = settings.subjects.find(x => x.k.toLowerCase() === String(k).toLowerCase());
    return s ? s.n : k;
  }
  function describe(settings, e) {
    if (e.type === 'termin') return `Termin „${e.subject}“ für ${e.classes.join(', ')} (${fmtRange(e.date, e.dateTo)})`;
    return `Klassenarbeit ${e.classes.join(', ')}, ${subjectName(settings, e.subject)} (${e.teacher || '–'}) am ${fmtDate(e.date)}`;
  }
  const listKA = es => es.map(e => `${e.subject} am ${fmtShort(e.date)}`).join(', ');

  /** Eingaben säubern. Gibt {error} oder das bereinigte Objekt zurück. */
  function normalize(body, settings) {
    body = body || {};
    const type = body.type === 'termin' ? 'termin' : 'ka';
    const known = new Map(settings.classes.map(c => [c.toLowerCase(), c]));
    const wanted = new Set((Array.isArray(body.classes) ? body.classes : []).map(c => String(c).toLowerCase()));
    const classes = settings.classes.filter(c => wanted.has(c.toLowerCase()));
    const unknown = [...wanted].filter(c => !known.has(c));
    const e = {
      type,
      classes,
      date: String(body.date || ''),
      subject: clean(body.subject, type === 'termin' ? 60 : 24),
      teacher: cleanKuerzel(body.teacher),
      note: clean(body.note, 140),
      reason: clean(body.reason, 300)
    };
    if (type === 'termin') e.dateTo = String(body.dateTo || body.date || '');
    if (unknown.length) return { error: `Unbekannte Klasse: ${unknown.join(', ')}` };
    return e;
  }

  // -------------------------------------------------------- Regelprüfung
  /**
   * Prüft einen geplanten Eintrag gegen alle vorhandenen.
   * status: ok | reason (nur mit Begründung) | blocked
   * issues: [{level: ok|info|warn|reason|block, cls, text}]
   */
  function check(settings, entries, cand, excludeId) {
    const issues = [];
    const add = (level, text, cls) => issues.push({ level, text, cls: cls || null });
    const others = entries.filter(e => e.id !== excludeId);
    const kas = others.filter(e => e.type !== 'termin');
    const termine = others.filter(e => e.type === 'termin');

    if (!cand.classes || !cand.classes.length) add('block', 'Bitte mindestens eine Klasse auswählen.');
    if (!isISO(cand.date)) add('block', 'Bitte ein gültiges Datum wählen.');

    if (cand.type === 'termin') {
      if (!cand.subject) add('block', 'Bitte eine Bezeichnung eingeben, zum Beispiel „Klassenfahrt“.');
      const to = cand.dateTo || cand.date;
      if (isISO(cand.date) && (!isISO(to) || to < cand.date)) add('block', 'Das Enddatum liegt vor dem Startdatum.');
      else if (isISO(cand.date) && (parseISO(to) - parseISO(cand.date)) / DAY > 60) add('block', 'Ein Termin darf höchstens 60 Tage lang sein.');
      if (issues.some(i => i.level === 'block')) return summarize(issues);
      for (const c of cand.classes) {
        const hits = kas.filter(e => e.classes.includes(c) && e.date >= cand.date && e.date <= to);
        if (hits.length) add('warn', `${c}: In diesem Zeitraum ist schon eingetragen: ${listKA(hits)}. Bitte mit der Lehrkraft absprechen.`, c);
      }
      const free = cand.classes.filter(c => !issues.some(i => i.cls === c));
      if (free.length) add('info', `${free.join(', ')}: ${to === cand.date ? 'An diesem Tag' : 'In diesem Zeitraum'} sind dann keine Klassenarbeiten möglich.`);
      return summarize(issues);
    }

    if (!cand.subject) add('block', 'Bitte ein Fach wählen.');
    if (!cand.teacher) add('block', 'Bitte Ihr Kürzel eintragen.');
    if (!isISO(cand.date)) return summarize(issues);

    const cal = calendar(settings);
    const day = cal.map.get(cand.date);
    const w = dow(cand.date);
    if (w === 0 || w === 6) add('block', 'Am Wochenende werden keine Arbeiten geschrieben.');
    else if (!day) add('block', `Das Datum liegt außerhalb des Schuljahres (${fmtRange(settings.start, settings.end)}).`);
    else if (day.kind === 'ferien') add('block', `${fmtDate(cand.date)} liegt in den ${day.label}.`);
    else if (day.kind === 'feiertag') add('block', `${fmtDate(cand.date)} ist ein Feiertag (${day.label}).`);
    else if (day.kind === 'frei') add('block', `${fmtDate(cand.date)} ist unterrichtsfrei (${day.label}).`);
    else if (day.kind === 'sperre') add('block', `Am ${fmtDate(cand.date)} sind keine Klassenarbeiten vorgesehen (${day.label}).`);
    if (issues.some(i => i.level === 'block')) return summarize(issues);

    const wk = isoWeek(cand.date);
    const perDay = settings.rules.perDay || 1;
    for (const c of cand.classes) {
      const r = rulesFor(settings, c);
      const ter = termine.find(e => e.classes.includes(c) && cand.date >= e.date && cand.date <= (e.dateTo || e.date));
      if (ter) { add('block', `${c}: ${ter.subject} (${fmtRange(ter.date, ter.dateTo)}). An diesem Tag ist keine Arbeit möglich.`, c); continue; }

      const same = kas.filter(e => e.classes.includes(c) && e.date === cand.date);
      if (same.length > perDay) add('block', `${c}: An diesem Tag stehen schon ${same.length} Arbeiten (${listKA(same)}).`, c);
      else if (same.length >= perDay) add('reason', `${c}: Am selben Tag steht schon ${listKA(same)}. Pro Tag ist nur eine Arbeit vorgesehen, eine Ausnahme ist nur bei getrennten Kursgruppen sinnvoll (z. B. F/L).`, c);

      const week = kas.filter(e => e.classes.includes(c) && e.date >= wk.monday && e.date <= wk.friday);
      const n = week.length + 1;
      if (n > r.hardMax) add('block', `${c}: Das wäre die ${n}. Arbeit in KW ${wk.week} (schon: ${listKA(week)}). Mehr als ${r.hardMax} sind nicht möglich.`, c);
      else if (n > r.max) add('reason', `${c}: Das wäre die ${n}. Arbeit in KW ${wk.week} (schon: ${listKA(week)}). Vorgesehen sind höchstens ${r.max}, mehr nur in Ausnahmefällen mit Begründung.`, c);
      else if (!same.length) add('ok', `${c}: ${n}. von ${r.max} Arbeiten in KW ${wk.week}` + (week.length ? ` (schon: ${listKA(week)})` : ''), c);
    }
    return summarize(issues);
  }
  function summarize(issues) {
    const status = issues.some(i => i.level === 'block') ? 'blocked' : issues.some(i => i.level === 'reason') ? 'reason' : 'ok';
    return { status, issues };
  }

  /** Nächster Schultag ab `from` (einschließlich), an dem der Eintrag ohne Ausnahme passt */
  function nextFree(settings, entries, cand, excludeId, from) {
    const cal = calendar(settings);
    for (const d of cal.days) {
      if (d.date < from || d.kind !== 'school') continue;
      if (check(settings, entries, Object.assign({}, cand, { date: d.date }), excludeId).status === 'ok') return d.date;
    }
    return null;
  }

  /** Zähler je Klasse und Woche */
  function weekCounts(entries) {
    const m = new Map();
    for (const e of entries) {
      if (e.type === 'termin') continue;
      const k = isoWeek(e.date).key;
      for (const c of e.classes) m.set(k + '|' + c, (m.get(k + '|' + c) || 0) + 1);
    }
    return m;
  }

  /** Prüfbericht über den ganzen Plan (nach Import oder für die Koordination) */
  function report(settings, entries) {
    const out = [];
    const cal = calendar(settings);
    const kas = entries.filter(e => e.type !== 'termin');
    const termine = entries.filter(e => e.type === 'termin');
    for (const e of kas) {
      const d = cal.map.get(e.date);
      if (!d) out.push({ level: 'block', date: e.date, ids: [e.id], text: `${describe(settings, e)}: kein Schultag im eingestellten Schuljahr.` });
      else if (d.kind !== 'school') out.push({ level: 'block', date: e.date, ids: [e.id], text: `${describe(settings, e)}: ${d.label || 'kein Unterrichtstag'}.` });
      for (const c of e.classes) {
        const t = termine.find(x => x.classes.includes(c) && e.date >= x.date && e.date <= (x.dateTo || x.date));
        if (t) out.push({ level: 'block', date: e.date, ids: [e.id, t.id], text: `${c}: ${e.subject} am ${fmtDate(e.date)} fällt in „${t.subject}“.` });
      }
    }
    const byWeek = new Map(), byDay = new Map();
    for (const e of kas) for (const c of e.classes) {
      const wk = isoWeek(e.date).key;
      (byWeek.get(wk + '|' + c) || byWeek.set(wk + '|' + c, []).get(wk + '|' + c)).push(e);
      (byDay.get(e.date + '|' + c) || byDay.set(e.date + '|' + c, []).get(e.date + '|' + c)).push(e);
    }
    for (const [k, es] of byWeek) {
      const c = k.split('|')[1]; const r = rulesFor(settings, c);
      if (es.length > r.max) {
        es.sort((a, b) => a.date.localeCompare(b.date));
        const why = es.filter(e => e.reason).map(e => `„${e.reason}“`).join(' ');
        out.push({
          level: es.length > r.hardMax ? 'block' : 'reason', date: es[0].date, ids: es.map(e => e.id),
          text: `${c}: ${es.length} Arbeiten in KW ${isoWeek(es[0].date).week} (${listKA(es)}).` + (why ? ` Begründung: ${why}` : ' Ohne Begründung.')
        });
      }
    }
    for (const [k, es] of byDay) {
      if (es.length > (settings.rules.perDay || 1)) {
        const c = k.split('|')[1];
        out.push({ level: 'reason', date: es[0].date, ids: es.map(e => e.id), text: `${c}: ${es.length} Arbeiten am ${fmtDate(es[0].date)} (${es.map(e => e.subject).join(', ')}).` });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ------------------------------------------------------ Einstellungen
  function validateSettings(b) {
    b = b || {};
    const s = {};
    s.schoolYear = clean(b.schoolYear, 20) || 'Schuljahr';
    for (const k of ['start', 'end', 'halfYear']) if (!isISO(b[k])) return { error: 'Bitte alle Daten im Schuljahr vollständig angeben.' };
    s.start = b.start; s.end = b.end; s.halfYear = b.halfYear;
    if (s.end <= s.start) return { error: 'Der letzte Schultag muss nach dem ersten liegen.' };
    if (s.halfYear <= s.start || s.halfYear > s.end) return { error: 'Der Beginn des 2. Halbjahres muss im Schuljahr liegen.' };
    if ((parseISO(s.end) - parseISO(s.start)) / DAY > 400) return { error: 'Das Schuljahr ist zu lang.' };

    const seen = new Set();
    s.classes = (Array.isArray(b.classes) ? b.classes : []).map(c => clean(c, 10)).filter(c => {
      if (!c || seen.has(c.toLowerCase())) return false; seen.add(c.toLowerCase()); return true;
    });
    if (!s.classes.length) return { error: 'Bitte mindestens eine Klasse eintragen.' };
    if (s.classes.length > 80) return { error: 'Höchstens 80 Klassen.' };

    const sk = new Set();
    s.subjects = (Array.isArray(b.subjects) ? b.subjects : []).map(x => ({ k: clean(x && x.k, 8), n: clean(x && x.n, 40) }))
      .filter(x => x.k && !sk.has(x.k.toLowerCase()) && sk.add(x.k.toLowerCase())).map(x => ({ k: x.k, n: x.n || x.k })).slice(0, 60);

    const r = b.rules || {};
    const num = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const rule = (x, d) => { const max = num(x && x.max, 1, 5, d.max); return { max, hardMax: Math.max(max, num(x && x.hardMax, 1, 6, d.hardMax)) }; };
    s.rules = { sek1: rule(r.sek1, { max: 2, hardMax: 3 }), sek2: rule(r.sek2, { max: 3, hardMax: 3 }), perDay: num(r.perDay, 1, 2, 1) };

    s.freeDays = [];
    for (const f of (Array.isArray(b.freeDays) ? b.freeDays : []).slice(0, 120)) {
      const from = parseDate(f && f.from), to = parseDate(f && f.to) || from;
      if (!from) continue;
      if (to < from) return { error: `Zeitraum „${clean(f.label, 60)}“: Das Ende liegt vor dem Anfang.` };
      s.freeDays.push({ id: clean(f.id, 20) || rid(), from, to, label: clean(f.label, 60) || FREE_KINDS[f.kind] || 'Frei', kind: FREE_KINDS[f.kind] ? f.kind : 'frei' });
    }
    s.freeDays.sort((a, b2) => a.from.localeCompare(b2.from));
    s.notice = clean(b.notice, 300);
    return s;
  }

  // -------------------------------------------------------------- Import
  function parseImport(settings, text) {
    const rows = [], errors = [];
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    const known = new Map(settings.classes.map(c => [c.toLowerCase(), c]));
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
      const f = line.split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
      const date = parseDate(f[0]);
      if (!date) { if (i > 0 || /\d/.test(f[0])) errors.push(`Zeile ${i + 1}: Datum „${f[0]}“ nicht erkannt.`); return; }
      const cls = (f[1] || '').split(/[\s,/+&]+/).filter(Boolean);
      const bad = cls.filter(c => !known.has(c.toLowerCase()));
      if (!cls.length || bad.length) { errors.push(`Zeile ${i + 1}: Klasse ${bad.length ? '„' + bad.join(', ') + '“ unbekannt' : 'fehlt'}.`); return; }
      if (!f[2]) { errors.push(`Zeile ${i + 1}: Fach fehlt.`); return; }
      rows.push({ type: 'ka', date, classes: cls.map(c => known.get(c.toLowerCase())), subject: clean(f[2], 24), teacher: cleanKuerzel(f[3]) || '?', note: clean(f[4], 140), reason: '' });
    });
    return { rows, errors };
  }

  function toCSV(settings, entries) {
    const q = v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const head = ['Art', 'Datum', 'bis', 'Wochentag', 'KW', 'Klassen', 'Fach', 'Fach (Name)', 'Kürzel', 'Bemerkung', 'Begründung', 'Eingetragen von', 'Eingetragen am'];
    const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map(e => [
      e.type === 'termin' ? 'Termin' : 'Klassenarbeit', fmtDate(e.date), e.type === 'termin' ? fmtDate(e.dateTo || e.date) : '',
      WD_LONG[dow(e.date)], isoWeek(e.date).week, e.classes.join(', '), e.subject, e.type === 'termin' ? '' : subjectName(settings, e.subject),
      e.teacher, e.note, e.reason, e.createdBy, (e.createdAt || '').slice(0, 16).replace('T', ' ')
    ]);
    return '\uFEFF' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n');
  }

  // ------------------------------------------------------------ Handler
  const ok = (body, status) => ({ status: status || 200, body });
  const fail = (status, error, extra) => ({ status, body: Object.assign({ error }, extra || {}) });

  function bump(db) { db.version = (db.version || 0) + 1; }
  function log(db, who, text, now) {
    db.log.push({ t: now, who: who || '–', text });
    if (db.log.length > 3000) db.log.splice(0, db.log.length - 3000);
  }
  function publicState(db) { return { version: db.version, settings: db.settings, entries: db.entries }; }

  /**
   * req: { method, path, body, role: null|'staff'|'admin', who, now }
   * Rückgabe: { status, body, changed? }
   */
  function handle(db, req) {
    const { method: m, path: p } = req;
    const body = req.body || {};
    const who = cleanKuerzel(req.who) || '?';
    const now = req.now || new Date().toISOString();
    if (req.role !== 'staff' && req.role !== 'admin') return fail(401, 'Bitte anmelden.');

    if (m === 'GET' && p === '/api/state') return ok(publicState(db));

    if (m === 'POST' && p === '/api/entries') {
      const cand = normalize(body, db.settings);
      if (cand.error) return fail(400, cand.error);
      if (cand.type === 'termin' && !cand.teacher) cand.teacher = who;
      const chk = check(db.settings, db.entries, cand, null);
      if (chk.status === 'blocked') return fail(409, chk.issues.find(i => i.level === 'block').text, { check: chk });
      if (chk.status === 'reason' && cand.reason.length < 3) return fail(409, 'Für diese Ausnahme ist eine kurze Begründung nötig.', { check: chk });
      if (chk.status === 'ok') cand.reason = '';
      const e = Object.assign({ id: rid() }, cand, { createdAt: now, createdBy: who, updatedAt: now, updatedBy: who });
      db.entries.push(e); bump(db);
      log(db, who, `eingetragen: ${describe(db.settings, e)}${e.reason ? ` – Begründung: ${e.reason}` : ''}`, now);
      return Object.assign(ok({ entry: e, version: db.version }, 201), { changed: true });
    }

    const em = p.match(/^\/api\/entries\/([A-Za-z0-9_-]{1,40})$/);
    if (em) {
      const i = db.entries.findIndex(e => e.id === em[1]);
      if (i < 0) return fail(404, 'Dieser Eintrag existiert nicht mehr. Die Ansicht wird aktualisiert.');
      const old = db.entries[i];
      if (m === 'DELETE') {
        db.entries.splice(i, 1); bump(db);
        log(db, who, `gelöscht: ${describe(db.settings, old)}`, now);
        return Object.assign(ok({ version: db.version }), { changed: true });
      }
      if (m === 'PUT') {
        const cand = normalize(Object.assign({ type: old.type }, body), db.settings);
        if (cand.error) return fail(400, cand.error);
        cand.type = old.type;
        if (cand.type === 'termin' && !cand.teacher) cand.teacher = old.teacher || who;
        const chk = check(db.settings, db.entries, cand, old.id);
        if (chk.status === 'blocked') return fail(409, chk.issues.find(x => x.level === 'block').text, { check: chk });
        if (chk.status === 'reason' && cand.reason.length < 3) return fail(409, 'Für diese Ausnahme ist eine kurze Begründung nötig.', { check: chk });
        if (chk.status === 'ok') cand.reason = '';
        const e = Object.assign({}, old, cand, { updatedAt: now, updatedBy: who });
        db.entries[i] = e; bump(db);
        log(db, who, `geändert: ${describe(db.settings, old)} → ${describe(db.settings, e)}`, now);
        return Object.assign(ok({ entry: e, version: db.version }), { changed: true });
      }
    }

    if (p.startsWith('/api/admin/')) {
      if (req.role !== 'admin') return fail(403, 'Nur für die Verwaltung.');
      const adminWho = 'Verwaltung' + (req.who ? ` (${cleanKuerzel(req.who)})` : '');

      if (m === 'GET' && p === '/api/admin/log') return ok({ log: db.log.slice(-600).reverse() });
      if (m === 'GET' && p === '/api/admin/report') return ok({ issues: report(db.settings, db.entries) });
      if (m === 'GET' && p === '/api/admin/backup') {
        return ok({ app: 'klassenarbeitsplaner', exportedAt: now, version: db.version, settings: db.settings, entries: db.entries, log: db.log });
      }
      if (m === 'PUT' && p === '/api/admin/settings') {
        const s = validateSettings(body);
        if (s.error) return fail(400, s.error);
        const removed = db.settings.classes.filter(c => !s.classes.includes(c));
        const orphaned = db.entries.filter(e => e.classes.some(c => removed.includes(c))).length;
        db.settings = s; bump(db);
        log(db, adminWho, 'Einstellungen gespeichert' + (removed.length ? ` (entfernte Klassen: ${removed.join(', ')})` : ''), now);
        return Object.assign(ok({ settings: s, version: db.version, orphaned }), { changed: true });
      }
      if (m === 'POST' && p === '/api/admin/import') {
        const { rows, errors } = parseImport(db.settings, body.csv);
        if (body.dryRun) {
          const sim = db.entries.concat(rows.map((r, i) => Object.assign({ id: 'neu' + i }, r)));
          return ok({ count: rows.length, errors, issues: report(db.settings, sim).filter(x => x.ids.some(id => id.startsWith('neu'))) });
        }
        for (const r of rows) db.entries.push(Object.assign({ id: rid() }, r, { createdAt: now, createdBy: 'Import', updatedAt: now, updatedBy: 'Import' }));
        if (rows.length) { bump(db); log(db, adminWho, `${rows.length} Einträge importiert`, now); }
        return Object.assign(ok({ count: rows.length, errors, version: db.version }), { changed: rows.length > 0 });
      }
      if (m === 'POST' && p === '/api/admin/restore') {
        const d = body.data || {};
        if (d.app !== 'klassenarbeitsplaner' || !Array.isArray(d.entries)) return fail(400, 'Das ist keine Sicherung des Klassenarbeitsplaners.');
        const s = validateSettings(d.settings);
        if (s.error) return fail(400, 'Sicherung fehlerhaft: ' + s.error);
        db.settings = s;
        db.entries = d.entries.filter(e => e && e.id && isISO(e.date) && Array.isArray(e.classes));
        bump(db); log(db, adminWho, `Sicherung vom ${String(d.exportedAt || '').slice(0, 10)} eingespielt (${db.entries.length} Einträge)`, now);
        return Object.assign(ok({ version: db.version, count: db.entries.length }), { changed: true });
      }
      if (m === 'DELETE' && p === '/api/admin/entries') {
        if (body.confirm !== 'LÖSCHEN') return fail(400, 'Zum Bestätigen LÖSCHEN eintippen.');
        const n = db.entries.length;
        db.entries = []; bump(db); log(db, adminWho, `alle ${n} Einträge gelöscht`, now);
        return Object.assign(ok({ version: db.version }), { changed: true });
      }
    }
    return fail(404, 'Unbekannte Anfrage.');
  }

  return {
    // Datum
    parseISO, toISO, isISO, addDays, dow, isoWeek, todayISO, fmtDate, fmtShort, fmtDM, fmtRange, parseDate, WD, WD_LONG,
    // Kalender und Regeln
    easter, holidaysNRW, calendar, stage, grade, rulesFor, check, nextFree, weekCounts, report, FREE_KINDS,
    // Daten
    defaultSettings, newDatabase, migrate, validateSettings, parseImport, toCSV, subjectName, describe, normalize, cleanKuerzel,
    // API
    handle, publicState
  };
});
