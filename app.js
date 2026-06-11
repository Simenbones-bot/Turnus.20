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
const TIMELINE_END = 30 * 60; // 30 hours in minutes
const SNAP = 15;
const MIN_SHIFT = 15;

// ====== Utilities ======
function minutesToHHMM(min) {
  const wrapped = min >= 24 * 60;
  const m = wrapped ? min - 24 * 60 : min;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const s = String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  return wrapped ? s + '+1' : s;
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

// ====== FATS validation ======
function validateFATS() {
  const result = { broken: [], warnings: [], shiftFlags: {}, weekFlags: {} };
  if (!lastebil) { fatsResult = result; return; }

  weeks.forEach((week, wi) => {
    let weekTotal = 0;
    // Rule 1: per-shift net > 600
    week.forEach((day, di) => {
      day.forEach((s, si) => {
        const net = shiftNet(s);
        weekTotal += net;
        if (net > 600) {
          const key = `${wi}-${di}-${si}`;
          result.shiftFlags[key] = 'broken';
          result.broken.push({
            week: wi, dayIdx: di,
            rule: 'shift-10h',
            text: `Vakt ${DAY_SHORT[di]} er ${(net / 60).toFixed(1)} t (over 10 t)`,
          });
        }
      });
    });
    // Rule 2: weekly net > 3600
    if (weekTotal > 3600) {
      result.weekFlags[wi] = 'broken';
      result.broken.push({
        week: wi,
        rule: 'week-60h',
        text: `Sum uke ${weekMeta[wi].num}: ${(weekTotal / 60).toFixed(1)} t (over 60 t)`,
      });
      // mark all shifts in this week
      week.forEach((day, di) => {
        day.forEach((_, si) => {
          result.shiftFlags[`${wi}-${di}-${si}`] = 'broken';
        });
      });
    }
    // Rule 3: rest >= 660 between consecutive days
    for (let di = 1; di < 7; di++) {
      if (!week[di].length) continue;
      // find latest end on previous day
      const prev = week[di - 1];
      if (!prev.length) continue;
      const lastEnd = Math.max(...prev.map(x => x.end));
      const firstStart = Math.min(...week[di].map(x => x.start));
      // gap in minutes: (di * 1440 + firstStart) - ((di-1)*1440 + lastEnd) = 1440 + firstStart - lastEnd
      const gap = 1440 + firstStart - lastEnd;
      if (gap < 660) {
        // mark first shift on di (the one with the earliest start)
        const earliestIdx = week[di].reduce((acc, s, i, arr) => s.start < arr[acc].start ? i : acc, 0);
        result.shiftFlags[`${wi}-${di}-${earliestIdx}`] = 'broken';
        result.broken.push({
          week: wi, dayIdx: di,
          rule: 'rest-11h',
          text: `Hviletid mellom ${DAY_SHORT[di-1]} og ${DAY_SHORT[di]} er ${(gap / 60).toFixed(1)} t`,
        });
      }
    }
    // Rule 4: largest gap in week >= 1440
    // Build all "absolute" minute pairs (di*1440 + start, di*1440 + end)
    const all = [];
    week.forEach((day, di) => {
      day.forEach(s => all.push({ s: di * 1440 + s.start, e: di * 1440 + s.end }));
    });
    if (all.length >= 2) {
      all.sort((a, b) => a.s - b.s);
      let maxGap = 0;
      for (let i = 1; i < all.length; i++) {
        const g = all[i].s - all[i - 1].e;
        if (g > maxGap) maxGap = g;
      }
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
    el.classList.remove('saved');
  } else {
    const t = lastSavedAt;
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    el.textContent = `✓ Sist lagret kl. ${hh}:${mm} · auto-lagret som utkast`;
    el.classList.add('saved');
  }
}

// ====== Initial data ======
function initDefaults() {
  weekMeta = [{ num: 22, year: 2025 }];
  weeks = [emptyWeek()];
  // Mon-Fri shifts uke 22
  weeks[0][0] = [{ start: 7 * 60, end: 15 * 60 + 30 }];
  weeks[0][1] = [{ start: 7 * 60, end: 15 * 60 + 30 }];
  weeks[0][2] = [{ start: 7 * 60, end: 15 * 60 + 30 }];
  weeks[0][3] = [{ start: 7 * 60, end: 15 * 60 + 30 }];
  weeks[0][4] = [{ start: 7 * 60, end: 15 * 60 }];
  activeWeek = 0;
  formData.avdeling = 'Bergen Distribusjon';
  formData.avdelingsleder = 'Ingrid Solheim';
  formData.typeTurnus = 'Personlig';
  formData.ikrafttredelsesdato = '2026-07-01';
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
    tab.title = 'Dobbeltklikk for å endre ukenummer og år';
    tab.innerHTML = `<span class="tab-label">Uke ${wm.num}</span>` +
                    `<span class="tab-year mono">'${String(wm.year).slice(-2)}</span>`;
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
        }, { danger: true, okLabel: 'Slett uke' });
      });
      tab.appendChild(close);
    }
    tabs.appendChild(tab);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'week-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'Legg til ny (tom) uke';
  addBtn.addEventListener('click', addWeek);
  tabs.appendChild(addBtn);

  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'week-tab-add';
  dupBtn.textContent = '⧉';
  dupBtn.title = 'Kopier aktiv uke til ny uke';
  dupBtn.addEventListener('click', duplicateWeek);
  tabs.appendChild(dupBtn);
}

function editWeekTab(i, tabEl) {
  const wm = weekMeta[i];
  tabEl.innerHTML = '';
  const numInp = document.createElement('input');
  numInp.type = 'number'; numInp.min = 1; numInp.max = 53; numInp.value = wm.num;
  numInp.className = 'week-edit-input';
  const yearInp = document.createElement('input');
  yearInp.type = 'number'; yearInp.min = 2000; yearInp.max = 2100; yearInp.value = wm.year;
  yearInp.className = 'week-edit-input';
  tabEl.appendChild(numInp);
  tabEl.appendChild(yearInp);
  numInp.focus();
  numInp.select();
  const commit = () => {
    const max = isoWeeksInYear(parseInt(yearInp.value));
    wm.num = clamp(parseInt(numInp.value) || 1, 1, max);
    wm.year = parseInt(yearInp.value) || wm.year;
    scheduleSave();
    renderAll();
  };
  const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') renderAll(); };
  numInp.addEventListener('blur', commit);
  yearInp.addEventListener('blur', commit);
  numInp.addEventListener('keydown', onKey);
  yearInp.addEventListener('keydown', onKey);
}

function nextWeekMeta() {
  const last = weekMeta[weekMeta.length - 1] || { num: 1, year: new Date().getFullYear() };
  const max = isoWeeksInYear(last.year);
  let num = last.num + 1, year = last.year;
  if (num > max) { num = 1; year += 1; }
  return { num, year };
}

function addWeek() {
  weekMeta.push(nextWeekMeta());
  weeks.push(emptyWeek());
  activeWeek = weeks.length - 1;
  scheduleSave();
  renderAll();
}

function duplicateWeek() {
  const src = weeks[activeWeek];
  if (!src) return;
  const meta = nextWeekMeta();
  weekMeta.push(meta);
  weeks.push(src.map(day => day.map(s => ({ ...s }))));
  activeWeek = weeks.length - 1;
  scheduleSave();
  renderAll();
  toast(`Uke ${meta.num} opprettet som kopi`);
}

function renderDateRange() {
  const el = document.getElementById('week-daterange');
  if (!weekMeta[activeWeek]) { el.textContent = ''; return; }
  const wm = weekMeta[activeWeek];
  const mon = isoWeekToDate(wm.num, wm.year);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  el.textContent = `${formatDateShort(mon)} – ${formatDateShort(sun)} ${wm.year}`;
}

function renderTimeline() {
  const root = document.getElementById('timeline');
  root.innerHTML = '';

  // header with hour labels
  const header = document.createElement('div');
  header.className = 'timeline-header';
  const spacer = document.createElement('div');
  spacer.className = 'day-label-spacer';
  header.appendChild(spacer);
  const hoursWrap = document.createElement('div');
  hoursWrap.className = 'hours';
  for (let h = 0; h <= 30; h += 3) {
    const tick = document.createElement('span');
    tick.className = 'hour-tick' + (h >= 24 ? ' next-day' : '');
    tick.style.left = ((h / 30) * 100) + '%';
    const label = h >= 24 ? `${String(h - 24).padStart(2, '0')}+1` : `${String(h).padStart(2, '0')}:00`;
    tick.textContent = label;
    hoursWrap.appendChild(tick);
  }
  header.appendChild(hoursWrap);
  root.appendChild(header);

  const week = weeks[activeWeek] || emptyWeek();
  const wm = weekMeta[activeWeek];
  const monday = wm ? isoWeekToDate(wm.num, wm.year) : null;
  for (let di = 0; di < 7; di++) {
    const row = document.createElement('div');
    row.className = 'timeline-row';
    if (di >= 5) row.classList.add('weekend');
    const dayLabel = document.createElement('div');
    dayLabel.className = 'day-label';
    dayLabel.textContent = DAY_SHORT[di];
    if (monday) {
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + di);
      const date = document.createElement('span');
      date.className = 'day-date';
      date.textContent = formatDateShort(d);
      dayLabel.appendChild(date);
    }
    const track = document.createElement('div');
    track.className = 'day-track';
    track.dataset.day = di;

    // hour gridlines
    for (let h = 1; h < 30; h++) {
      const gl = document.createElement('div');
      gl.className = 'hour-gridline';
      gl.style.left = ((h / 30) * 100) + '%';
      track.appendChild(gl);
    }

    // shifts
    week[di].forEach((s, si) => {
      const cat = categorizeShift(activeWeek, di, s);
      const block = document.createElement('div');
      const isBroken = fatsResult.shiftFlags[`${activeWeek}-${di}-${si}`] === 'broken';
      block.className = 'shift shift-' + cat + (isBroken ? ' broken' : '');
      const leftPct = (s.start / TIMELINE_END) * 100;
      const widthPct = ((s.end - s.start) / TIMELINE_END) * 100;
      block.style.left = leftPct + '%';
      block.style.width = widthPct + '%';
      block.dataset.day = di;
      block.dataset.idx = si;
      block.innerHTML = `
        <span class="shift-label"><i class="label-dot"></i>${cat.toUpperCase()}</span>
        <span class="shift-time">${minutesToHHMM(s.start)} – ${minutesToHHMM(s.end)}</span>
        ${isBroken ? '<span class="shift-warn">⚠</span>' : ''}
        <span class="shift-handle left" data-handle="start">⋮</span>
        <span class="shift-handle right" data-handle="end">⋮</span>
      `;
      track.appendChild(block);
    });

    row.appendChild(dayLabel);
    row.appendChild(track);
    root.appendChild(row);
  }

  // First-use hint when the week is empty
  if (!week.some(d => d.length)) {
    const overlay = document.createElement('div');
    overlay.className = 'timeline-hint-overlay';
    const txt = isMobile() ? 'Trykk på en dag for å legge til vakt' : 'Klikk og dra på en dag for å lage en vakt';
    overlay.innerHTML = `<span>👆 ${txt}</span>`;
    root.appendChild(overlay);
  }
}

function renderDetailList() {
  const root = document.getElementById('detail-list');
  const week = weeks[activeWeek] || emptyWeek();
  const rows = [];
  let total = 0;
  for (let di = 0; di < 7; di++) {
    week[di].forEach((s, si) => {
      const gross = shiftGross(s);
      const lunch = lunchMinutes(gross);
      const net = gross - lunch;
      total += net;
      const broken = fatsResult.shiftFlags[`${activeWeek}-${di}-${si}`] === 'broken';
      const cat = categorizeShift(activeWeek, di, s);
      rows.push({ di, si, s, lunch, net, broken, cat });
    });
  }
  if (!rows.length) {
    root.innerHTML = `<div class="detail-empty">Ingen vakter denne uken. Klikk og dra på tidslinjen for å lage en.</div>`;
    return;
  }
  let html = `<table>
    <thead>
      <tr><th>Dag</th><th>Type</th><th>Start</th><th>Slutt</th><th>Lunsj</th><th>Nettotid</th><th></th></tr>
    </thead>
    <tbody>`;
  rows.forEach(r => {
    const catLabel = r.cat.charAt(0).toUpperCase() + r.cat.slice(1);
    html += `<tr class="${r.broken ? 'row-broken' : ''}">
      <td>${DAY_NAMES[r.di]}</td>
      <td><span class="cat-chip chip-${r.cat}">${catLabel}</span></td>
      <td class="mono">${minutesToHHMM(r.s.start)}</td>
      <td class="mono">${minutesToHHMM(r.s.end)}</td>
      <td class="mono">${r.lunch} min</td>
      <td class="mono">${(r.net / 60).toFixed(2)} t</td>
      <td><button class="delete-btn" data-del="${r.di}-${r.si}" aria-label="Slett vakt">×</button></td>
    </tr>`;
  });
  html += `</tbody>
    <tfoot>
      <tr><td colspan="5" style="text-align:right; font-weight:600;">Sum uke:</td><td class="mono" style="font-weight:600;">${(total / 60).toFixed(2)} t</td><td></td></tr>
    </tfoot>
  </table>`;
  root.innerHTML = html;
  root.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [di, si] = btn.dataset.del.split('-').map(Number);
      weeks[activeWeek][di].splice(si, 1);
      scheduleSave();
      renderAll();
    });
  });
}

function renderSummary() {
  const totalMin = weeks.reduce((sum, w) => sum + w.reduce((s, day) => s + day.reduce((a, sh) => a + shiftNet(sh), 0), 0), 0);
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
  const title = (formData.avdeling || 'Avdeling') + ' · Rotasjon på ' + weeks.length + ' uke' + (weeks.length === 1 ? '' : 'r');
  document.getElementById('sum-title').textContent = title;

  // Gauge arc + needle (needle is the vertical line in markup, rotated via CSS for smooth animation)
  const clamped = Math.min(pct, 130) / 130; // 0..1
  // The full arc path length ~ pi * 80 ≈ 251.3
  const arcLen = Math.PI * 80;
  const dash = clamped * arcLen;
  const arc = document.getElementById('gauge-arc');
  arc.setAttribute('stroke-dasharray', `${dash} ${arcLen}`);
  arc.setAttribute('stroke', pct > 100 ? '#dc2626' : (pct > 80 ? '#d97706' : '#16a34a'));
  const needle = document.getElementById('gauge-needle');
  needle.style.transform = `rotate(${clamped * 180 - 90}deg)`; // -90 (left) to +90 (right)
  needle.setAttribute('stroke', pct > 100 ? '#dc2626' : '#0f172a');

  // Mobile stat bar mirrors the key numbers
  const msbPct = document.getElementById('msb-pct');
  if (msbPct) {
    msbPct.textContent = pct.toFixed(1).replace('.', ',') + '%';
    msbPct.classList.toggle('over', pct > 100);
    document.getElementById('msb-sum').textContent = (totalMin / 60).toFixed(1).replace('.', ',') + ' t';
  }
}

function renderFatsPanel() {
  const panel = document.getElementById('fats-panel');
  const list = document.getElementById('fats-list');
  const counter = document.getElementById('fats-count');
  if (!lastebil || (fatsResult.broken.length === 0 && fatsResult.warnings.length === 0)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  counter.textContent = `${fatsResult.broken.length} brudd · ${fatsResult.warnings.length} advarsler`;
  list.innerHTML = '';
  const ruleTitle = {
    'shift-10h': 'Vakt over 10 timer',
    'week-60h': 'Over 60 timer i uka',
    'rest-11h': 'Hviletid under 11 timer',
    'rest-24h': 'Mangler 24 t sammenhengende hvile',
  };
  const renderItem = (item, type) => {
    const div = document.createElement('div');
    div.className = 'fats-item ' + (type === 'broken' ? 'broken' : 'warn');
    div.innerHTML = `<span class="icon">⚠</span><div class="body"><strong>Uke ${weekMeta[item.week].num} · ${ruleTitle[item.rule]}</strong><span>${item.text}</span></div>`;
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
      scheduleSave();
      // partial re-render: keep timeline if shifts unchanged
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
    const handle = e.target.closest('.shift-handle');
    const shiftEl = e.target.closest('.shift');
    const track = e.target.closest('.day-track');
    if (!track) return;
    const di = parseInt(track.dataset.day);
    const rect = track.getBoundingClientRect();
    if (shiftEl) {
      const si = parseInt(shiftEl.dataset.idx);
      const shift = weeks[activeWeek][di][si];
      if (handle) {
        const which = handle.dataset.handle === 'start' ? 'resize-start' : 'resize-end';
        drag = {
          mode: which, weekIdx: activeWeek, dayIdx: di, shiftIdx: si,
          startX: e.clientX, originalShift: { ...shift }, trackRect: rect,
        };
      } else {
        drag = {
          mode: 'move', weekIdx: activeWeek, dayIdx: di, shiftIdx: si,
          startX: e.clientX, originalShift: { ...shift }, trackRect: rect,
        };
      }
      shiftEl.classList.add('dragging');
      e.preventDefault();
    } else {
      // Create new shift
      const startMin = snap(pxToMinutes(track, e.clientX - rect.left));
      const newShift = { start: startMin, end: startMin + MIN_SHIFT };
      weeks[activeWeek][di].push(newShift);
      const si = weeks[activeWeek][di].length - 1;
      drag = {
        mode: 'resize-end', weekIdx: activeWeek, dayIdx: di, shiftIdx: si,
        startX: e.clientX, originalShift: { ...newShift }, trackRect: rect, createdNew: true,
      };
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
      let newStart = clamp(snap(originalShift.start + deltaMin), 0, TIMELINE_END - length);
      shift.start = newStart;
      shift.end = newStart + length;
    } else if (mode === 'resize-start') {
      let newStart = clamp(snap(originalShift.start + deltaMin), 0, shift.end - MIN_SHIFT);
      shift.start = newStart;
    } else if (mode === 'resize-end') {
      // For new shift creation, recalc from absolute mouse position
      if (drag.createdNew) {
        const px = e.clientX - trackRect.left;
        let newEnd = clamp(snap(pxToMinutes(document.querySelector(`.day-track[data-day="${dayIdx}"]`), px)), shift.start + MIN_SHIFT, TIMELINE_END);
        shift.end = newEnd;
      } else {
        let newEnd = clamp(snap(originalShift.end + deltaMin), shift.start + MIN_SHIFT, TIMELINE_END);
        shift.end = newEnd;
      }
    }
    renderTimeline();
  });

  document.addEventListener('mouseup', () => {
    if (!drag.mode) return;
    // Snap and validate
    const shift = weeks[drag.weekIdx][drag.dayIdx][drag.shiftIdx];
    if (shift) {
      shift.start = snap(shift.start);
      shift.end = snap(shift.end);
      if (shift.end - shift.start < MIN_SHIFT) {
        // remove tiny shift
        weeks[drag.weekIdx][drag.dayIdx].splice(drag.shiftIdx, 1);
      }
    }
    drag = { mode: null };
    scheduleSave();
    renderAll();
  });

  // Touch / mobile: open modal on click
  root.addEventListener('click', e => {
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
        shifts.push({ start: 7 * 60, end: 15 * 60 });
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
    const max = allowNextDay ? TIMELINE_END : 24 * 60;
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

// ====== Confirm dialog ======
function confirmDialog(title, text, onOk, opts = {}) {
  const bd = document.getElementById('confirm-backdrop');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  const ok = document.getElementById('confirm-ok');
  ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
  ok.textContent = opts.okLabel || 'OK';
  bd.hidden = false;
  document.getElementById('confirm-cancel').onclick = () => { bd.hidden = true; };
  ok.onclick = () => { bd.hidden = true; onOk && onOk(); };
}

// ====== Modal dismissal (Escape / click outside) ======
function closeBackdrop(bd) {
  bd.hidden = true;
  // The mobile shift modal edits state directly; re-render to reflect it
  if (bd.id === 'modal-backdrop') { scheduleSave(); renderAll(); }
}
function wireModalDismiss() {
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('mousedown', e => { if (e.target === bd) closeBackdrop(bd); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal-backdrop')].find(b => !b.hidden);
    if (open) closeBackdrop(open);
  });
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
function generatePDF() {
  if (!window.jspdf) { toast('PDF-bibliotek ikke lastet'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  let y = margin;

  // Blue header box
  doc.setFillColor(26, 86, 219);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('DRØFTINGSNOTAT – TURNUS', margin, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Avdeling: ${formData.avdeling}   ·   Leder: ${formData.avdelingsleder}`, margin, 21);
  y = 36;

  doc.setTextColor(15, 23, 42);

  // Info table
  const info = [
    ['Type turnus', formData.typeTurnus],
    [formData.typeTurnus === 'Personlig' ? 'Navn' : 'Antall sjåfører',
     formData.typeTurnus === 'Personlig' ? (formData.navn || '–') : String(formData.antallSjaforer)],
    ['Ikrafttredelsesdato', formatDateNO(formData.ikrafttredelsesdato)],
    ['Rullerende turnus', formData.rullerende ? 'Ja' : 'Nei'],
    ['Lastebil / FATS', formData.lastebil ? 'Ja' : 'Nei'],
  ];
  doc.setFontSize(10);
  info.forEach(([k, v]) => {
    doc.setTextColor(100, 116, 139);
    doc.text(k, margin, y);
    doc.setTextColor(15, 23, 42);
    doc.text(String(v || '–'), margin + 60, y);
    y += 6;
  });
  y += 4;

  // Stillingsprosent
  const totalMin = weeks.reduce((sum, w) => sum + w.reduce((s, day) => s + day.reduce((a, sh) => a + shiftNet(sh), 0), 0), 0);
  const numWeeks = weeks.length || 1;
  const avg = totalMin / numWeeks / 60;
  const pct = (avg / 37.5) * 100;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Stillingsprosent: ${pct.toFixed(1).replace('.', ',')}%`, margin, y);
  y += 4;
  // Bar
  const barW = pageW - margin * 2;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, barW, 5, 'FD');
  const fillW = Math.min(barW, (Math.min(pct, 130) / 100) * barW);
  if (pct > 100) doc.setFillColor(220, 38, 38);
  else doc.setFillColor(22, 163, 74);
  doc.rect(margin, y, fillW, 5, 'F');
  // 100% marker
  doc.setDrawColor(15, 23, 42);
  doc.line(margin + barW * (100 / 130), y - 1, margin + barW * (100 / 130), y + 6);
  y += 12;

  doc.setFont('helvetica', 'normal');

  // Per week
  const pageNumbers = [];
  weeks.forEach((week, wi) => {
    if (y > pageH - 60) { doc.addPage(); y = margin; }
    const wm = weekMeta[wi];
    const mon = isoWeekToDate(wm.num, wm.year);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Uke ${wm.num} ${wm.year}  (${formatDateShort(mon)}–${formatDateShort(sun)})`, margin, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const cols = [margin, margin + 30, margin + 60, margin + 90, margin + 130];
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y - 4, pageW - margin * 2, 6, 'F');
    doc.setTextColor(100, 116, 139);
    ['Dag', 'Start', 'Slutt', 'Lunsj', 'Nettotid'].forEach((h, i) => doc.text(h, cols[i], y));
    y += 4;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    let weekTotal = 0;
    let hasAny = false;
    for (let di = 0; di < 7; di++) {
      week[di].forEach(s => {
        hasAny = true;
        if (y > pageH - 25) { doc.addPage(); y = margin; }
        const gross = shiftGross(s);
        const lunch = lunchMinutes(gross);
        const net = gross - lunch;
        weekTotal += net;
        doc.text(DAY_NAMES[di], cols[0], y);
        doc.text(minutesToHHMM(s.start), cols[1], y);
        doc.text(minutesToHHMM(s.end), cols[2], y);
        doc.text(`${lunch} min`, cols[3], y);
        doc.text(`${(net / 60).toFixed(2)} t`, cols[4], y);
        y += 5;
      });
    }
    if (!hasAny) {
      doc.setTextColor(100, 116, 139);
      doc.text('Ingen vakter denne uken.', margin, y);
      doc.setTextColor(15, 23, 42);
      y += 5;
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`Sum uke: ${(weekTotal / 60).toFixed(2)} t`, cols[4] - 14, y + 2);
    doc.setFont('helvetica', 'normal');
    y += 10;
  });

  // Tilleggsinformasjon
  const sections = [
    ['Årsak til turnusendring', formData.aarsak],
    ['Fagforbundets syn / forslag', formData.fagforbundetSyn],
    ['Annen kommentar', formData.annenKommentar],
  ].filter(([, v]) => v && v.trim());

  if (sections.length) {
    if (y > pageH - 80) { doc.addPage(); y = margin; }
    sections.forEach(([k, v]) => {
      if (y > pageH - 30) { doc.addPage(); y = margin; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(k, margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(v, pageW - margin * 2);
      lines.forEach(line => {
        if (y > pageH - 25) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += 5;
      });
      y += 4;
    });
  }

  // Signatures (always at bottom of last page)
  const sigY = pageH - 30;
  if (y > sigY - 10) { doc.addPage(); }
  const sigYFinal = pageH - 30;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Avdelingsleder: _______________________', margin, sigYFinal);
  doc.text('Dato: ___________', margin, sigYFinal + 7);
  doc.text('Tillitsvalgt / Fagforbundet: _______________________', pageW / 2, sigYFinal);
  doc.text('Dato: ___________', pageW / 2, sigYFinal + 7);

  // Page numbers
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Side ${p} av ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
  }

  const today = new Date();
  const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const filename = `Drøftingsnotat_${formData.avdeling || 'turnus'}_${dateStr}.pdf`;
  doc.save(filename);
  return filename;
}

// ====== PDF action wiring ======
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

// ====== Foreslå turnus (forslagsgenerator) ======
// Defaults matcher det vanlige kunde-eksempelet: dag ~07:30–14:30, kveld ~15:00–22:30,
// dag/kveld annenhver uke, hver 3. lørdag i en 4-ukers turnus, dagvakten kortes ned for å treffe 100%.
let suggestParams = {
  numWeeks: 4,
  mode: 'target',        // target = juster til mål % · fulltid = prøv fulltid, ellers høyest · none = bruk tidene som oppgitt
  target: 100,
  startNum: null,        // settes fra gjeldende uke ved åpning
  startYear: null,
  days: [true, true, true, true, true], // man–fre som jobbes
  dayStart: 7 * 60 + 30,
  dayEnd: 14 * 60 + 30,
  eveStart: 15 * 60,
  eveEnd: 22 * 60 + 30,
  rotation: 'veksel',    // veksel = dag/kveld annenhver uke · samme = samme hverdagsvakt hver uke
  satEvery: 3,           // 0 = aldri, ellers hver N. lørdag
  satStart: 7 * 60 + 30,
  satEnd: 14 * 60 + 30,
  sunEvery: 0,           // 0 = aldri, ellers hver N. søndag
  sunStart: 7 * 60 + 30,
  sunEnd: 14 * 60 + 30,
  adjustShift: 'dag',    // hvilket ukedagsskift som justeres for å treffe målet (dag/kveld)
  adjustEnd: 'slutt',    // slutt | start – hvilken ende som flyttes
};

// Bygger en komplett turnus ut fra parametrene – rene objekter, muterer ikke global state.
function generateTurnusSuggestion(p) {
  const N = Math.max(1, p.numWeeks | 0);
  const wk = [];
  for (let i = 0; i < N; i++) wk.push(emptyWeek());

  // Fortløpende ISO-uker fra startuke
  const meta = [];
  let num = p.startNum || 1, year = p.startYear || new Date().getFullYear();
  for (let i = 0; i < N; i++) {
    meta.push({ num, year });
    num++;
    if (num > isoWeeksInYear(year)) { num = 1; year++; }
  }

  const dayShift = () => ({ start: p.dayStart, end: p.dayEnd });
  const eveShift = () => ({ start: p.eveStart, end: p.eveEnd });
  const days = p.days || [true, true, true, true, true];
  const adjustable = []; // referanser til ukedagsskift som justeres mot målet

  // Ukedager (man–fre): enten samme hverdagsvakt hver uke, eller dag/kveld annenhver uke
  for (let i = 0; i < N; i++) {
    const type = p.rotation === 'veksel' ? ((i % 2 === 0) ? 'dag' : 'kveld') : 'dag';
    for (let d = 0; d < 5; d++) {
      if (!days[d]) continue;
      const s = type === 'dag' ? dayShift() : eveShift();
      wk[i][d] = [s];
      if (type === p.adjustShift) adjustable.push(s);
    }
  }

  // Lørdag (dagIdx 5) og søndag (dagIdx 6) med egne tider, hver N. uke
  const placeWeekend = (dayIdx, every, start, end) => {
    if (every > 0) {
      for (let i = 0; i < N; i++) {
        if (i % every === (every - 1)) wk[i][dayIdx] = [{ start, end }];
      }
    }
  };
  placeWeekend(5, p.satEvery, p.satStart, p.satEnd);
  placeWeekend(6, p.sunEvery, p.sunStart, p.sunEnd);

  const sumNet = w => w.reduce((s, day) => s + day.reduce((a, sh) => a + shiftNet(sh), 0), 0);
  const totalNet = () => wk.reduce((s, w) => s + sumNet(w), 0);
  const naturalTotal = totalNet();
  const naturalPct = (naturalTotal / N / 60) / 37.5 * 100;

  // Justeringsmodus:
  //  - target:  juster valgt ukedagsskift opp/ned til mål %
  //  - fulltid: prøv 100 %, men forleng aldri (bruk kundens tider) – kort bare ned hvis over
  //  - none:    ikke juster
  const mode = p.mode || 'target';
  let adjusted = false;
  let fullReached = false;
  if (mode !== 'none' && adjustable.length) {
    const targetPct = mode === 'fulltid' ? 100 : p.target;
    const targetTotal = (targetPct / 100) * 37.5 * 60 * N;
    let per = Math.round((targetTotal - naturalTotal) / adjustable.length / SNAP) * SNAP;
    if (mode === 'fulltid' && per > 0) per = 0; // fulltid forlenger ikke kundens tider
    if (per !== 0) {
      adjusted = true;
      adjustable.forEach(s => {
        if (p.adjustEnd === 'start') s.start = clamp(s.start - per, 0, s.end - MIN_SHIFT);
        else s.end = clamp(s.end + per, s.start + MIN_SHIFT, TIMELINE_END);
      });
    }
  }

  const finalTotal = totalNet();
  const pct = (finalTotal / N / 60) / 37.5 * 100;
  if (mode === 'fulltid') fullReached = pct >= 99;
  return { weeks: wk, weekMeta: meta, pct, naturalPct, adjusted, fullReached, mode, example: adjustable[0] || null };
}

function openSuggestModal() {
  const backdrop = document.getElementById('suggest-backdrop');
  const grid = document.getElementById('suggest-grid');

  // Start fra gjeldende uke hvis vi har en
  const cur = weekMeta[activeWeek] || weekMeta[0];
  if (cur) { suggestParams.startNum = cur.num; suggestParams.startYear = cur.year; }
  else { const d = new Date(); suggestParams.startNum = 1; suggestParams.startYear = d.getFullYear(); }

  grid.innerHTML = '';

  const field = (labelText, control, full) => {
    const l = document.createElement('label');
    l.className = 'field' + (full ? ' field-full' : '');
    const s = document.createElement('span');
    s.className = 'field-label';
    s.textContent = labelText;
    l.appendChild(s);
    l.appendChild(control);
    return l;
  };
  const subhead = text => {
    const h = document.createElement('div');
    h.className = 'suggest-sub';
    h.textContent = text;
    return h;
  };
  const numInput = (value, min, max) => {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = value;
    if (min != null) inp.min = min;
    if (max != null) inp.max = max;
    return inp;
  };
  const select = (options, value) => {
    const sel = document.createElement('select');
    options.forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      if (String(v) === String(value)) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  };
  const timeSelect = (value, allowNextDay) => {
    const sel = document.createElement('select');
    const max = allowNextDay ? TIMELINE_END : 24 * 60;
    for (let m = 0; m <= max; m += SNAP) {
      const o = document.createElement('option');
      o.value = m; o.textContent = minutesToHHMM(m);
      if (m === value) o.selected = true;
      sel.appendChild(o);
    }
    return sel;
  };

  // Avkrysningsrad for ukedager (man–fre)
  const dayBoxes = [];
  const daysControl = document.createElement('div');
  daysControl.className = 'suggest-days';
  ['Man', 'Tir', 'Ons', 'Tor', 'Fre'].forEach((name, d) => {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = suggestParams.days[d] !== false;
    dayBoxes.push(cb);
    const sp = document.createElement('span');
    sp.textContent = name;
    lab.appendChild(cb); lab.appendChild(sp);
    daysControl.appendChild(lab);
  });

  // Kontroller
  const cWeeks = numInput(suggestParams.numWeeks, 1, 26);
  const cMode = select([
    ['target', 'Juster til mål %'],
    ['fulltid', 'Prøv fulltid, ellers høyest deltid'],
    ['none', 'Bruk tidene som oppgitt'],
  ], suggestParams.mode);
  const cTarget = numInput(suggestParams.target, 1, 150);
  const cStartNum = numInput(suggestParams.startNum, 1, 53);
  const cStartYear = numInput(suggestParams.startYear, 2000, 2100);
  const cRotation = select([
    ['samme', 'Samme hverdagsvakt hver uke'],
    ['veksel', 'Dag og kveld annenhver uke'],
  ], suggestParams.rotation);
  const cDayStart = timeSelect(suggestParams.dayStart, false);
  const cDayEnd = timeSelect(suggestParams.dayEnd, true);
  const cEveStart = timeSelect(suggestParams.eveStart, false);
  const cEveEnd = timeSelect(suggestParams.eveEnd, true);
  const everyOpts = label => [
    ['0', 'Aldri'], ['1', 'Hver uke'],
    ['2', `Hver 2. ${label}`], ['3', `Hver 3. ${label}`], ['4', `Hver 4. ${label}`],
  ];
  const cSatEvery = select(everyOpts('lørdag'), suggestParams.satEvery);
  const cSatStart = timeSelect(suggestParams.satStart, false);
  const cSatEnd = timeSelect(suggestParams.satEnd, true);
  const cSunEvery = select(everyOpts('søndag'), suggestParams.sunEvery);
  const cSunStart = timeSelect(suggestParams.sunStart, false);
  const cSunEnd = timeSelect(suggestParams.sunEnd, true);
  const cAdjustShift = select([['dag', 'Dagvakten'], ['kveld', 'Kveldsvakten']], suggestParams.adjustShift);
  const cAdjustEnd = select([['slutt', 'Sluttiden'], ['start', 'Starttiden']], suggestParams.adjustEnd);

  grid.appendChild(subhead('Turnus'));
  grid.appendChild(field('Antall uker', cWeeks));
  grid.appendChild(field('Stillingsmål', cMode));
  grid.appendChild(field('Mål stillingsprosent (%)', cTarget));
  grid.appendChild(field('Startuke', cStartNum));
  grid.appendChild(field('År', cStartYear));

  grid.appendChild(subhead('Ukedager (man–fre)'));
  grid.appendChild(field('Dager som jobbes', daysControl, true));
  grid.appendChild(field('Rotasjon', cRotation, true));

  grid.appendChild(subhead('Hverdagsvakt (dag)'));
  grid.appendChild(field('Fra ca', cDayStart));
  grid.appendChild(field('Til ca', cDayEnd));

  grid.appendChild(subhead('Kveldsvakt (ved annenhver uke)'));
  grid.appendChild(field('Fra ca', cEveStart));
  grid.appendChild(field('Til ca', cEveEnd));

  grid.appendChild(subhead('Lørdag'));
  grid.appendChild(field('Hyppighet', cSatEvery, true));
  grid.appendChild(field('Fra', cSatStart));
  grid.appendChild(field('Til', cSatEnd));

  grid.appendChild(subhead('Søndag'));
  grid.appendChild(field('Hyppighet', cSunEvery, true));
  grid.appendChild(field('Fra', cSunStart));
  grid.appendChild(field('Til', cSunEnd));

  grid.appendChild(subhead('Treffe stillingsprosent'));
  grid.appendChild(field('Juster lengden på', cAdjustShift));
  grid.appendChild(field('Flytt på', cAdjustEnd));

  const readParams = () => ({
    numWeeks: parseInt(cWeeks.value) || 1,
    mode: cMode.value,
    target: parseFloat(cTarget.value) || 100,
    startNum: parseInt(cStartNum.value) || 1,
    startYear: parseInt(cStartYear.value) || new Date().getFullYear(),
    days: dayBoxes.map(cb => cb.checked),
    dayStart: parseInt(cDayStart.value),
    dayEnd: parseInt(cDayEnd.value),
    eveStart: parseInt(cEveStart.value),
    eveEnd: parseInt(cEveEnd.value),
    rotation: cRotation.value,
    satEvery: parseInt(cSatEvery.value),
    satStart: parseInt(cSatStart.value),
    satEnd: parseInt(cSatEnd.value),
    sunEvery: parseInt(cSunEvery.value),
    sunStart: parseInt(cSunStart.value),
    sunEnd: parseInt(cSunEnd.value),
    adjustShift: cAdjustShift.value,
    adjustEnd: cAdjustEnd.value,
  });

  const fmtPct = v => v.toFixed(1).replace('.', ',') + '%';
  const preview = document.getElementById('suggest-preview');
  const updatePreview = () => {
    suggestParams = readParams();
    const p = suggestParams;
    const res = generateTurnusSuggestion(p);
    let html;
    if (p.mode === 'fulltid') {
      if (res.fullReached) {
        html = `<span class="ok">✓ Fulltid mulig:</span> forslaget gir <strong class="ok">${fmtPct(res.pct)}</strong> stilling.`;
      } else {
        html = `Fulltid er <span class="warn">ikke mulig</span> med de oppgitte tidene. ` +
               `Høyeste stilling blir <strong class="warn">${fmtPct(res.pct)}</strong> (deltid).`;
      }
    } else if (p.mode === 'none') {
      html = `Forslaget gir <strong>${fmtPct(res.pct)}</strong> stilling – tidene brukes som oppgitt.`;
    } else {
      const diff = Math.abs(res.pct - p.target);
      const cls = diff <= 1.5 ? 'ok' : 'warn';
      html = `Forslaget gir <strong class="${cls}">${fmtPct(res.pct)}</strong> (mål ${p.target}%) over ${p.numWeeks} uker.`;
    }
    if (res.adjusted && res.example) {
      const label = p.adjustShift === 'dag' ? 'Dagvakten' : 'Kveldsvakten';
      html += `<br>${label} er justert til <strong>${minutesToHHMM(res.example.start)}–${minutesToHHMM(res.example.end)}</strong>.`;
    }
    preview.innerHTML = html;
  };
  grid.querySelectorAll('select, input').forEach(el => {
    el.addEventListener('input', updatePreview);
    el.addEventListener('change', updatePreview);
  });
  updatePreview();

  const close = () => { backdrop.hidden = true; };
  document.getElementById('suggest-close').onclick = close;
  document.getElementById('suggest-cancel').onclick = close;
  document.getElementById('suggest-generate').onclick = () => {
    const res = generateTurnusSuggestion(readParams());
    const commit = () => {
      weeks = res.weeks;
      weekMeta = res.weekMeta;
      activeWeek = 0;
      close();
      scheduleSave();
      renderAll();
      toast(`Forslag laget · ${res.pct.toFixed(1).replace('.', ',')}% stilling`);
    };
    const hasExisting = weeks.some(w => w.some(d => d.length));
    if (hasExisting) {
      confirmDialog('Erstatte gjeldende turnus?',
        'Forslaget erstatter alle vaktene du har lagt inn nå.', commit,
        { danger: true, okLabel: 'Erstatt' });
    } else {
      commit();
    }
  };

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
  wireModalDismiss();
  document.getElementById('btn-suggest').addEventListener('click', openSuggestModal);
  document.getElementById('mobile-statbar').addEventListener('click', () => {
    document.getElementById('sticky-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
