/* Erzeugt einen realistischen Beispielplan (nur für Demo und Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAP_DEMO_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return function seed(K, settings) {
    let x = 20260930;
    const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const teachers = ['BRA', 'KLE', 'MÜL', 'SCH', 'WEB', 'HOF', 'KRA', 'NEU', 'LAN', 'ZIM', 'FRI', 'BEC', 'ALT', 'DOR', 'HEI', 'OST', 'RIE', 'VOG'];
    const entries = [];
    let n = 0;
    const days = K.calendar(settings).days.filter(d => d.kind === 'school');
    const stamp = '2026-09-0' + '7T07:30:00.000Z';
    const add = (e, force) => {
      e = Object.assign({ id: 'd' + (++n), note: '', reason: '', createdAt: stamp, updatedAt: stamp }, e);
      e.createdBy = e.updatedBy = e.teacher;
      if (!force && K.check(settings, entries, e, null).status !== 'ok') return false;
      entries.push(e); return true;
    };
    const near = (target, fn) => {
      const i0 = days.findIndex(d => d.date >= target);
      if (i0 < 0) return false;
      for (let k = 0; k < 9; k++) for (const s of k ? [k, -k] : [0]) {
        const d = days[i0 + s]; if (d && fn(d.date)) return true;
      }
      return false;
    };
    // Klassenfahrt und Praktikum
    add({ type: 'termin', classes: ['6b'], date: '2026-11-09', dateTo: '2026-11-13', subject: 'Klassenfahrt', teacher: 'KRA' }, true);
    add({ type: 'termin', classes: ['9a', '9b', '9c', '9d'], date: '2027-01-18', dateTo: '2027-01-29', subject: 'Praktikum', teacher: 'LAN' }, true);

    for (const c of settings.classes) {
      const g = K.grade(c);
      const sek2 = K.stage(c) === 'sek2';
      let subj = ['D', 'M', 'E'];
      if (+g >= 7) subj.push(c.endsWith('a') || c.endsWith('b') ? 'F' : 'L');
      if (+g >= 9) subj.push('WP');
      if (sek2) subj = ['D', 'M', 'E', 'Bi', 'Ge', 'Ph', 'SoWi'];
      const per = sek2 ? 2 : (+g <= 6 ? 6 : 5);
      subj.forEach((s, si) => {
        const t = teachers[Math.floor(rnd() * teachers.length)];
        for (let k = 0; k < per; k++) {
          const off = 18 + si * 5 + Math.floor(rnd() * 6) + k * (sek2 ? 120 : 52);
          const target = K.addDays(settings.start, off);
          if (target > settings.end) break;
          near(target, date => add({ type: 'ka', classes: [c], date, subject: s, teacher: t }));
        }
      });
    }
    // Zwei Ausnahmen mit Begründung, damit der Plan sie zeigt
    const pick = cls => entries.filter(e => e.type === 'ka' && e.classes.includes(cls) && e.date > '2026-11-01').sort((a, b) => a.date.localeCompare(b.date));
    for (const [cls, s, why] of [['7c', 'Bi', 'Nachschreibtermin nach Krankheitswelle, mit Klassenleitung abgesprochen'], ['8a', 'D', 'Zentrale Vergleichsarbeit, Termin vom Land vorgegeben']]) {
      const base = pick(cls)[0];
      if (!base) continue;
      const wk = K.isoWeek(base.date);
      const used = entries.filter(e => e.type === 'ka' && e.classes.includes(cls) && e.date >= wk.monday && e.date <= wk.friday);
      if (used.length < 2) {
        const free = days.find(d => d.date >= wk.monday && d.date <= wk.friday && !used.some(u => u.date === d.date) && d.date !== base.date);
        if (free) add({ type: 'ka', classes: [cls], date: free.date, subject: s === 'Bi' ? 'E' : 'M', teacher: 'OST' }, true);
      }
      const now = entries.filter(e => e.type === 'ka' && e.classes.includes(cls) && e.date >= wk.monday && e.date <= wk.friday);
      const free = days.find(d => d.date >= wk.monday && d.date <= wk.friday && !now.some(u => u.date === d.date));
      if (free) add({ type: 'ka', classes: [cls], date: free.date, subject: s, teacher: 'RIE', reason: why }, true);
    }
    return entries;
  };
});
