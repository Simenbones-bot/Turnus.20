/* Turnusgenerator – Drøftingsverktøy
   Vanilla JS, no build step. */

// ====== State ======
let weeks = [];        // [weekIdx][dayIdx] -> [{start, end}] in minutes from midnight; end can be > 1440
let weekMeta = [];     // [{num, year}]
let activeWeek = 0;
let drag = { mode: null };
let lastebil = false;
let formData = {
  avdeling: '',
  avdelingsleder: '',
  typeTurnus: 'Personlig',
  ikrafttredelsesdato: '',
  navn: '',
  antallSjaforer: 1,
  aarsak: '',
  fagforbundetSyn: '',
  annenKommentar: '',
  epostTillitsvalgt: '',
  epostLeder: '',
  rullerende: false,
  lastebil: false,
};
let fatsResult = { broken: [], warnings: [], shiftFlags: {}, weekFlags: {} };
let lastSavedAt = null;

const DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const DAY_SHORT = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
const TIMELINE_START = 0;
const TIMELINE_END = 24 * 60; // 24 hours in minutes
const SNAP = 15;
const MIN_SHIFT = 15;

// ====== Utilities ======
function minutesToHHMM(min) {
  const h = Math.floor((min % (24 * 60)) / 60);
  const mm = min % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
function snap(x) { return Math.round(x / SNAP) * SNAP; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ISO week to date (returns Monday of ISO week)
function isoWeekToDate(week, year) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const isoDay = dow === 0 ? 7 : dow;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - isoDay + 1);
  return monday;
}
function formatDateShort(d) {
  return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function formatDateNO(isoStr) {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-');
  return `${d}.${m}.${y}`;
}
function isoWeeksInYear(year) {
  const d = new Date(Date.UTC(year, 11, 31));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const MONTH_SHORT_NO = ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'];

function isRotasjon() { return !!formData.rullerende; }

function dateToIsoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { num: weekNo, year: d.getUTCFullYear() };
}

function currentIsoWeek() {
  const now = new Date();
  return dateToIsoWeek(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

function addWeeksToIso(num, year, n) {
  const monday = isoWeekToDate(num, year);
  monday.setUTCDate(monday.getUTCDate() + n * 7);
  return dateToIsoWeek(monday);
}

function parseIsoDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function mondayOfWeekContaining(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d;
}

function formatDateRangeNo(mon, sun) {
  const monDay = mon.getUTCDate();
  const sunDay = sun.getUTCDate();
  const sunMonth = MONTH_SHORT_NO[sun.getUTCMonth()];
  const monMonth = MONTH_SHORT_NO[mon.getUTCMonth()];
  const year = sun.getUTCFullYear();
  if (mon.getUTCMonth() === sun.getUTCMonth() && mon.getUTCFullYear() === sun.getUTCFullYear()) {
    return `${monDay}. – ${sunDay}. ${sunMonth} ${year}`;
  }
  return `${monDay}. ${monMonth} – ${sunDay}. ${sunMonth} ${year}`;
}

function recomputeCalendarWeeksFromFirst(first) {
  for (let j = 0; j < weekMeta.length; j++) {
    const w = j === 0 ? first : addWeeksToIso(first.num, first.year, j);
    weekMeta[j] = { num: w.num, year: w.year };
  }
}

function defaultFirstCalendarWeek() {
  if (formData.ikrafttredelsesdato) {
    const date = parseIsoDate(formData.ikrafttredelsesdato);
    if (date) return dateToIsoWeek(date);
  }
  const today = currentIsoWeek();
  return addWeeksToIso(today.num, today.year, 2);
}

function isSundayCrossWeek(shift, dayIdx) {
  return dayIdx === 6 && shift.end > TIMELINE_END;
}

function splitShiftAcrossWeeks(shift, dayIdx) {
  if (!isSundayCrossWeek(shift, dayIdx)) {
    const avail = availabilityMinutes(shift);
    return {
      isSplit: false,
      currentWeekBrutto: shiftGross(shift),
      nextWeekBrutto: 0,
      currentWeekLunch: lunchMinutes(shiftGross(shift)),
      nextWeekLunch: 0,
      currentWeekNet: shiftNet(shift),
      nextWeekNet: 0,
      currentWeekAvail: avail,
      nextWeekAvail: 0,
      currentWeekPaid: shiftPaid(shift),
      nextWeekPaid: 0,
    };
  }
  const currentBrutto = TIMELINE_END - shift.start;
  const nextBrutto = shift.end - TIMELINE_END;
  const totalBrutto = shiftGross(shift);
  const totalLunch = lunchMinutes(totalBrutto);
  const currentLunch = Math.round((currentBrutto / totalBrutto) * totalLunch);
  const nextLunch = totalLunch - currentLunch;
  // Split availability by which side of midnight each period falls
  let curAvail = 0, nxtAvail = 0;
  (shift.availability || []).forEach(p => {
    const lo = Math.max(0, p.start);
    const hi = Math.max(lo, p.end);
    const before = Math.max(0, Math.min(hi, TIMELINE_END) - Math.min(lo, TIMELINE_END));
    const after = Math.max(0, Math.max(hi, TIMELINE_END) - Math.max(lo, TIMELINE_END));
    if (lastebil) { curAvail += before; nxtAvail += after; }
  });
  return {
    isSplit: true,
    currentWeekBrutto: currentBrutto,
    nextWeekBrutto: nextBrutto,
    currentWeekLunch: currentLunch,
    nextWeekLunch: nextLunch,
    currentWeekNet: Math.max(0, currentBrutto - currentLunch),
    nextWeekNet: Math.max(0, nextBrutto - nextLunch),
    currentWeekAvail: curAvail,
    nextWeekAvail: nxtAvail,
    currentWeekPaid: Math.max(0, currentBrutto - currentLunch - curAvail),
    nextWeekPaid: Math.max(0, nextBrutto - nextLunch - nxtAvail),
  };
}

function maybeCreateNextWeekForCrossWeekShifts() {
  for (let wi = 0; wi < weeks.length; wi++) {
    if ((weeks[wi][6] || []).some(s => s.end > TIMELINE_END)) {
      if (wi + 1 >= weeks.length) {
        const lastMeta = weekMeta[wi];
        const nextMeta = isRotasjon()
          ? { num: lastMeta.num + 1, year: null }
          : addWeeksToIso(lastMeta.num, lastMeta.year, 1);
        weekMeta.push(nextMeta);
        weeks.push(emptyWeek());
      }
    }
  }
}

// ====== Shift category ======
function categorizeShift(weekIdx, dayIdx, shift) {
  if (dayIdx >= 5) return 'helg';
  const overlap = (s, e, ws, we) => {
    const lo = Math.max(s, ws);
    const hi = Math.min(e, we);
    return Math.max(0, hi - lo);
  };
  // Day windows in minutes; for parts past midnight (>1440), normalize via offset
  // We compute overlap in original (start..end) space, treating "06-18" "14-23" "22-06" cycles.
  // Build candidates as ranges to test against the shift, possibly extended by +24h.
  const ranges = {
    dag:   [[6 * 60, 18 * 60], [(6 + 24) * 60, (18 + 24) * 60]],
    kveld: [[14 * 60, 23 * 60], [(14 + 24) * 60, (23 + 24) * 60]],
    natt:  [[22 * 60, (24 + 6) * 60], [-2 * 60, 6 * 60]], // night wraps midnight; also handle starting before midnight on prev day
  };
  const scores = { dag: 0, kveld: 0, natt: 0 };
  for (const cat in ranges) {
    for (const [ws, we] of ranges[cat]) {
      scores[cat] += overlap(shift.start, shift.end, ws, we);
    }
  }
  let best = 'dag';
  let bestVal = -1;
  for (const cat of ['dag', 'kveld', 'natt']) {
    if (scores[cat] > bestVal) { bestVal = scores[cat]; best = cat; }
  }
  return best;
}

// ====== Lunch & nettotid ======
function lunchMinutes(grossMin) {
  if (lastebil) {
    if (grossMin > 540) return 45;
    if (grossMin >= 360) return 30;
    return 0;
  }
  return grossMin > 330 ? 30 : 0;
}
function shiftGross(s) { return s.end - s.start; }
function shiftNet(s) { return Math.max(0, shiftGross(s) - lunchMinutes(shiftGross(s))); }
function availabilityMinutes(s) {
  if (!lastebil || !s.availability || !s.availability.length) return 0;
  return s.availability.reduce((sum, p) => sum + Math.max(0, p.end - p.start), 0);
}
// Paid / "lønnstid": for lastebil with availability, subtract availability;
// otherwise identical to shiftNet.
function shiftPaid(s) {
  return Math.max(0, shiftNet(s) - availabilityMinutes(s));
}
// Ensure new fields exist on every shift (migration helper).
function ensureShiftDefaults(s) {
  if (!s.availability || !Array.isArray(s.availability)) s.availability = [];
  return s;
}
function cleanupShiftAvailability(s) {
  if (!s || !s.availability || !s.availability.length) return;
  s.availability = s.availability
    .map(p => ({ start: Math.max(p.start, s.start), end: Math.min(p.end, s.end) }))
    .filter(p => p.end - p.start >= SNAP);
}
function migrateAllShifts() {
  weeks.forEach(w => w.forEach(day => day.forEach(ensureShiftDefaults)));
}

// ====== FATS validation ======
function validateFATS() {
  const result = {
    broken: [], warnings: [], shiftFlags: {}, weekFlags: {},
    reducedRest: {}, // `${wi}-${di}-${si}` -> { n, gapMin, broken }
    reducedRestSummary: { total: 0, currentCount: 0, breached: 0 },
  };

  // Overlap check — always runs, regardless of lastebil
  weeks.forEach((week, wi) => {
    week.forEach((day, di) => {
      // Sort indices by start time so we only need consecutive checks
      const sorted = day.map((s, si) => ({ s, si })).sort((a, b) => a.s.start - b.s.start);
      const flagged = new Set();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i].s, b = sorted[j].s;
          if (a.start < b.end && b.start < a.end) {
            const keyA = `${wi}-${di}-${sorted[i].si}`;
            const keyB = `${wi}-${di}-${sorted[j].si}`;
            result.shiftFlags[keyA] = 'broken';
            result.shiftFlags[keyB] = 'broken';
            if (!flagged.has(di)) {
              flagged.add(di);
              result.broken.push({
                week: wi, dayIdx: di,
                rule: 'overlap',
                text: `Vakter på ${DAY_SHORT[di]} (uke ${weekMeta[wi].num}) overlapper hverandre`,
              });
            }
          }
        }
      }
    });
  });

  if (!lastebil) { fatsResult = result; return; }

  weeks.forEach((week, wi) => {
    let weekTotal = 0;

    // Add cross-week Monday contribution from previous week's Sunday shift
    if (wi > 0 && weeks[wi - 1]) {
      (weeks[wi - 1][6] || []).forEach(s => {
        if (s.end > TIMELINE_END) {
          weekTotal += splitShiftAcrossWeeks(s, 6).nextWeekPaid;
        }
      });
    }

    // Rule 1: per-shift arbeidstid > 600 min (10h)
    week.forEach((day, di) => {
      day.forEach((s, si) => {
        const paid = shiftPaid(s);
        const split = splitShiftAcrossWeeks(s, di);
        weekTotal += split.currentWeekPaid;
        if (paid > 600) {
          const key = `${wi}-${di}-${si}`;
          result.shiftFlags[key] = 'broken';
          result.broken.push({
            week: wi, dayIdx: di,
            rule: 'shift-10h',
            text: `Vakt ${DAY_SHORT[di]} er ${(paid / 60).toFixed(1)} t arbeidstid (over 10 t)`,
          });
        }
      });
    });

    // Rule 2: weekly arbeidstid > 3600 min (60h)
    if (weekTotal > 3600) {
      result.weekFlags[wi] = 'broken';
      result.broken.push({
        week: wi,
        rule: 'week-60h',
        text: `Sum uke ${weekMeta[wi].num}: ${(weekTotal / 60).toFixed(1)} t (over 60 t)`,
      });
      week.forEach((day, di) => {
        day.forEach((_, si) => {
          result.shiftFlags[`${wi}-${di}-${si}`] = 'broken';
        });
      });
    }
  });

  // Rule 3: chronological reduced daily rest with counter (across all weeks)
  // Build chronological list of all shifts as absolute minutes from start of turnus.
  // For cross-week Sunday shifts (end > 1440), we DO NOT duplicate them — their
  // absEnd already extends into next week's Monday in absolute terms.
  const allShifts = [];
  weeks.forEach((week, wi) => {
    week.forEach((day, di) => {
      day.forEach((s, si) => {
        const base = (wi * 7 + di) * 1440;
        allShifts.push({
          key: `${wi}-${di}-${si}`,
          wi, di, si,
          absStart: base + s.start,
          absEnd: base + s.end,
        });
      });
    });
  });
  allShifts.sort((a, b) => a.absStart - b.absStart);

  let counter = 0;
  for (let i = 1; i < allShifts.length; i++) {
    const prev = allShifts[i - 1];
    const cur = allShifts[i];
    const gap = cur.absStart - prev.absEnd;
    if (gap >= 2700) {
      // ≥ 45h: ukehvile — reset counter
      counter = 0;
      continue;
    }
    if (gap < 540) {
      // Hard breach: < 9h rest
      result.shiftFlags[cur.key] = 'broken';
      result.broken.push({
        week: cur.wi, dayIdx: cur.di,
        rule: 'rest-9h',
        text: `Hviletid før ${DAY_SHORT[cur.di]} (uke ${weekMeta[cur.wi].num}) er ${(gap / 60).toFixed(1)} t (under 9 t)`,
      });
      continue;
    }
    if (gap < 660) {
      // 9–11h: reduced daily rest
      counter += 1;
      const broken = counter > 3;
      result.reducedRest[cur.key] = { n: counter, gapMin: gap, broken };
      result.reducedRestSummary.total += 1;
      if (broken) {
        result.shiftFlags[cur.key] = 'broken';
        result.reducedRestSummary.breached += 1;
        result.broken.push({
          week: cur.wi, dayIdx: cur.di,
          rule: 'rest-reduced',
          text: `Den ${counter}. reduserte døgnhvilen siden forrige ukehvile før ${DAY_SHORT[cur.di]} (uke ${weekMeta[cur.wi].num}) — maks 3 tillatt`,
        });
      } else {
        result.warnings.push({
          week: cur.wi, dayIdx: cur.di,
          rule: 'rest-reduced',
          text: `Redusert døgnhvil ${counter}/3 før ${DAY_SHORT[cur.di]} (uke ${weekMeta[cur.wi].num}): ${(gap / 60).toFixed(1)} t`,
        });
      }
    }
    // gap >= 660: normal rest, no marker, counter unchanged
  }
  result.reducedRestSummary.currentCount = counter;

  weeks.forEach((week, wi) => {

    // Rule 4: largest gap in week >= 1440
    const all = [];
    week.forEach((day, di) => {
      day.forEach(s => {
        const absStart = di * 1440 + s.start;
        const absEnd = isSundayCrossWeek(s, di)
          ? 6 * 1440 + TIMELINE_END
          : di * 1440 + s.end;
        all.push({ s: absStart, e: absEnd });
      });
    });
    if (wi > 0 && weeks[wi - 1]) {
      (weeks[wi - 1][6] || []).forEach(s => {
        if (s.end > TIMELINE_END) all.push({ s: 0, e: s.end - TIMELINE_END });
      });
    }
    if (all.length >= 1) {
      all.sort((a, b) => a.s - b.s);
      // include rest before first shift and after last shift within the week
      let maxGap = all[0].s; // gap from Mon 00:00 to first shift start
      for (let i = 1; i < all.length; i++) {
        const g = all[i].s - all[i - 1].e;
        if (g > maxGap) maxGap = g;
      }
      const gapAfter = 7 * 1440 - all[all.length - 1].e; // gap from last shift end to Sun 23:59
      if (gapAfter > maxGap) maxGap = gapAfter;
      if (maxGap < 1440) {
        if (!result.weekFlags[wi]) result.weekFlags[wi] = 'warn';
        result.warnings.push({
          week: wi,
          rule: 'rest-24h',
          text: `Uke ${weekMeta[wi].num}: lengste sammenhengende hviletid er ${(maxGap / 60).toFixed(1)} t`,
        });
      }
    }
  });

  fatsResult = result;
}

// ====== Persistence ======
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 1000);
}
function saveDraft() {
  const payload = {
    weeks, weekMeta, activeWeek, lastebil, formData,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem('turnus-draft', JSON.stringify(payload));
    lastSavedAt = new Date();
    updateAutosaveHint();
  } catch (_) { /* ignore */ }
}
function loadDraftRaw() {
  try {
    const s = localStorage.getItem('turnus-draft');
    if (!s) return null;
    return JSON.parse(s);
  } catch (_) { return null; }
}
function discardDraft() {
  localStorage.removeItem('turnus-draft');
}
function updateAutosaveHint() {
  const el = document.getElementById('autosave-hint');
  if (!el) return;
  if (!lastSavedAt) {
    el.textContent = 'Ikke lagret ennå';
  } else {
    const t = lastSavedAt;
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    el.textContent = `Sist lagret kl. ${hh}:${mm} · auto-lagret som utkast`;
  }
}

// ====== Initial data ======
function initDefaults() {
  const today = currentIsoWeek();
  const first = addWeeksToIso(today.num, today.year, 2);
  weekMeta = [{ num: first.num, year: first.year }];
  weeks = [emptyWeek()];
  weeks[0][0] = [{ start: 7 * 60, end: 15 * 60, availability: [] }];
  activeWeek = 0;
  formData.avdeling = 'Bergen Distribusjon';
  formData.avdelingsleder = 'Ingrid Solheim';
  formData.typeTurnus = 'Personlig';
  formData.ikrafttredelsesdato = '';
}
function emptyWeek() { return [[], [], [], [], [], [], []]; }

// ====== Rendering ======
function renderAll() {
  validateFATS();
  syncFormToDOM();
  renderWeekTabs();
  renderDateRange();
  renderTimeline();
  renderDetailList();
  renderSummary();
  renderFatsPanel();
  updateCompleteBadges();
  updatePdfState();
}

function syncFormToDOM() {
  const el = id => document.getElementById(id);
  el('f-avdeling').value = formData.avdeling || '';
  el('f-avdelingsleder').value = formData.avdelingsleder || '';
  el('f-type').value = formData.typeTurnus || 'Personlig';
  el('f-ikraft').value = formData.ikrafttredelsesdato || '';
  el('f-navn').value = formData.navn || '';
  el('f-antall').value = formData.antallSjaforer || 1;
  el('f-epost-tv').value = formData.epostTillitsvalgt || '';
  el('f-epost-leder').value = formData.epostLeder || '';
  el('f-rullerende').checked = !!formData.rullerende;
  el('f-lastebil').checked = !!formData.lastebil;
  el('f-aarsak').value = formData.aarsak || '';
  el('f-fagforbund').value = formData.fagforbundetSyn || '';
  el('f-kommentar').value = formData.annenKommentar || '';
  // Show/hide name vs antall
  const personlig = formData.typeTurnus === 'Personlig';
  el('wrap-navn').hidden = !personlig;
  el('wrap-antall').hidden = personlig;
}

function renderWeekTabs() {
  const tabs = document.getElementById('week-tabs');
  tabs.innerHTML = '';
  weekMeta.forEach((wm, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'week-tab';
    if (i === activeWeek) tab.classList.add('active');
    if (fatsResult.weekFlags[i] === 'broken') tab.classList.add('fats-broken');
    if (fatsResult.weekFlags[i] === 'warn') tab.classList.add('fats-warn');
    const yearSuffix = isRotasjon()
      ? ''
      : `<span class="tab-year mono">'${String(wm.year).slice(-2)}</span>`;
    tab.innerHTML = `<span class="tab-label">Uke ${wm.num}</span>` + yearSuffix;
    tab.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close')) return;
      activeWeek = i; renderAll();
    });
    tab.addEventListener('dblclick', () => editWeekTab(i, tab));
    if (weekMeta.length > 1) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.textContent = '×';
      close.addEventListener('click', e => {
        e.stopPropagation();
        confirmDialog(`Slette uke ${wm.num}?`, 'Dette kan ikke angres.', () => {
          weeks.splice(i, 1);
          weekMeta.splice(i, 1);
          activeWeek = clamp(activeWeek, 0, weeks.length - 1);
          scheduleSave();
          renderAll();
        });
      });
      tab.appendChild(close);
    }
    tabs.appendChild(tab);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'week-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'Legg til ny uke';
  addBtn.addEventListener('click', addWeek);
  tabs.appendChild(addBtn);
}

function editWeekTab(i, tabEl) {
  const wm = weekMeta[i];
  const rot = isRotasjon();
  tabEl.innerHTML = '';
  const numInp = document.createElement('input');
  numInp.type = 'number';
  numInp.min = 1;
  numInp.value = wm.num;
  numInp.className = 'week-edit-input';
  if (!rot) numInp.max = 53;
  tabEl.appendChild(numInp);

  let yearInp = null;
  if (!rot) {
    yearInp = document.createElement('input');
    yearInp.type = 'number';
    yearInp.min = 2000;
    yearInp.max = 2100;
    yearInp.value = wm.year || new Date().getFullYear();
    yearInp.className = 'week-edit-input';
    tabEl.appendChild(yearInp);
  }
  numInp.focus();
  numInp.select();

  const commit = () => {
    if (rot) {
      const newNum = Math.max(1, parseInt(numInp.value) || 1);
      for (let j = i; j < weekMeta.length; j++) {
        weekMeta[j] = { num: newNum + (j - i), year: null };
      }
    } else {
      const newYear = parseInt(yearInp.value) || wm.year || new Date().getFullYear();
      const max = isoWeeksInYear(newYear);
      const newNum = clamp(parseInt(numInp.value) || 1, 1, max);
      weekMeta[i] = { num: newNum, year: newYear };
      for (let j = i + 1; j < weekMeta.length; j++) {
        const w = addWeeksToIso(newNum, newYear, j - i);
        weekMeta[j] = { num: w.num, year: w.year };
      }
    }
    scheduleSave();
    renderAll();
  };

  const handleBlur = (e) => {
    if (yearInp && (e.relatedTarget === numInp || e.relatedTarget === yearInp)) return;
    commit();
  };
  const onKey = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') renderAll();
  };
  numInp.addEventListener('blur', handleBlur);
  numInp.addEventListener('keydown', onKey);
  if (yearInp) {
    yearInp.addEventListener('blur', handleBlur);
    yearInp.addEventListener('keydown', onKey);
  }
}

function addWeek() {
  if (isRotasjon()) {
    const last = weekMeta[weekMeta.length - 1];
    const nextNum = (last && last.num ? last.num : 0) + 1;
    weekMeta.push({ num: nextNum, year: null });
  } else {
    const last = weekMeta[weekMeta.length - 1];
    if (last && last.year) {
      const next = addWeeksToIso(last.num, last.year, 1);
      weekMeta.push({ num: next.num, year: next.year });
    } else {
      const first = defaultFirstCalendarWeek();
      weekMeta.push({ num: first.num, year: first.year });
    }
  }
  weeks.push(emptyWeek());
  activeWeek = weeks.length - 1;
  scheduleSave();
  renderAll();
}

function renderDateRange() {
  const el = document.getElementById('week-daterange');
  if (!weekMeta[activeWeek]) { el.textContent = ''; return; }
  if (isRotasjon()) {
    const base = parseIsoDate(formData.ikrafttredelsesdato);
    if (!base) { el.textContent = ''; return; }
    const baseMonday = mondayOfWeekContaining(base);
    const mon = new Date(baseMonday);
    mon.setUTCDate(mon.getUTCDate() + activeWeek * 7);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    el.textContent = formatDateRangeNo(mon, sun);
  } else {
    const wm = weekMeta[activeWeek];
    if (!wm.year) { el.textContent = ''; return; }
    const mon = isoWeekToDate(wm.num, wm.year);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    el.textContent = formatDateRangeNo(mon, sun);
  }
}

// Build availability stripe spans for the portion of a shift in [portionStart..portionEnd]
function addDuplicateButtonHtml() {
  return `<button type="button" class="shift-duplicate" data-duplicate aria-label="Kopieringsalternativer" title="Kopier vakt">↓</button>`;
}

// Floating duplicate menu (portal — rendered on body to escape overflow:hidden)
let dupMenuEl = null;
let dupMenuContext = null; // { weekIdx, di, si }

function ensureDupMenu() {
  if (dupMenuEl) return;
  dupMenuEl = document.createElement('div');
  dupMenuEl.className = 'shift-dup-menu';
  dupMenuEl.hidden = true;
  dupMenuEl.innerHTML = `
    <button type="button" data-dup-action="next">Kopier vakt</button>
    <button type="button" data-dup-action="weekdays">Kopier alle hverdager</button>`;
  dupMenuEl.addEventListener('click', e => {
    const action = e.target.closest('[data-dup-action]');
    if (!action || !dupMenuContext) return;
    e.stopPropagation();
    const { weekIdx, di, si } = dupMenuContext;
    const shift = weeks[weekIdx] && weeks[weekIdx][di] && weeks[weekIdx][di][si];
    if (!shift) { closeDupMenu(); return; }
    const makeClampedCopy = () => ({
      start: shift.start,
      end: shift.end > TIMELINE_END ? TIMELINE_END : shift.end,
      availability: JSON.parse(JSON.stringify(shift.availability || [])),
    });
    if (action.dataset.dupAction === 'next') {
      const nextDi = di + 1;
      if (nextDi < 7) {
        weeks[weekIdx][nextDi].push(makeClampedCopy());
      } else {
        if (weekIdx + 1 >= weeks.length) {
          const lastMeta = weekMeta[weekIdx];
          const nextMeta = isRotasjon()
            ? { num: lastMeta.num + 1, year: null }
            : addWeeksToIso(lastMeta.num, lastMeta.year, 1);
          weekMeta.push(nextMeta);
          weeks.push(emptyWeek());
        }
        weeks[weekIdx + 1][0].push(makeClampedCopy());
      }
    } else if (action.dataset.dupAction === 'weekdays') {
      for (let d = 0; d < 5; d++) {
        if (d === di) continue;
        weeks[weekIdx][d].push(makeClampedCopy());
      }
    }
    closeDupMenu();
    scheduleSave();
    renderAll();
  });
  document.body.appendChild(dupMenuEl);
}

function openDupMenu(btn, weekIdx, di, si) {
  ensureDupMenu();
  dupMenuContext = { weekIdx, di, si };
  dupMenuEl.hidden = false;
  const r = btn.getBoundingClientRect();
  dupMenuEl.style.position = 'fixed';
  dupMenuEl.style.top = (r.bottom + 4) + 'px';
  dupMenuEl.style.left = r.left + 'px';
  dupMenuEl.style.right = 'auto';
}

function closeDupMenu() {
  if (dupMenuEl) dupMenuEl.hidden = true;
  dupMenuContext = null;
}

function availabilityStripesHtml(s, portionStart, portionEnd) {
  if (!lastebil || !s.availability || !s.availability.length) return '';
  const span = portionEnd - portionStart;
  if (span <= 0) return '';
  return s.availability.map(p => {
    const lo = Math.max(p.start, portionStart);
    const hi = Math.min(p.end, portionEnd);
    if (hi <= lo) return '';
    const left = ((lo - portionStart) / span) * 100;
    const width = ((hi - lo) / span) * 100;
    return `<span class="shift-availability" style="left:${left}%; width:${width}%" aria-hidden="true"></span>`;
  }).join('');
}
function reducedRestBadgeHtml(key) {
  if (!lastebil) return '';
  const info = fatsResult.reducedRest && fatsResult.reducedRest[key];
  if (!info) return '';
  const cls = info.broken ? 'shift-rest-badge broken' : 'shift-rest-badge';
  const hours = (info.gapMin / 60).toFixed(1).replace('.', ',');
  const title = info.broken
    ? `Dette er den ${info.n}. reduserte døgnhvilen siden forrige ukehvile — maks 3 tillatt. FATS-brudd.`
    : `Redusert døgnhvil ${info.n}/3 siden forrige ukehvile (${hours} timer fra forrige vakt)`;
  return `<span class="${cls}" title="${title}">9t</span>`;
}
function addAvailButtonHtml() {
  if (!lastebil) return '';
  return `<button type="button" class="shift-add-avail" data-add-avail aria-label="Legg til tilgjengelighetstid" title="Legg til tilgjengelighetstid">⊕</button>`;
}

function renderTimeline() {
  const root = document.getElementById('timeline');
  root.innerHTML = '';

  // header with hour labels 00–23
  const header = document.createElement('div');
  header.className = 'timeline-header';
  const spacer = document.createElement('div');
  spacer.className = 'day-label-spacer';
  header.appendChild(spacer);
  const hoursWrap = document.createElement('div');
  hoursWrap.className = 'hours';
  for (let h = 0; h < 24; h++) {
    const tick = document.createElement('span');
    tick.className = 'hour-tick';
    tick.style.left = ((h / 24) * 100) + '%';
    tick.textContent = String(h).padStart(2, '0');
    hoursWrap.appendChild(tick);
  }
  header.appendChild(hoursWrap);
  root.appendChild(header);

  const week = weeks[activeWeek] || emptyWeek();
  const pendingCont = []; // continuation blocks to append after all rows exist

  // Cross-week continuations from previous week's Sunday
  const prevWeekCrossConts = [];
  if (activeWeek > 0 && weeks[activeWeek - 1]) {
    (weeks[activeWeek - 1][6] || []).forEach((s, si) => {
      if (s.end > TIMELINE_END) {
        const cat = categorizeShift(activeWeek - 1, 6, s);
        const isBroken = fatsResult.shiftFlags[`${activeWeek - 1}-6-${si}`] === 'broken';
        prevWeekCrossConts.push({ si, cat, isBroken, s });
      }
    });
  }

  for (let di = 0; di < 7; di++) {
    const row = document.createElement('div');
    row.className = 'timeline-row';
    if (di >= 5) row.classList.add('weekend');
    const dayLabel = document.createElement('div');
    dayLabel.className = 'day-label';
    dayLabel.textContent = DAY_SHORT[di];
    const track = document.createElement('div');
    track.className = 'day-track';
    track.dataset.day = di;

    // hour gridlines
    for (let h = 1; h < 24; h++) {
      const gl = document.createElement('div');
      gl.className = 'hour-gridline';
      gl.style.left = ((h / 24) * 100) + '%';
      track.appendChild(gl);
    }

    // shifts
    week[di].forEach((s, si) => {
      const cat = categorizeShift(activeWeek, di, s);
      const isBroken = fatsResult.shiftFlags[`${activeWeek}-${di}-${si}`] === 'broken';
      const isSplit = s.end > TIMELINE_END;

      const shiftKey = `${activeWeek}-${di}-${si}`;
      const isDragSource = drag.mode === 'move' && drag.weekIdx === activeWeek && drag.dayIdx === di && drag.shiftIdx === si && drag.targetDi !== di;
      const restBadge = reducedRestBadgeHtml(shiftKey);
      const plusBtn = addAvailButtonHtml();
      const dupBtn = addDuplicateButtonHtml();

      if (isSplit) {
        // Start block: start → midnight
        const startBlock = document.createElement('div');
        startBlock.className = `shift shift-${cat} shift-split-start${isBroken ? ' broken' : ''}${isDragSource ? ' drag-source' : ''}`;
        startBlock.style.left = ((s.start / TIMELINE_END) * 100) + '%';
        startBlock.style.width = (((TIMELINE_END - s.start) / TIMELINE_END) * 100) + '%';
        startBlock.dataset.day = di;
        startBlock.dataset.idx = si;
        startBlock.dataset.role = 'split-start';
        startBlock.innerHTML = `
          ${availabilityStripesHtml(s, s.start, TIMELINE_END)}
          ${restBadge}
          <span class="shift-label"><i class="label-dot"></i>${cat.toUpperCase()}</span>
          <span class="shift-time">${minutesToHHMM(s.start)} –</span>
          ${isBroken ? '<span class="shift-warn">⚠</span>' : ''}
          ${plusBtn}
          <span class="shift-handle left" data-handle="start">⋮</span>
          <span class="shift-chain" title="Fortsetter neste dag">↪</span>`;
        track.appendChild(startBlock);

        if (di + 1 < 7) {
          pendingCont.push({ targetDi: di + 1, originDi: di, si, cat, isBroken, s });
        }
      } else {
        // Normal single block
        const block = document.createElement('div');
        block.className = `shift shift-${cat}${isBroken ? ' broken' : ''}${isDragSource ? ' drag-source' : ''}`;
        block.style.left = ((s.start / TIMELINE_END) * 100) + '%';
        block.style.width = (((s.end - s.start) / TIMELINE_END) * 100) + '%';
        block.dataset.day = di;
        block.dataset.idx = si;
        block.innerHTML = `
          ${availabilityStripesHtml(s, s.start, s.end)}
          ${restBadge}
          <span class="shift-label"><i class="label-dot"></i>${cat.toUpperCase()}</span>
          <span class="shift-time">${minutesToHHMM(s.start)} – ${minutesToHHMM(s.end)}</span>
          ${isBroken ? '<span class="shift-warn">⚠</span>' : ''}
          ${dupBtn}
          ${plusBtn}
          <span class="shift-handle left" data-handle="start">⋮</span>
          <span class="shift-handle right" data-handle="end">⋮</span>`;
        track.appendChild(block);
      }
    });

    // Add cross-week continuation blocks on Monday (di===0)
    if (di === 0) {
      prevWeekCrossConts.forEach(({ si, cat, isBroken, s }) => {
        const contEnd = s.end - TIMELINE_END;
        const block = document.createElement('div');
        block.className = `shift shift-${cat} shift-split-cont${isBroken ? ' broken' : ''}`;
        block.style.left = '0%';
        block.style.width = ((contEnd / TIMELINE_END) * 100) + '%';
        block.dataset.day = 0;
        block.dataset.originDay = 6;
        block.dataset.originWeek = activeWeek - 1;
        block.dataset.idx = si;
        block.dataset.role = 'cross-week-cont';
        block.innerHTML = `
          <span class="shift-label"><i class="label-dot"></i>${cat.toUpperCase()}</span>
          <span class="shift-time">– ${minutesToHHMM(s.end)}</span>
          ${isBroken ? '<span class="shift-warn">⚠</span>' : ''}
          <span class="shift-chain" title="Fortsettelse fra Uke ${weekMeta[activeWeek - 1] ? weekMeta[activeWeek - 1].num : '?'}">↩</span>
          <span class="shift-handle right" data-handle="end">⋮</span>`;
        track.appendChild(block);
      });
    }
    row.appendChild(dayLabel);
    row.appendChild(track);
    root.appendChild(row);
  }

  // Append continuation blocks now that all rows exist
  pendingCont.forEach(({ targetDi, originDi, si, cat, isBroken, s }) => {
    const targetTrack = root.querySelector(`.day-track[data-day="${targetDi}"]`);
    if (!targetTrack) return;
    const contEnd = s.end - TIMELINE_END;
    const block = document.createElement('div');
    block.className = `shift shift-${cat} shift-split-cont${isBroken ? ' broken' : ''}`;
    block.style.left = '0%';
    block.style.width = ((contEnd / TIMELINE_END) * 100) + '%';
    block.dataset.day = targetDi;
    block.dataset.originDay = originDi;
    block.dataset.idx = si;
    block.dataset.role = 'continuation';
    block.innerHTML = `
      <span class="shift-label"><i class="label-dot"></i>${cat.toUpperCase()}</span>
      <span class="shift-time">– ${minutesToHHMM(s.end)}</span>
      ${isBroken ? '<span class="shift-warn">⚠</span>' : ''}
      <span class="shift-chain" title="Fortsettelse fra forrige dag">↩</span>
      <span class="shift-handle right" data-handle="end">⋮</span>`;
    targetTrack.appendChild(block);
  });

  // Cross-day drag ghost: show preview in target row
  if (drag.mode === 'move' && drag.targetDi !== undefined && drag.targetDi !== drag.dayIdx) {
    const dragShift = weeks[drag.weekIdx] && weeks[drag.weekIdx][drag.dayIdx] && weeks[drag.weekIdx][drag.dayIdx][drag.shiftIdx];
    if (dragShift) {
      const targetTrack = root.querySelector(`.day-track[data-day="${drag.targetDi}"]`);
      if (targetTrack) {
        const ghost = document.createElement('div');
        ghost.className = 'shift shift-ghost';
        ghost.style.left = ((dragShift.start / TIMELINE_END) * 100) + '%';
        ghost.style.width = (((dragShift.end - dragShift.start) / TIMELINE_END) * 100) + '%';
        ghost.innerHTML = `<span class="shift-time">${minutesToHHMM(dragShift.start)} – ${minutesToHHMM(dragShift.end)}</span>`;
        targetTrack.appendChild(ghost);
      }
    }
  }
}

function renderDetailList() {
  const root = document.getElementById('detail-list');
  const week = weeks[activeWeek] || emptyWeek();
  const rows = [];
  let totalNet = 0;
  let totalAvail = 0;
  let totalPaid = 0;

  // Cross-week continuation from previous week's Sunday
  if (activeWeek > 0 && weeks[activeWeek - 1]) {
    (weeks[activeWeek - 1][6] || []).forEach((s, si) => {
      if (s.end > TIMELINE_END) {
        const split = splitShiftAcrossWeeks(s, 6);
        totalNet += split.nextWeekNet;
        totalAvail += split.nextWeekAvail;
        totalPaid += split.nextWeekPaid;
        const broken = fatsResult.shiftFlags[`${activeWeek - 1}-6-${si}`] === 'broken';
        const prevUkeNum = weekMeta[activeWeek - 1] ? weekMeta[activeWeek - 1].num : '?';
        rows.push({
          dayLabel: `${DAY_NAMES[6]}–${DAY_NAMES[0]}`,
          startLabel: minutesToHHMM(s.start),
          endLabel: minutesToHHMM(s.end),
          lunch: split.nextWeekLunch,
          net: split.nextWeekNet,
          avail: split.nextWeekAvail,
          paid: split.nextWeekPaid,
          broken,
          note: `Fra uke ${prevUkeNum}`,
          delKey: null,
          crossWeekSi: si,
          crossWeekOrigin: activeWeek - 1,
        });
      }
    });
  }

  for (let di = 0; di < 7; di++) {
    week[di].forEach((s, si) => {
      const split = splitShiftAcrossWeeks(s, di);
      totalNet += split.currentWeekNet;
      totalAvail += split.currentWeekAvail;
      totalPaid += split.currentWeekPaid;
      const broken = fatsResult.shiftFlags[`${activeWeek}-${di}-${si}`] === 'broken';
      const isSundayCW = isSundayCrossWeek(s, di);
      let dayLabel;
      if (isSundayCW) {
        dayLabel = `${DAY_NAMES[6]}–${DAY_NAMES[0]}`;
      } else if (s.end > TIMELINE_END && di + 1 < 7) {
        dayLabel = `${DAY_NAMES[di]}–${DAY_NAMES[di + 1]}`;
      } else {
        dayLabel = DAY_NAMES[di];
      }
      const nextUkeNum = weekMeta[activeWeek + 1] ? weekMeta[activeWeek + 1].num : null;
      rows.push({
        dayLabel,
        startLabel: minutesToHHMM(s.start),
        endLabel: minutesToHHMM(s.end),
        lunch: split.currentWeekLunch,
        net: split.currentWeekNet,
        avail: split.currentWeekAvail,
        paid: split.currentWeekPaid,
        broken,
        note: isSundayCW && nextUkeNum ? `Fortsetter i uke ${nextUkeNum}` : null,
        delKey: `${di}-${si}`,
        crossWeekSi: null,
        crossWeekOrigin: null,
      });
    });
  }

  if (!rows.length) {
    root.innerHTML = `<div class="detail-empty">Ingen vakter denne uken. Klikk og dra på tidslinjen for å lage en.</div>`;
    return;
  }
  const showFats = !!lastebil;
  const fmtHrMin = mins => {
    if (!mins) return '0 t';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} t` : `${h} t ${m} min`;
  };
  let html;
  if (showFats) {
    html = `<table>
      <thead>
        <tr><th>Dag</th><th>Start</th><th>Slutt</th><th>Lunsj</th><th>Tilgjengelighet</th><th>Arbeidstid</th><th>Lønnstid</th><th></th></tr>
      </thead>
      <tbody>`;
    rows.forEach(r => {
      const noteHtml = r.note ? `<span class="shift-note" title="${r.note}">↕</span>` : '';
      const delHtml = r.delKey
        ? `<button class="delete-btn" data-del="${r.delKey}" aria-label="Slett vakt">×</button>`
        : `<button class="delete-btn" data-del-cross="${r.crossWeekOrigin}-6-${r.crossWeekSi}" aria-label="Slett vakt">×</button>`;
      html += `<tr class="${r.broken ? 'row-broken' : ''}">
        <td>${r.dayLabel}${noteHtml}</td>
        <td class="mono">${r.startLabel}</td>
        <td class="mono">${r.endLabel}</td>
        <td class="mono">${r.lunch} min</td>
        <td class="mono">${r.avail ? fmtHrMin(r.avail) : ''}</td>
        <td class="mono">${(r.paid / 60).toFixed(2)} t</td>
        <td class="mono">${(r.paid / 60).toFixed(2)} t</td>
        <td>${delHtml}</td>
      </tr>`;
    });
    html += `</tbody>
      <tfoot>
        <tr><td colspan="4" style="text-align:right; font-weight:600;">Sum uke:</td>
        <td class="mono" style="font-weight:600;">${totalAvail ? fmtHrMin(totalAvail) : ''}</td>
        <td class="mono" style="font-weight:600;">${(totalPaid / 60).toFixed(2)} t</td>
        <td class="mono" style="font-weight:600;">${(totalPaid / 60).toFixed(2)} t</td>
        <td></td></tr>
      </tfoot>
    </table>`;
  } else {
    html = `<table>
      <thead>
        <tr><th>Dag</th><th>Start</th><th>Slutt</th><th>Lunsj</th><th>Nettotid</th><th></th></tr>
      </thead>
      <tbody>`;
    rows.forEach(r => {
      const noteHtml = r.note ? `<span class="shift-note" title="${r.note}">↕</span>` : '';
      const delHtml = r.delKey
        ? `<button class="delete-btn" data-del="${r.delKey}" aria-label="Slett vakt">×</button>`
        : `<button class="delete-btn" data-del-cross="${r.crossWeekOrigin}-6-${r.crossWeekSi}" aria-label="Slett vakt">×</button>`;
      html += `<tr class="${r.broken ? 'row-broken' : ''}">
        <td>${r.dayLabel}${noteHtml}</td>
        <td class="mono">${r.startLabel}</td>
        <td class="mono">${r.endLabel}</td>
        <td class="mono">${r.lunch} min</td>
        <td class="mono">${(r.net / 60).toFixed(2)} t</td>
        <td>${delHtml}</td>
      </tr>`;
    });
    html += `</tbody>
      <tfoot>
        <tr><td colspan="4" style="text-align:right; font-weight:600;">Sum uke:</td><td class="mono" style="font-weight:600;">${(totalNet / 60).toFixed(2)} t</td><td></td></tr>
      </tfoot>
    </table>`;
  }
  root.innerHTML = html;
  root.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [di, si] = btn.dataset.del.split('-').map(Number);
      weeks[activeWeek][di].splice(si, 1);
      scheduleSave();
      renderAll();
    });
  });
  root.querySelectorAll('[data-del-cross]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [wi, di, si] = btn.dataset.delCross.split('-').map(Number);
      if (weeks[wi] && weeks[wi][di]) weeks[wi][di].splice(si, 1);
      scheduleSave();
      renderAll();
    });
  });
}

function renderSummary() {
  const totalMin = weeks.reduce((sum, w) => sum + w.reduce((s, day) => s + day.reduce((a, sh) => a + shiftPaid(sh), 0), 0), 0);
  const numWeeks = weeks.length || 1;
  const avgPerWeekMin = totalMin / numWeeks;
  const pct = (avgPerWeekMin / 60) / 37.5 * 100;
  document.getElementById('stat-uker').textContent = weeks.length;
  document.getElementById('stat-sum').textContent = (totalMin / 60).toFixed(1).replace('.', ',');
  document.getElementById('stat-snitt').textContent = (avgPerWeekMin / 60).toFixed(1).replace('.', ',');
  const pctEl = document.getElementById('gauge-pct');
  pctEl.textContent = pct.toFixed(1).replace('.', ',') + '%';
  pctEl.classList.toggle('over', pct > 100);

  // Title
  const dept = formData.avdeling || 'Avdeling';
  const title = isRotasjon()
    ? `${dept} · Rotasjon på ${weeks.length} uke${weeks.length === 1 ? '' : 'r'}`
    : `${dept} · Turnus`;
  document.getElementById('sum-title').textContent = title;

  // Gauge arc + needle
  const clamped = Math.min(pct, 130) / 130; // 0..1
  // The full arc path length ~ pi * 80 ≈ 251.3
  const arcLen = Math.PI * 80;
  const dash = clamped * arcLen;
  const arc = document.getElementById('gauge-arc');
  arc.setAttribute('stroke-dasharray', `${dash} ${arcLen}`);
  arc.setAttribute('stroke', pct > 100 ? '#dc2626' : (pct > 80 ? '#d97706' : '#16a34a'));
  const needle = document.getElementById('gauge-needle');
  const angle = clamped * 180 - 180; // -180 deg (left) to 0 deg (right)
  const rad = angle * Math.PI / 180;
  const cx = 100, cy = 100, r = 72;
  const x = cx + Math.cos(rad) * r;
  const y = cy + Math.sin(rad) * r;
  needle.setAttribute('x2', x);
  needle.setAttribute('y2', y);
  needle.setAttribute('stroke', pct > 100 ? '#dc2626' : '#0f172a');
}

function renderFatsPanel() {
  const panel = document.getElementById('fats-panel');
  const list = document.getElementById('fats-list');
  const counter = document.getElementById('fats-count');
  const summary = fatsResult.reducedRestSummary || { total: 0, currentCount: 0, breached: 0 };
  const showSummary = lastebil && summary.total > 0;
  if (fatsResult.broken.length === 0 && fatsResult.warnings.length === 0 && !showSummary) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  counter.textContent = `${fatsResult.broken.length} brudd · ${fatsResult.warnings.length} advarsler`;
  list.innerHTML = '';

  if (showSummary) {
    const isBreach = summary.currentCount > 3;
    const div = document.createElement('div');
    div.className = 'fats-item ' + (isBreach ? 'broken' : 'warn');
    const usedLabel = Math.min(summary.currentCount, 3);
    const status = isBreach
      ? `<strong>FATS-brudd: ${summary.currentCount} reduserte døgnhviler siden forrige ukehvile (maks 3 tillatt)</strong><span>Totalt ${summary.total} reduserte døgnhviler i turnusen</span>`
      : `<strong>Redusert døgnhvil brukt: ${usedLabel}/3</strong><span>Totalt ${summary.total} reduserte døgnhviler i turnusen siden forrige ukehvile</span>`;
    div.innerHTML = `<span class="icon">⓵</span><div class="body">${status}</div>`;
    list.appendChild(div);
  }

  const ruleTitle = {
    'overlap': 'Overlappende vakter',
    'shift-10h': 'Vakt over 10 timer',
    'week-60h': 'Over 60 timer i uka',
    'rest-9h': 'Hviletid under 9 timer',
    'rest-11h': 'Hviletid under 11 timer',
    'rest-reduced': 'Redusert døgnhvil',
    'rest-24h': 'Mangler 24 t sammenhengende hvile',
  };
  const renderItem = (item, type) => {
    const div = document.createElement('div');
    div.className = 'fats-item ' + (type === 'broken' ? 'broken' : 'warn');
    div.innerHTML = `<span class="icon">⚠</span><div class="body"><strong>Uke ${weekMeta[item.week].num} · ${ruleTitle[item.rule] || item.rule}</strong><span>${item.text}</span></div>`;
    div.addEventListener('click', () => { activeWeek = item.week; renderAll(); });
    list.appendChild(div);
  };
  fatsResult.broken.forEach(b => renderItem(b, 'broken'));
  fatsResult.warnings.forEach(w => renderItem(w, 'warn'));
}

function updateCompleteBadges() {
  const infoComplete = !!(formData.avdeling && formData.avdelingsleder && formData.typeTurnus && formData.ikrafttredelsesdato);
  document.getElementById('info-num').classList.toggle('complete', infoComplete);
  document.getElementById('info-complete').hidden = !infoComplete;

  const hasShifts = weeks.some(w => w.some(d => d.length));
  document.getElementById('shifts-num').classList.toggle('complete', hasShifts);
  document.getElementById('shifts-complete').hidden = !hasShifts;
}

function updatePdfState() {
  const ok = !!(formData.avdeling && formData.avdelingsleder && formData.typeTurnus && formData.ikrafttredelsesdato)
          && weeks.some(w => w.some(d => d.length));
  const pdf = document.getElementById('btn-pdf');
  const email = document.getElementById('btn-email');
  pdf.disabled = !ok;
  email.disabled = !ok;
  pdf.title = ok ? 'Generer drøftingsnotat som PDF' : 'Fyll ut obligatoriske felt og legg til minst én vakt';
  email.title = pdf.title;
}

// ====== Form input wiring ======
function wireForm() {
  const bind = (id, key, transform = v => v) => {
    const el = document.getElementById(id);
    const ev = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      formData[key] = el.type === 'checkbox' ? el.checked : transform(el.value);
      if (key === 'lastebil') { lastebil = el.checked; }
      if (key === 'typeTurnus') {
        const personlig = el.value === 'Personlig';
        document.getElementById('wrap-navn').hidden = !personlig;
        document.getElementById('wrap-antall').hidden = personlig;
      }
      if (key === 'ikrafttredelsesdato') {
        if (!isRotasjon() && formData.ikrafttredelsesdato) {
          const date = parseIsoDate(formData.ikrafttredelsesdato);
          if (date) recomputeCalendarWeeksFromFirst(dateToIsoWeek(date));
        }
        scheduleSave();
        renderAll();
        return;
      }
      if (key === 'rullerende') {
        if (el.checked) {
          for (let j = 0; j < weekMeta.length; j++) {
            weekMeta[j] = { num: j + 1, year: null };
          }
        } else {
          recomputeCalendarWeeksFromFirst(defaultFirstCalendarWeek());
        }
        scheduleSave();
        renderAll();
        return;
      }
      scheduleSave();
      if (['lastebil'].includes(key)) renderAll();
      else { renderSummary(); updateCompleteBadges(); updatePdfState(); }
    });
  };
  bind('f-avdeling', 'avdeling');
  bind('f-avdelingsleder', 'avdelingsleder');
  bind('f-type', 'typeTurnus');
  bind('f-ikraft', 'ikrafttredelsesdato');
  bind('f-navn', 'navn');
  bind('f-antall', 'antallSjaforer', v => parseInt(v) || 1);
  bind('f-epost-tv', 'epostTillitsvalgt');
  bind('f-epost-leder', 'epostLeder');
  bind('f-rullerende', 'rullerende');
  bind('f-lastebil', 'lastebil');
  bind('f-aarsak', 'aarsak');
  bind('f-fagforbund', 'fagforbundetSyn');
  bind('f-kommentar', 'annenKommentar');
}

// ====== Drag interactions (desktop) ======
function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

function pxToMinutes(track, px) {
  const rect = track.getBoundingClientRect();
  return clamp((px / rect.width) * TIMELINE_END, 0, TIMELINE_END);
}

function wireTimeline() {
  const root = document.getElementById('timeline');
  root.addEventListener('mousedown', e => {
    if (isMobile()) return;
    if (e.target.closest('[data-add-avail]')) return;
    if (e.target.closest('[data-duplicate]')) return;
    const handle = e.target.closest('.shift-handle');
    const shiftEl = e.target.closest('.shift');
    const track = e.target.closest('.day-track');
    if (!track) return;
    const trackDi = parseInt(track.dataset.day);
    const rect = track.getBoundingClientRect();

    if (shiftEl) {
      const role = shiftEl.dataset.role;
      const isContinuation = role === 'continuation';
      const isSplitStart = role === 'split-start';
      const isCrossWeekCont = role === 'cross-week-cont';

      let di, weekIdx;
      if (isContinuation) {
        di = parseInt(shiftEl.dataset.originDay);
        weekIdx = activeWeek;
      } else if (isCrossWeekCont) {
        di = 6;
        weekIdx = parseInt(shiftEl.dataset.originWeek);
      } else {
        di = trackDi;
        weekIdx = activeWeek;
      }

      const si = parseInt(shiftEl.dataset.idx);
      const shift = weeks[weekIdx] && weeks[weekIdx][di] && weeks[weekIdx][di][si];
      if (!shift) return;

      if (handle) {
        const which = handle.dataset.handle;
        if ((isContinuation || isCrossWeekCont) && which === 'start') { e.preventDefault(); return; }
        if (isSplitStart && which === 'end') { e.preventDefault(); return; }
        const mode = which === 'start' ? 'resize-start' : 'resize-end';
        drag = { mode, weekIdx, dayIdx: di, shiftIdx: si,
          startX: e.clientX, originalShift: { ...shift }, trackRect: rect };
      } else {
        // Only allow cross-day drag for normal (non-split, non-continuation) shifts
        const canCrossDay = !isSplitStart && !isContinuation && !isCrossWeekCont;
        drag = { mode: 'move', weekIdx, dayIdx: di, shiftIdx: si,
          startX: e.clientX, originalShift: { ...shift }, trackRect: rect,
          targetDi: canCrossDay ? di : undefined };
      }
      shiftEl.classList.add('dragging');
      e.preventDefault();
    } else {
      const startMin = snap(clamp(pxToMinutes(track, e.clientX - rect.left), 0, TIMELINE_END - MIN_SHIFT));
      const newShift = { start: startMin, end: startMin + MIN_SHIFT, availability: [] };
      weeks[activeWeek][trackDi].push(newShift);
      const si = weeks[activeWeek][trackDi].length - 1;
      drag = { mode: 'resize-end', weekIdx: activeWeek, dayIdx: trackDi, shiftIdx: si,
        startX: e.clientX, originalShift: { ...newShift }, trackRect: rect, createdNew: true };
      renderTimeline();
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', e => {
    if (!drag.mode) return;
    const { trackRect, originalShift, dayIdx, shiftIdx, mode, startX } = drag;
    const deltaPx = e.clientX - startX;
    const deltaMin = snap((deltaPx / trackRect.width) * TIMELINE_END);
    const shift = weeks[drag.weekIdx][dayIdx][shiftIdx];
    if (mode === 'move') {
      const length = originalShift.end - originalShift.start;
      const newStart = clamp(snap(originalShift.start + deltaMin), 0, TIMELINE_END - MIN_SHIFT);
      shift.start = newStart;
      shift.end = newStart + length;

      // Cross-day tracking: find which row the mouse is over
      if (drag.targetDi !== undefined) {
        const allTracks = document.querySelectorAll('.day-track');
        for (const t of allTracks) {
          const r = t.getBoundingClientRect();
          if (e.clientY >= r.top && e.clientY <= r.bottom) {
            drag.targetDi = parseInt(t.dataset.day);
            break;
          }
        }
      }
    } else if (mode === 'resize-start') {
      shift.start = clamp(snap(originalShift.start + deltaMin), 0, shift.end - MIN_SHIFT);
    } else if (mode === 'resize-end') {
      if (drag.createdNew) {
        const track = document.querySelector(`.day-track[data-day="${dayIdx}"]`);
        const px = e.clientX - trackRect.left;
        let newEnd;
        if (px <= trackRect.width) {
          newEnd = clamp(snap(pxToMinutes(track, px)), shift.start + MIN_SHIFT, TIMELINE_END);
        } else {
          newEnd = TIMELINE_END + snap(((px - trackRect.width) / trackRect.width) * TIMELINE_END);
          newEnd = clamp(newEnd, shift.start + MIN_SHIFT, 2 * TIMELINE_END);
        }
        shift.end = newEnd;
      } else {
        shift.end = clamp(snap(originalShift.end + deltaMin), shift.start + MIN_SHIFT, 2 * TIMELINE_END);
      }
    }
    renderTimeline();
  });

  document.addEventListener('mouseup', () => {
    if (!drag.mode) return;
    const shift = weeks[drag.weekIdx] && weeks[drag.weekIdx][drag.dayIdx] && weeks[drag.weekIdx][drag.dayIdx][drag.shiftIdx];
    if (shift) {
      shift.start = snap(shift.start);
      shift.end = snap(shift.end);
      if (shift.end - shift.start < MIN_SHIFT) {
        weeks[drag.weekIdx][drag.dayIdx].splice(drag.shiftIdx, 1);
      } else if (drag.targetDi !== undefined && drag.targetDi !== drag.dayIdx) {
        // Cross-day move: remove from source, add to target
        weeks[drag.weekIdx][drag.dayIdx].splice(drag.shiftIdx, 1);
        const moved = { ...shift, availability: JSON.parse(JSON.stringify(shift.availability || [])) };
        // Clamp end to same-day if it would cross midnight on the target
        if (moved.end > TIMELINE_END && drag.targetDi < 6) moved.end = TIMELINE_END;
        weeks[drag.weekIdx][drag.targetDi].push(moved);
      } else {
        cleanupShiftAvailability(shift);
      }
    }
    maybeCreateNextWeekForCrossWeekShifts();
    drag = { mode: null };
    scheduleSave();
    renderAll();
  });

  // Duplicate button click
  root.addEventListener('click', e => {
    // Toggle floating duplicate menu
    const dupBtn = e.target.closest('[data-duplicate]');
    if (dupBtn) {
      e.stopPropagation(); e.preventDefault();
      const shiftEl = dupBtn.closest('.shift');
      if (!shiftEl) return;
      const di = parseInt(shiftEl.dataset.day);
      const si = parseInt(shiftEl.dataset.idx);
      if (dupMenuEl && !dupMenuEl.hidden && dupMenuContext && dupMenuContext.di === di && dupMenuContext.si === si) {
        closeDupMenu();
      } else {
        openDupMenu(dupBtn, activeWeek, di, si);
      }
      return;
    }

    // Close dup menu when clicking elsewhere in the timeline
    closeDupMenu();
  });

  // Plus-button click (availability): handle both desktop and mobile
  root.addEventListener('click', e => {
    const addBtn = e.target.closest('[data-add-avail]');
    if (addBtn) {
      const shiftEl = addBtn.closest('.shift');
      if (!shiftEl) return;
      const role = shiftEl.dataset.role;
      let di, weekIdx;
      if (role === 'continuation') {
        di = parseInt(shiftEl.dataset.originDay);
        weekIdx = activeWeek;
      } else if (role === 'cross-week-cont') {
        di = 6;
        weekIdx = parseInt(shiftEl.dataset.originWeek);
      } else {
        di = parseInt(shiftEl.dataset.day);
        weekIdx = activeWeek;
      }
      const si = parseInt(shiftEl.dataset.idx);
      e.stopPropagation();
      e.preventDefault();
      openAvailabilityModal(weekIdx, di, si);
      return;
    }
    if (!isMobile()) return;
    const track = e.target.closest('.day-track');
    if (!track) return;
    const di = parseInt(track.dataset.day);
    openShiftModal(di);
  });
}

// ====== Modal for mobile shift edit ======
function openShiftModal(di) {
  const backdrop = document.getElementById('modal-backdrop');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const foot = document.getElementById('modal-foot');
  title.textContent = `Vakter – ${DAY_NAMES[di]}`;
  const shifts = weeks[activeWeek][di] || [];

  let editIdx = null; // null=adding new, number=editing

  function render() {
    body.innerHTML = '';
    if (editIdx === null) {
      // list view
      const list = document.createElement('div');
      list.className = 'modal-shift-list';
      if (!shifts.length) {
        const empty = document.createElement('p');
        empty.style.color = 'var(--color-text-muted)';
        empty.style.fontSize = '13px';
        empty.textContent = 'Ingen vakter denne dagen ennå.';
        list.appendChild(empty);
      }
      shifts.forEach((s, si) => {
        const row = document.createElement('div');
        row.className = 'modal-shift-row';
        row.innerHTML = `<span class="grow">${minutesToHHMM(s.start)} – ${minutesToHHMM(s.end)}</span>`;
        const edit = document.createElement('button');
        edit.className = 'btn btn-outline btn-sm';
        edit.textContent = 'Rediger';
        edit.addEventListener('click', () => { editIdx = si; render(); });
        const del = document.createElement('button');
        del.className = 'btn btn-outline btn-sm';
        del.textContent = 'Slett';
        del.addEventListener('click', () => {
          shifts.splice(si, 1);
          scheduleSave();
          render();
        });
        row.appendChild(edit);
        row.appendChild(del);
        list.appendChild(row);
      });
      body.appendChild(list);

      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary btn-block';
      addBtn.textContent = '+ Legg til ny vakt';
      addBtn.addEventListener('click', () => {
        shifts.push({ start: 7 * 60, end: 15 * 60, availability: [] });
        editIdx = shifts.length - 1;
        render();
      });
      body.appendChild(addBtn);

      foot.innerHTML = '';
      const close = document.createElement('button');
      close.className = 'btn btn-outline';
      close.textContent = 'Lukk';
      close.addEventListener('click', closeModal);
      foot.appendChild(close);
    } else {
      // editor
      const s = shifts[editIdx];
      const wrap = document.createElement('div');
      wrap.className = 'modal-time-row';
      wrap.appendChild(makeTimeSelect('Starttid', s.start, val => { s.start = val; if (s.end <= s.start) s.end = s.start + MIN_SHIFT; }));
      wrap.appendChild(makeTimeSelect('Sluttid', s.end, val => { s.end = val; if (s.end <= s.start) s.end = s.start + MIN_SHIFT; }, true));
      body.appendChild(wrap);

      foot.innerHTML = '';
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-outline';
      cancel.textContent = 'Tilbake';
      cancel.addEventListener('click', () => { editIdx = null; render(); });
      const save = document.createElement('button');
      save.className = 'btn btn-primary';
      save.textContent = 'Lagre';
      save.addEventListener('click', () => {
        cleanupShiftAvailability(shifts[editIdx]);
        scheduleSave();
        editIdx = null;
        renderAll();
        render();
      });
      foot.appendChild(cancel);
      foot.appendChild(save);
    }
  }

  function makeTimeSelect(label, value, onChange, allowNextDay = false) {
    const wrap = document.createElement('label');
    const t = document.createElement('span');
    t.textContent = label;
    const sel = document.createElement('select');
    const max = allowNextDay ? 2 * TIMELINE_END : TIMELINE_END;
    for (let m = 0; m <= max; m += SNAP) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = minutesToHHMM(m);
      if (m === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(parseInt(sel.value)));
    wrap.appendChild(t);
    wrap.appendChild(sel);
    return wrap;
  }

  function closeModal() { backdrop.hidden = true; renderAll(); }
  document.getElementById('modal-close').onclick = closeModal;
  backdrop.hidden = false;
  render();
}

// ====== Modal for availability time ======
function openAvailabilityModal(weekIdx, dayIdx, shiftIdx) {
  const backdrop = document.getElementById('modal-backdrop');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const foot = document.getElementById('modal-foot');
  const shift = weeks[weekIdx] && weeks[weekIdx][dayIdx] && weeks[weekIdx][dayIdx][shiftIdx];
  if (!shift) return;
  ensureShiftDefaults(shift);
  const shiftMaxEnd = shift.end > TIMELINE_END ? shift.end : shift.end;
  title.textContent = `Tilgjengelighetstid for ${DAY_NAMES[dayIdx]} ${minutesToHHMM(shift.start)}–${minutesToHHMM(shift.end)}`;

  let draftStart = shift.start;
  let draftEnd = shift.start + 60;
  if (draftEnd > shiftMaxEnd) draftEnd = shiftMaxEnd;
  let errorMsg = '';

  function fmtHrMin(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} t` : `${h} t ${m} min`;
  }
  function overlapsExisting(start, end, skipIdx) {
    return (shift.availability || []).some((p, i) => {
      if (i === skipIdx) return false;
      return start < p.end && end > p.start;
    });
  }
  function validate(start, end) {
    if (end <= start) return 'Sluttid må være etter starttid';
    if (start < shift.start || end > shiftMaxEnd) return 'Perioden må ligge innenfor vakten';
    if (overlapsExisting(start, end)) return 'Perioden overlapper med en annen tilgjengelighetsperiode';
    return '';
  }

  function render() {
    body.innerHTML = '';

    // Description
    const desc = document.createElement('p');
    desc.style.color = 'var(--color-text-muted)';
    desc.style.fontSize = '13px';
    desc.style.margin = '0 0 12px';
    desc.textContent = 'Tilgjengelighetstid er ventetid som ikke regnes som arbeids- eller lønnstid (ferge, lossing, grensekontroll).';
    body.appendChild(desc);

    // Existing periods
    const list = document.createElement('div');
    list.className = 'modal-shift-list';
    if (!shift.availability.length) {
      const empty = document.createElement('p');
      empty.style.color = 'var(--color-text-muted)';
      empty.style.fontSize = '13px';
      empty.textContent = 'Ingen tilgjengelighetsperioder ennå.';
      list.appendChild(empty);
    }
    shift.availability.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'modal-shift-row';
      row.innerHTML = `<span class="grow mono">${minutesToHHMM(p.start)} – ${minutesToHHMM(p.end)}</span><span class="mono" style="color:var(--color-text-muted); font-size:12px;">${fmtHrMin(p.end - p.start)}</span>`;
      const del = document.createElement('button');
      del.className = 'btn btn-outline btn-sm';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Slett periode');
      del.addEventListener('click', () => {
        shift.availability.splice(i, 1);
        scheduleSave();
        render();
      });
      row.appendChild(del);
      list.appendChild(row);
    });
    body.appendChild(list);

    // Add new period section
    const addSection = document.createElement('div');
    addSection.className = 'avail-add-section';
    const heading = document.createElement('h4');
    heading.textContent = 'Legg til ny periode';
    heading.style.cssText = 'margin:16px 0 8px; font-size:13px; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.5px;';
    addSection.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'modal-time-row';
    row.appendChild(makeAvailTimeSelect('Starttid', draftStart, v => { draftStart = v; if (draftEnd <= draftStart) draftEnd = Math.min(draftStart + SNAP, shiftMaxEnd); errorMsg = ''; render(); }));
    row.appendChild(makeAvailTimeSelect('Sluttid', draftEnd, v => { draftEnd = v; if (draftEnd <= draftStart) draftStart = Math.max(draftEnd - SNAP, shift.start); errorMsg = ''; render(); }));
    addSection.appendChild(row);

    if (errorMsg) {
      const err = document.createElement('p');
      err.style.cssText = 'color:#dc2626; font-size:13px; margin:8px 0 0;';
      err.textContent = errorMsg;
      addSection.appendChild(err);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-block';
    addBtn.textContent = '+ Legg til periode';
    addBtn.style.marginTop = '12px';
    addBtn.addEventListener('click', () => {
      const err = validate(draftStart, draftEnd);
      if (err) { errorMsg = err; render(); return; }
      shift.availability.push({ start: draftStart, end: draftEnd });
      shift.availability.sort((a, b) => a.start - b.start);
      errorMsg = '';
      draftStart = shift.start;
      draftEnd = Math.min(shift.start + 60, shiftMaxEnd);
      scheduleSave();
      render();
    });
    addSection.appendChild(addBtn);
    body.appendChild(addSection);

    foot.innerHTML = '';
    const close = document.createElement('button');
    close.className = 'btn btn-outline';
    close.textContent = 'Lukk';
    close.addEventListener('click', closeModal);
    foot.appendChild(close);
  }

  function makeAvailTimeSelect(label, value, onChange) {
    const wrap = document.createElement('label');
    const t = document.createElement('span');
    t.textContent = label;
    const sel = document.createElement('select');
    for (let m = shift.start; m <= shiftMaxEnd; m += SNAP) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = minutesToHHMM(m);
      if (m === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(parseInt(sel.value)));
    wrap.appendChild(t);
    wrap.appendChild(sel);
    return wrap;
  }

  function closeModal() { backdrop.hidden = true; renderAll(); }
  document.getElementById('modal-close').onclick = closeModal;
  backdrop.hidden = false;
  render();
}

// ====== Confirm dialog ======
function confirmDialog(title, text, onOk, opts = {}) {
  const bd = document.getElementById('confirm-backdrop');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  bd.hidden = false;
  const okBtn = document.getElementById('confirm-ok');
  okBtn.textContent = opts.okLabel || 'OK';
  okBtn.className = opts.okClass || 'btn btn-primary';
  document.getElementById('confirm-cancel').onclick = () => { bd.hidden = true; };
  okBtn.onclick = () => { bd.hidden = true; onOk && onOk(); };
}

// ====== Toast ======
function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

// ====== PDF export ======
// ====== PDF export ======
// Visuell paritet med appen: blå topptekst, kort-seksjoner, fargede vakttype-merker,
// stripede tabeller og signaturbokser. All beregningslogikk (shiftPaid, FATS-kolonner,
// rotasjon, døgnskille-fotnoter) er bevart – kun det visuelle er fornyet.
const PDF_CAT = {
  dag:   { fill: [253, 230, 138], text: [120, 53, 15],  dot: [217, 160, 30],  label: 'Dag' },
  kveld: { fill: [253, 186, 116], text: [124, 45, 18],  dot: [201, 100, 40],  label: 'Kveld' },
  natt:  { fill: [199, 210, 254], text: [49, 46, 129],  dot: [99, 102, 220],  label: 'Natt' },
  helg:  { fill: [251, 207, 232], text: [131, 24, 67],  dot: [216, 90, 150],  label: 'Helg' },
};

function generatePDF() {
  if (!window.jspdf) { toast('PDF-bibliotek ikke lastet'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16;
  const contentW = pageW - M * 2;
  const FOOT = pageH - 18;
  const fatsPdf = !!lastebil;

  const C = {
    primary: [26, 86, 219], dark: [15, 23, 42], muted: [100, 116, 139],
    line: [226, 232, 240], zebra: [248, 250, 252], panel: [241, 245, 249],
    green: [22, 163, 74], amber: [217, 119, 6], red: [220, 38, 38], body: [51, 65, 85],
  };
  const setText = c => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = c => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw = c => doc.setDrawColor(c[0], c[1], c[2]);
  const ensure = h => { if (y + h > FOOT) { doc.addPage(); y = M; } };
  const fmtHrMinShort = mins => {
    if (!mins) return '–';
    const h = Math.floor(mins / 60), m = mins % 60;
    return m === 0 ? `${h} t` : `${h} t ${m} m`;
  };
  const fmtT = mins => `${(mins / 60).toFixed(2).replace('.', ',')} t`;

  let y = 0;

  // ---------- Topptekst ----------
  setFill(C.dark); doc.rect(0, 0, pageW, 30, 'F');
  setFill(C.primary); doc.rect(0, 30, pageW, 1.4, 'F');
  setFill(C.primary); doc.roundedRect(M, 8, 14, 14, 2.5, 2.5, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('T', M + 7, 17.5, { align: 'center' });
  doc.setFontSize(17);
  doc.text('Drøftingsnotat – turnus', M + 20, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(203, 213, 225);
  doc.text(`${formData.avdeling || 'Avdeling'}  ·  Leder: ${formData.avdelingsleder || '–'}`, M + 20, 23);
  y = 42;

  // ---------- Nøkkelinfo-kort ----------
  const info = [
    ['Type turnus', formData.typeTurnus],
    [formData.typeTurnus === 'Personlig' ? 'Sjåfør / navn' : 'Antall sjåfører',
     formData.typeTurnus === 'Personlig' ? (formData.navn || '–') : String(formData.antallSjaforer)],
    ['Ikrafttredelsesdato', formatDateNO(formData.ikrafttredelsesdato)],
    ['Rullerende turnus', formData.rullerende ? 'Ja' : 'Nei'],
    ['Lastebil / FATS', formData.lastebil ? 'Ja' : 'Nei'],
  ];
  const infoRows = Math.ceil(info.length / 2);
  const infoH = 12 + infoRows * 9;
  setFill(C.panel); setDraw(C.line); doc.setLineWidth(0.2);
  doc.roundedRect(M, y, contentW, infoH, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setText(C.muted);
  doc.text('OPPLYSNINGER', M + 5, y + 7);
  const colW = contentW / 2;
  info.forEach(([k, v], i) => {
    const cx = M + 5 + (i % 2) * colW;
    const cy = y + 14 + Math.floor(i / 2) * 9;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(C.muted);
    doc.text(k.toUpperCase(), cx, cy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); setText(C.dark);
    doc.text(String(v || '–'), cx, cy + 5);
  });
  y += infoH + 8;

  // ---------- Stillingsprosent-kort ----------
  const totalMin = weeks.reduce((sum, w) => sum + w.reduce((s, day) => s + day.reduce((a, sh) => a + shiftPaid(sh), 0), 0), 0);
  const numWeeks = weeks.length || 1;
  const pct = (totalMin / numWeeks / 60 / 37.5) * 100;
  const pctColor = pct > 100 ? C.red : (pct > 80 ? C.amber : C.green);
  const cardH = 30;
  setFill([255, 255, 255]); setDraw(C.line);
  doc.roundedRect(M, y, contentW, cardH, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(C.muted);
  doc.text('STILLINGSPROSENT', M + 6, y + 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); setText(pctColor);
  doc.text(pct.toFixed(1).replace('.', ',') + ' %', M + 6, y + 21);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(C.muted);
  doc.text(`${weeks.length} uker  ·  ${(totalMin / 60).toFixed(1).replace('.', ',')} t totalt`, pageW - M - 6, y + 8, { align: 'right' });
  doc.text(`Snitt ${(totalMin / numWeeks / 60).toFixed(1).replace('.', ',')} t/uke av 37,5 t`, pageW - M - 6, y + 13, { align: 'right' });
  const barX = M + 70, barW = contentW - 70 - 6, barY = y + 19, barH = 5;
  setFill(C.panel); doc.roundedRect(barX, barY, barW, barH, 1, 1, 'F');
  const fillW = Math.max(1.5, Math.min(barW, (Math.min(pct, 130) / 130) * barW));
  setFill(pctColor); doc.roundedRect(barX, barY, fillW, barH, 1, 1, 'F');
  setDraw(C.dark); doc.setLineWidth(0.4);
  const mark = barX + barW * (100 / 130);
  doc.line(mark, barY - 1.5, mark, barY + barH + 1.5);
  doc.setFontSize(7); setText(C.muted);
  doc.text('100%', mark, barY + barH + 4.5, { align: 'center' });
  y += cardH + 10;

  // ---------- Uketabeller ----------
  const colsN = { dag: M + 4, type: M + 32, start: M + 60, slutt: M + 84, lunsj: M + 108, net: M + 140 };
  const colsF = { dag: M + 6, start: M + 32, slutt: M + 50, lunsj: M + 68, avail: M + 88, arb: M + 116, lonn: M + 146 };
  const rowH = fatsPdf ? 7 : 8;

  const drawTableHead = () => {
    setFill(C.panel); doc.roundedRect(M, y, contentW, 7, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setText(C.muted);
    if (fatsPdf) {
      doc.text('DAG', colsF.dag, y + 4.7);
      doc.text('START', colsF.start, y + 4.7);
      doc.text('SLUTT', colsF.slutt, y + 4.7);
      doc.text('LUNSJ', colsF.lunsj, y + 4.7);
      doc.text('TILGJENG.', colsF.avail, y + 4.7);
      doc.text('ARBEIDSTID', colsF.arb, y + 4.7);
      doc.text('LØNNSTID', colsF.lonn, y + 4.7);
    } else {
      doc.text('DAG', colsN.dag, y + 4.7);
      doc.text('TYPE', colsN.type, y + 4.7);
      doc.text('START', colsN.start, y + 4.7);
      doc.text('SLUTT', colsN.slutt, y + 4.7);
      doc.text('LUNSJ', colsN.lunsj, y + 4.7);
      doc.text('NETTOTID', colsN.net, y + 4.7);
    }
    y += 7;
  };

  weeks.forEach((week, wi) => {
    ensure(24);
    const wm = weekMeta[wi];
    // Ukeoverskrift (respekterer rotasjon)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setText(C.dark);
    doc.text(`Uke ${wm.num}`, M, y + 4);
    if (!isRotasjon()) {
      const mon = isoWeekToDate(wm.num, wm.year);
      const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(C.muted);
      doc.text(`${formatDateShort(mon)}–${formatDateShort(sun)} ${wm.year}`, M + 26, y + 4);
    }
    y += 9;
    drawTableHead();

    let weekTotalNet = 0, weekTotalAvail = 0, weekTotalPaid = 0;
    let hasAny = false, rowI = 0;
    const footnotes = [];

    // Tegner én rad og håndterer striping/sideskift
    const printRow = (dayName, s, lunch, avail, paid, net, cat) => {
      if (y + rowH > FOOT) { doc.addPage(); y = M; drawTableHead(); }
      if (rowI % 2 === 1) { setFill(C.zebra); doc.rect(M, y, contentW, rowH, 'F'); }
      const midY = y + rowH / 2 + 1.4;
      const cs = PDF_CAT[cat] || PDF_CAT.dag;
      if (fatsPdf) {
        setFill(cs.dot); doc.circle(colsF.dag - 2.5, y + rowH / 2, 1.1, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setText(C.dark);
        doc.text(dayName, colsF.dag, midY);
        doc.text(minutesToHHMM(s.start), colsF.start, midY);
        doc.text(minutesToHHMM(s.end), colsF.slutt, midY);
        setText(C.muted); doc.text(lunch ? `${lunch} min` : '–', colsF.lunsj, midY);
        setText(C.body); doc.text(fmtHrMinShort(avail), colsF.avail, midY);
        doc.text(fmtT(paid), colsF.arb, midY);
        doc.setFont('helvetica', 'bold'); setText(C.dark); doc.text(fmtT(paid), colsF.lonn, midY);
      } else {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(C.dark);
        doc.text(dayName, colsN.dag, midY);
        const chipW = 16, chipH = 5;
        setFill(cs.fill); doc.roundedRect(colsN.type, y + rowH / 2 - chipH / 2, chipW, chipH, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setText(cs.text);
        doc.text(cs.label, colsN.type + chipW / 2, y + rowH / 2 + 1.1, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(C.dark);
        doc.text(minutesToHHMM(s.start), colsN.start, midY);
        doc.text(minutesToHHMM(s.end), colsN.slutt, midY);
        setText(C.muted); doc.text(lunch ? `${lunch} min` : '–', colsN.lunsj, midY);
        doc.setFont('helvetica', 'bold'); setText(C.dark); doc.text(fmtT(net), colsN.net, midY);
      }
      y += rowH;
      rowI++;
    };

    // Fortsettelse fra forrige ukes søndag (vakt over døgnskillet)
    if (wi > 0 && weeks[wi - 1]) {
      (weeks[wi - 1][6] || []).forEach(s => {
        if (s.end > TIMELINE_END) {
          hasAny = true;
          const split = splitShiftAcrossWeeks(s, 6);
          weekTotalNet += split.nextWeekNet;
          weekTotalAvail += split.nextWeekAvail;
          weekTotalPaid += split.nextWeekPaid;
          const prevUkeNum = weekMeta[wi - 1] ? weekMeta[wi - 1].num : '?';
          footnotes.push(`* Fra uke ${prevUkeNum}`);
          printRow(`${DAY_NAMES[6]}–${DAY_NAMES[0]}*`, s, split.nextWeekLunch,
                   split.nextWeekAvail, split.nextWeekPaid, split.nextWeekNet,
                   categorizeShift(wi - 1, 6, s));
        }
      });
    }

    for (let di = 0; di < 7; di++) {
      week[di].forEach(s => {
        hasAny = true;
        const split = splitShiftAcrossWeeks(s, di);
        weekTotalNet += split.currentWeekNet;
        weekTotalAvail += split.currentWeekAvail;
        weekTotalPaid += split.currentWeekPaid;
        let dayName;
        if (isSundayCrossWeek(s, di)) {
          dayName = `${DAY_NAMES[6]}–${DAY_NAMES[0]}*`;
          const nextUkeNum = weekMeta[wi + 1] ? weekMeta[wi + 1].num : '?';
          footnotes.push(`* Fortsetter i uke ${nextUkeNum}`);
        } else if (s.end > TIMELINE_END && di + 1 < 7) {
          dayName = `${DAY_NAMES[di]}–${DAY_NAMES[di + 1]}`;
        } else {
          dayName = DAY_NAMES[di];
        }
        printRow(dayName, s, split.currentWeekLunch, split.currentWeekAvail,
                 split.currentWeekPaid, split.currentWeekNet, categorizeShift(wi, di, s));
      });
    }

    if (!hasAny) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); setText(C.muted);
      doc.text('Ingen vakter denne uken.', (fatsPdf ? colsF.dag : colsN.dag), y + 5);
      doc.setFont('helvetica', 'normal');
      y += 8;
    }

    // Sumlinje
    setDraw(C.line); doc.setLineWidth(0.3); doc.line(M, y, M + contentW, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); setText(C.dark);
    if (fatsPdf) {
      doc.text('Sum uke', colsF.avail - 22, y + 5.5);
      doc.text(fmtHrMinShort(weekTotalAvail), colsF.avail, y + 5.5);
      doc.text(fmtT(weekTotalPaid), colsF.arb, y + 5.5);
      doc.text(fmtT(weekTotalPaid), colsF.lonn, y + 5.5);
    } else {
      doc.text('Sum uke', colsN.lunsj, y + 5.5);
      doc.text(fmtT(weekTotalNet), colsN.net, y + 5.5);
    }
    y += 9;

    if (footnotes.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(C.muted);
      [...new Set(footnotes)].forEach(fn => { ensure(4); doc.text(fn, M, y); y += 4; });
    }
    y += 4;
  });

  // ---------- Tilleggsinformasjon ----------
  const sections = [
    ['Årsak til turnusendring', formData.aarsak],
    ['Fagforbundets syn / forslag', formData.fagforbundetSyn],
    ['Annen kommentar', formData.annenKommentar],
  ].filter(([, v]) => v && v.trim());

  sections.forEach(([k, v]) => {
    const lines = doc.splitTextToSize(v, contentW - 8);
    ensure(12 + lines.length * 5);
    setFill(C.primary); doc.roundedRect(M, y - 3.5, 1.6, 5, 0.8, 0.8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); setText(C.dark);
    doc.text(k, M + 5, y);
    y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setText(C.body);
    lines.forEach(line => { ensure(5); doc.text(line, M + 5, y); y += 5; });
    y += 5;
  });

  // ---------- Signaturer ----------
  ensure(36);
  y = Math.max(y, FOOT - 32);
  const boxW = (contentW - 8) / 2, boxH = 30;
  [['Avdelingsleder', M], ['Tillitsvalgt / Fagforbundet', M + boxW + 8]].forEach(([label, bx]) => {
    setDraw(C.line); setFill([255, 255, 255]); doc.setLineWidth(0.2);
    doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setText(C.muted);
    doc.text(label.toUpperCase(), bx + 4, y + 6);
    setDraw(C.dark); doc.setLineWidth(0.3);
    doc.line(bx + 4, y + 16, bx + boxW - 4, y + 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setText(C.muted);
    doc.text('Signatur', bx + 4, y + 19.5);
    doc.line(bx + 4, y + 24, bx + boxW / 2 - 2, y + 24);
    doc.text('Dato', bx + 4, y + 27.5);
  });

  // ---------- Bunntekst ----------
  const today = new Date();
  const genStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    setDraw(C.line); doc.setLineWidth(0.2);
    doc.line(M, pageH - 12, pageW - M, pageH - 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(C.muted);
    doc.text(`Generert ${genStr} · Turnusgenerator`, M, pageH - 7);
    doc.text(`Side ${p} av ${totalPages}`, pageW - M, pageH - 7, { align: 'right' });
  }

  const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const filename = `Drøftingsnotat_${(formData.avdeling || 'turnus').replace(/\s+/g, '_')}_${dateStr}.pdf`;
  doc.save(filename);
  return filename;
}

function hardReset() {
  formData = {
    avdeling: '', avdelingsleder: '', typeTurnus: 'Personlig',
    ikrafttredelsesdato: '', navn: '', antallSjaforer: 1,
    aarsak: '', fagforbundetSyn: '', annenKommentar: '',
    epostTillitsvalgt: '', epostLeder: '', rullerende: false, lastebil: false,
  };
  lastebil = false;
  lastSavedAt = null;
  discardDraft();
  const today = currentIsoWeek();
  const first = addWeeksToIso(today.num, today.year, 2);
  weekMeta = [{ num: first.num, year: first.year }];
  weeks = [emptyWeek()];
  activeWeek = 0;
  fatsResult = { broken: [], warnings: [], shiftFlags: {}, weekFlags: {} };
}

// ====== PDF action wiring ======
function wireGlobalClose() {
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-duplicate]') && !e.target.closest('.shift-dup-menu')) {
      closeDupMenu();
    }
  });
}

function wireActions() {
  document.getElementById('btn-pdf').addEventListener('click', () => {
    const tryPdf = () => generatePDF();
    if (lastebil && fatsResult.broken.length > 0) {
      confirmDialog(
        'FATS-brudd oppdaget',
        `Turnusen har ${fatsResult.broken.length} FATS-brudd. Er du sikker på at du vil generere drøftingsnotatet?`,
        tryPdf
      );
    } else {
      tryPdf();
    }
  });

  document.getElementById('btn-email').addEventListener('click', () => {
    const filename = generatePDF();
    showEmailModal(filename);
  });

  document.getElementById('btn-print').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    confirmDialog(
      'Nullstille turnusgeneratoren?',
      'Alle data går tapt — skjemafelt, vakter og alle uker slettes. Denne handlingen kan ikke angres.',
      () => { hardReset(); syncFormToDOM(); renderAll(); },
      { okLabel: 'Nullstill', okClass: 'btn btn-danger' }
    );
  });
}

function showEmailModal(filename) {
  const backdrop = document.getElementById('modal-backdrop');
  document.getElementById('modal-title').textContent = 'Send drøftingsnotat på e-post';
  document.getElementById('modal-body').innerHTML = `
    <ol style="padding-left: 20px; line-height: 1.7;">
      <li>PDF-en er lastet ned til nedlastingsmappen.</li>
      <li>E-postklienten åpnes nå.</li>
      <li>Dra filen <strong>${filename}</strong> inn i e-posten før du sender.</li>
    </ol>
  `;
  const foot = document.getElementById('modal-foot');
  foot.innerHTML = '';
  const ok = document.createElement('button');
  ok.className = 'btn btn-primary';
  ok.textContent = 'OK, åpne e-post';
  ok.addEventListener('click', () => {
    const to = formData.epostTillitsvalgt || '';
    const subject = encodeURIComponent(`Drøftingsnotat turnus – ${formData.avdeling}`);
    const body = encodeURIComponent(
      `Hei,\n\nVedlagt drøftingsnotat for turnusendring ved ${formData.avdeling}.\n\nMed vennlig hilsen\n${formData.avdelingsleder}`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    backdrop.hidden = true;
  });
  foot.appendChild(ok);
  document.getElementById('modal-close').onclick = () => { backdrop.hidden = true; };
  backdrop.hidden = false;
}

// ====== Restore banner ======
function maybeShowRestoreBanner() {
  const draft = loadDraftRaw();
  if (!draft || !draft.savedAt) return;
  const banner = document.getElementById('restore-banner');
  const t = new Date(draft.savedAt);
  document.getElementById('restore-time').textContent = t.toLocaleString('nb-NO');
  banner.hidden = false;
  document.getElementById('restore-yes').addEventListener('click', () => {
    weeks = draft.weeks || weeks;
    weekMeta = draft.weekMeta || weekMeta;
    activeWeek = clamp(draft.activeWeek || 0, 0, weeks.length - 1);
    lastebil = !!draft.lastebil;
    formData = { ...formData, ...(draft.formData || {}) };
    migrateAllShifts();
    banner.hidden = true;
    renderAll();
    toast('Utkastet ble gjenopprettet');
  });
  document.getElementById('restore-no').addEventListener('click', () => {
    discardDraft();
    banner.hidden = true;
  });
}

// ====== Boot ======
function init() {
  initDefaults();
  maybeShowRestoreBanner();
  wireForm();
  wireTimeline();
  wireActions();
  wireGlobalClose();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
