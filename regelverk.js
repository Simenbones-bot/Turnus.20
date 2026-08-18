/* ==========================================================================
   regelverk.js – Avtale- og lovgrunnlag for turnusplanleggeren
   --------------------------------------------------------------------------
   Koder drøftingsresultatet mellom Posten Bring Varebil AS og Fagforbundet:

     [OK]    Overenskomst PBV – Fagforbundet, Del B (1.4.2026 – 31.3.2028)
     [SAML]  Særavtale S2 – gjennomsnittsberegning av alminnelig arbeidstid,
             for sjåfører underlagt arbeidsmiljøloven (fra 1.4.2026)
     [SFATS] Særavtale S2 – gjennomsnittsberegning av alminnelig arbeidstid,
             for sjåfører underlagt Forskrift om arbeidstid for sjåfører og
             andre innenfor vegtransport (fra 1.4.2026)

   Bakenforliggende regelverk som særavtalene bygger på:
     [AML]   Arbeidsmiljøloven kap. 10 (§ 10-5 hjemler gjennomsnittsberegning)
     [FSK]   Forskrift om arbeidstid for sjåfører mv. (FOR-2005-06-10-543)
     [KHT]   Kjøre- og hviletidsforordningen (EF) nr. 561/2006

   Motoren returnerer BÅDE avvik (funn) og en full kontrolliste (sjekker),
   slik at drøftingsnotatet kan dokumentere hva som faktisk er kontrollert.
   Turnusen behandles som SYKLISK: siste uke etterfølges av første uke igjen,
   slik en rullerende turnus faktisk går.
   ========================================================================== */

(function (global) {
  'use strict';

  // ---------- Grunnenheter ----------
  const DOGN = 24 * 60;
  const UKE = 7 * DOGN;
  const t = h => Math.round(h * 60);

  const DAG_KORT = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
  const DAG_NAVN = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

  const KILDE = {
    OK:    'Overenskomst PBV–Fagforbundet Del B',
    SAML:  'Særavtale S2 (AML)',
    SFATS: 'Særavtale S2 (FATS)',
    AML:   'Arbeidsmiljøloven kap. 10',
    FSK:   'Forskrift om arbeidstid for sjåfører (FOR-2005-06-10-543)',
    KHT:   'Kjøre- og hviletidsforordningen (EF) 561/2006',
  };

  // ---------- Tallverdiene fra drøftingene ----------
  const AVTALE = {
    versjon: 'S2 – gjeldende fra 01.04.2026',
    gjelderFra: '2026-04-01',
    overenskomstTil: '2028-03-31',

    felles: {
      ukeTimerFull: 37.5,            // OK pkt 4.1
      ukeTimerRedusert: 35.5,        // SAML pkt 2 (hver 3. søndag / hovedsakelig natt)
      maksGjennomsnittsUker: 16,     // SAML pkt 1 / SFATS pkt 1
      divisorFull: 1950,             // OK pkt 8.1.1
      divisorRedusert: 1850,         // OK pkt 8.1.1
    },

    aml: {
      maksPer24t: t(12.5),           // SAML pkt 4
      minFriPer24t: t(8),            // SAML pkt 5
      maksPer7d: t(54),              // SAML pkt 3, første ledd
      snittMaksPerUke: t(48),        // SAML pkt 3, andre ledd
      snittUker: 8,                  // SAML pkt 3, andre ledd
      ukefriMin: t(30),              // SAML pkt 6
      ukefriVindu: t(168),           // SAML pkt 6 ("i løpet av syv dager")
      sondagSnittUker: 26,           // SAML pkt 7
      sondagFridognHverNUke: 4,      // SAML pkt 7
      hverTredjeSondag: 1 / 3,       // SAML pkt 2
      dagvindu: [t(7), t(17)],       // OK pkt 4.2
      natt: [t(21), t(6)],           // AML § 10-11 (1)
      pauseGrense: t(5.5),           // AML § 10-9
      pauseLengde: 30,
    },

    fats: {
      maksPer24t: t(10),             // SFATS pkt 4
      maksPer7d: t(60),              // SFATS pkt 3
      forskriftPer24t: t(9),         // FSK § 8 (alminnelig arbeidstid)
      forskriftPer7d: t(40),         // FSK § 8 (alminnelig arbeidstid)
      maksUkerOverForskrift: 6,      // SFATS pkt 5
      nattTerskelPerDogn: t(3),      // SFATS pkt 6 ("mer enn 3 timer om natten")
      nattSnittMaksPer24t: t(8),     // SFATS pkt 6
      nattSnittUker: 4,              // SFATS pkt 7
      dognhvile: t(11),              // KHT art. 8 nr. 2
      dognhvileRedusert: t(9),       // KHT art. 8 nr. 4
      maksReduserteDognhviler: 3,    // KHT art. 8 nr. 6
      ukehvile: t(45),               // KHT art. 8 nr. 6
      ukehvileRedusert: t(24),       // KHT art. 8 nr. 6
      ukehvileVindu: t(144),         // KHT art. 8 nr. 6 (seks 24-timersperioder)
      // Nattperioden i vegtransport. Lovdata er ikke tilgjengelig fra dette
      // miljøet, så terskelen er lagt likt AML-praksis for nattarbeid, men
      // med 22.00 som start. Endres ett sted her dersom partene legger en
      // annen nattperiode til grunn.
      natt: [t(22), t(6)],
      pause6t: t(6), pause6tLengde: 30,   // FSK § 12
      pause9t: t(9), pause9tLengde: 45,   // FSK § 12
    },
  };

  // ==========================================================================
  // Pauser – trekkes fra fordi spise-/hvilepauser over 15 min for sjåfører
  // ikke regnes som arbeidstid, jf. OK pkt 4.1.
  // ==========================================================================
  function pause(bruttoMin, regime) {
    if (regime === 'FATS') {
      if (bruttoMin > AVTALE.fats.pause9t) return AVTALE.fats.pause9tLengde;
      if (bruttoMin >= AVTALE.fats.pause6t) return AVTALE.fats.pause6tLengde;
      return 0;
    }
    return bruttoMin > AVTALE.aml.pauseGrense ? AVTALE.aml.pauseLengde : 0;
  }

  // ==========================================================================
  // Dato- og helligdagshjelpere
  // ==========================================================================
  function isoUkeTilMandag(uke, aar) {
    const simple = new Date(Date.UTC(aar, 0, 1 + (uke - 1) * 7));
    const dow = simple.getUTCDay();
    const isoDay = dow === 0 ? 7 : dow;
    const mandag = new Date(simple);
    mandag.setUTCDate(simple.getUTCDate() - isoDay + 1);
    return mandag;
  }
  function isoDato(d) {
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }
  function datoForDag(weekMeta, wi, di) {
    const wm = weekMeta[wi];
    if (!wm) return null;
    const mandag = isoUkeTilMandag(wm.num, wm.year);
    const d = new Date(mandag);
    d.setUTCDate(mandag.getUTCDate() + di);
    return d;
  }

  // 1. påskedag (Meeus/Jones/Butcher)
  function paskedag(aar) {
    const a = aar % 19, b = Math.floor(aar / 100), c = aar % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mnd = Math.floor((h + l - 7 * m + 114) / 31);
    const dag = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(aar, mnd - 1, dag));
  }

  const _helligCache = new Map();
  function byggHelligdager(aar) {
    const p = paskedag(aar);
    const off = (base, n) => { const x = new Date(base); x.setUTCDate(base.getUTCDate() + n); return x; };
    const kart = new Map();
    const add = (dt, navn, type) => kart.set(isoDato(dt), { navn, type });
    // OK pkt 4.3 / 7.1.3 – skal være fridager, arbeid gir 100 % tillegg
    add(new Date(Date.UTC(aar, 0, 1)), '1. nyttårsdag', 'helligdag');
    add(off(p, -3), 'Skjærtorsdag', 'helligdag');
    add(off(p, -2), 'Langfredag', 'helligdag');
    add(p, '1. påskedag', 'helligdag');
    add(off(p, 1), '2. påskedag', 'helligdag');
    add(new Date(Date.UTC(aar, 4, 1)), '1. mai', 'helligdag');
    add(new Date(Date.UTC(aar, 4, 17)), '17. mai', 'helligdag');
    add(off(p, 39), 'Kristi himmelfartsdag', 'helligdag');
    add(off(p, 49), '1. pinsedag', 'helligdag');
    add(off(p, 50), '2. pinsedag', 'helligdag');
    add(new Date(Date.UTC(aar, 11, 25)), '1. juledag', 'helligdag');
    add(new Date(Date.UTC(aar, 11, 26)), '2. juledag', 'helligdag');
    // OK pkt 4.3 – regnes som hel dag selv om arbeidet ordinært slutter 13.00
    add(off(p, -4), 'Onsdag før skjærtorsdag', 'halvdag');
    add(off(p, -1), 'Påskeaften', 'halvdag');
    add(off(p, 48), 'Pinseaften', 'halvdag');
    add(new Date(Date.UTC(aar, 11, 24)), 'Julaften', 'halvdag');
    add(new Date(Date.UTC(aar, 11, 31)), 'Nyttårsaften', 'halvdag');
    return kart;
  }
  function helligdagFor(dato) {
    if (!dato) return null;
    const aar = dato.getUTCFullYear();
    if (!_helligCache.has(aar)) _helligCache.set(aar, byggHelligdager(aar));
    return _helligCache.get(aar).get(isoDato(dato)) || null;
  }

  // ==========================================================================
  // Små formathjelpere
  // ==========================================================================
  function timer(min) { return (min / 60).toFixed(1).replace('.', ','); }
  function timer2(min) { return (min / 60).toFixed(2).replace('.', ','); }
  function klokke(min) {
    const m = ((min % DOGN) + DOGN) % DOGN;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  // ==========================================================================
  // Byggeklosser
  // ==========================================================================
  // Tilgjengelighetstid regnes ikke som arbeidstid for yrkessjåfører, men den er
  // heller ikke hvile. Vakten får derfor to representasjoner: hele spennet
  // (start–slutt) for hvilekontrollene, og arbeidsintervallene (spennet minus
  // tilgjengelighetsperiodene) for arbeidstidskontrollene.
  function byggVakter(weeks, regime) {
    const ut = [];
    weeks.forEach((uke, wi) => (uke || []).forEach((dag, di) => (dag || []).forEach((s, si) => {
      const brutto = s.end - s.start;
      if (brutto <= 0) return;
      const base = (wi * 7 + di) * DOGN;
      const p = pause(brutto, regime);

      // Tilgjengelighetstid gjelder bare FATS-regimet
      const tilgjPerioder = (regime === 'FATS' && Array.isArray(s.availability) ? s.availability : [])
        .map(a => ({ start: Math.max(s.start, a.start), slutt: Math.min(s.end, a.end) }))
        .filter(a => a.slutt > a.start)
        .sort((a, b) => a.start - b.start);
      const tilgj = tilgjPerioder.reduce((sum, a) => sum + (a.slutt - a.start), 0);

      // Arbeidsintervaller = vaktens spenn minus tilgjengelighetsperiodene
      const intervaller = [];
      let markor = s.start;
      tilgjPerioder.forEach(a => {
        if (a.start > markor) intervaller.push({ start: base + markor, slutt: base + a.start });
        markor = Math.max(markor, a.slutt);
      });
      if (s.end > markor) intervaller.push({ start: base + markor, slutt: base + s.end });

      const arbeidsspenn = intervaller.reduce((sum, i) => sum + (i.slutt - i.start), 0);
      const netto = Math.max(0, brutto - p - tilgj);
      ut.push({
        wi, di, si, key: wi + '-' + di + '-' + si,
        start: base + s.start,
        slutt: base + s.end,
        lokalStart: s.start, lokalSlutt: s.end,
        brutto, pause: p, tilgjengelighet: tilgj, netto,
        intervaller,
        tetthet: arbeidsspenn ? netto / arbeidsspenn : 0,
      });
    })));
    ut.sort((a, b) => a.start - b.start);
    return ut;
  }

  function utvid(vakter, planLengde, reps) {
    const ut = [];
    for (let r = 0; r < reps; r++) {
      for (const v of vakter) {
        ut.push(Object.assign({}, v, {
          start: v.start + r * planLengde,
          slutt: v.slutt + r * planLengde,
          intervaller: v.intervaller.map(i => ({ start: i.start + r * planLengde, slutt: i.slutt + r * planLengde })),
        }));
      }
    }
    ut.sort((a, b) => a.start - b.start);
    return ut;
  }

  // Netto arbeidstid fordeles jevnt over vaktens lengde når et vindu deler
  // vakten. Pausen ligger et sted inne i vakten, så dette er den nøytrale
  // fordelingen mellom to vinduer.
  function arbeidIVindu(vakter, a, b) {
    let sum = 0;
    for (const v of vakter) {
      if (v.slutt <= a) continue;
      if (v.start >= b) break;
      for (const iv of v.intervaller) {
        const lo = Math.max(a, iv.start), hi = Math.min(b, iv.slutt);
        if (hi > lo) sum += (hi - lo) * v.tetthet;
      }
    }
    return sum;
  }

  // Største arbeidsmengde i et glidende vindu, over én full syklus av
  // vindusposisjoner. Maksimum ligger alltid i et knekkpunkt: vindusstart på
  // en vaktstart, eller vindusslutt på en vaktslutt.
  function maksIVindu(vakter, planLengde, lengde, fra, til) {
    const lo = typeof fra === 'number' ? fra : 0;
    const hi = typeof til === 'number' ? til : planLengde;
    const kandidater = new Set();
    for (const v of vakter) {
      for (const iv of v.intervaller) { kandidater.add(iv.start); kandidater.add(iv.slutt - lengde); }
    }
    let best = { sum: 0, start: lo };
    kandidater.forEach(c => {
      if (c < lo || c >= hi) return;
      const s = arbeidIVindu(vakter, c, c + lengde);
      if (s > best.sum) best = { sum: s, start: c };
    });
    return best;
  }

  function arbeidsblokker(vakter) {
    const bl = [];
    for (const v of vakter) {
      const siste = bl[bl.length - 1];
      if (siste && v.start <= siste.slutt) siste.slutt = Math.max(siste.slutt, v.slutt);
      else bl.push({ start: v.start, slutt: v.slutt });
    }
    return bl;
  }

  function nattOverlapp(start, slutt, vindu) {
    const [a, b] = vindu;
    const bEff = b <= a ? b + DOGN : b;
    let sum = 0;
    for (let d = Math.floor(start / DOGN) - 1; d <= Math.floor(slutt / DOGN) + 1; d++) {
      const ns = d * DOGN + a, ne = d * DOGN + bEff;
      sum += Math.max(0, Math.min(slutt, ne) - Math.max(start, ns));
    }
    return sum;
  }

  function dagvinduOverlapp(start, slutt, vindu) {
    const [a, b] = vindu;
    let sum = 0;
    for (let d = Math.floor(start / DOGN) - 1; d <= Math.floor(slutt / DOGN) + 1; d++) {
      sum += Math.max(0, Math.min(slutt, d * DOGN + b) - Math.max(start, d * DOGN + a));
    }
    return sum;
  }

  // Reduserte døgnhviler (9–11 t) telles kronologisk og nullstilles av en
  // ukehvile på 45 t, jf. KHT art. 8 nr. 6: maks tre mellom to ukehviler.
  // Første syklus brukes bare til å varme opp telleren, slik at tallet blir
  // riktig også for en rullerende turnus.
  function tellReduserteDognhviler(alleGap, utvidet, planLengde, A) {
    const kart = {};
    let teller = 0, totalt = 0, brutt = 0, maks = 0;
    alleGap.forEach(g => {
      if (g.lengde >= A.ukehvile) { teller = 0; return; }
      if (g.lengde < A.dognhvileRedusert || g.lengde >= A.dognhvile) return;
      teller += 1;
      if (g.start < planLengde || g.start >= 2 * planLengde) return;
      const brudd = teller > A.maksReduserteDognhviler;
      totalt += 1;
      if (brudd) brutt += 1;
      if (teller > maks) maks = teller;
      utvidet.filter(v => v.start === g.slutt).forEach(v => {
        kart[v.key] = { n: teller, gapMin: g.lengde, brudd };
      });
    });
    // maks = høyeste antall mellom to ukehviler i rotasjonen; det er tallet
    // som forteller om grensen på tre faktisk holder.
    return { kart, oppsummering: { totalt, brutt, maks } };
  }

  // ==========================================================================
  // Hovedanalyse
  // ==========================================================================
  function analyser(input) {
    const weeks = (input && input.weeks) || [];
    const weekMeta = (input && input.weekMeta) || [];
    const regime = (input && input.regime) === 'FATS' ? 'FATS' : 'AML';
    const A = regime === 'FATS' ? AVTALE.fats : AVTALE.aml;

    const N = weeks.length;
    const antallDager = Math.max(N, 1) * 7;
    const planLengde = Math.max(N, 1) * UKE;

    const vakter = byggVakter(weeks, regime);
    const funn = [];
    const sjekker = [];
    const vaktFlagg = {};
    const ukeFlagg = {};
    let reduserteHviler = {};
    let reduserteOppsummering = { totalt: 0, brutt: 0, maks: 0 };

    const ukeNavn = wi => {
      const wm = weekMeta[wi];
      return wm ? 'Uke ' + wm.num : 'Uke ' + (wi + 1);
    };
    const absLabel = abs => {
      const norm = ((abs % planLengde) + planLengde) % planLengde;
      const dagAbs = Math.floor(norm / DOGN);
      return ukeNavn(Math.floor(dagAbs / 7)) + ' ' + DAG_KORT[dagAbs % 7] + ' kl. ' + klokke(norm);
    };
    const ukeFor = abs => {
      const norm = ((abs % planLengde) + planLengde) % planLengde;
      return Math.floor(norm / UKE);
    };

    function leggTil(f) {
      funn.push(f);
      const rang = { brudd: 3, advarsel: 2, info: 1 };
      (f.vakter || []).forEach(k => {
        if (!vaktFlagg[k] || rang[f.niva] > rang[vaktFlagg[k]]) vaktFlagg[k] = f.niva;
      });
      if (typeof f.uke === 'number' && f.niva !== 'info') {
        if (!ukeFlagg[f.uke] || rang[f.niva] > rang[ukeFlagg[f.uke]]) ukeFlagg[f.uke] = f.niva;
      }
    }
    function sjekk(s) { sjekker.push(s); }

    // ---------- Grunnlagstall ----------
    const sumNetto = vakter.reduce((a, v) => a + v.netto, 0);
    const sumBrutto = vakter.reduce((a, v) => a + v.brutto, 0);
    const snittUke = N ? sumNetto / N : 0;

    // Arbeid og nattarbeid fordelt på kalenderdøgn (syklisk)
    const dagArbeid = new Array(antallDager).fill(0);
    const dagNatt = new Array(antallDager).fill(0);
    const dagVakter = Array.from({ length: antallDager }, () => []);
    vakter.forEach(v => {
      v.intervaller.forEach(iv => {
        for (let d = Math.floor(iv.start / DOGN); d <= Math.floor((iv.slutt - 1) / DOGN); d++) {
          const lo = Math.max(iv.start, d * DOGN), hi = Math.min(iv.slutt, (d + 1) * DOGN);
          if (hi <= lo) continue;
          const idx = ((d % antallDager) + antallDager) % antallDager;
          dagArbeid[idx] += (hi - lo) * v.tetthet;
          dagNatt[idx] += nattOverlapp(lo, hi, A.natt);
          if (dagVakter[idx].indexOf(v.key) === -1) dagVakter[idx].push(v.key);
        }
      });
    });

    const nattMinutter = vakter.reduce((a, v) =>
      a + v.intervaller.reduce((b, iv) => b + nattOverlapp(iv.start, iv.slutt, A.natt), 0), 0);
    const arbeidsspennTotalt = vakter.reduce((a, v) =>
      a + v.intervaller.reduce((b, iv) => b + (iv.slutt - iv.start), 0), 0);
    const nattAndel = arbeidsspennTotalt ? nattMinutter / arbeidsspennTotalt : 0;
    const hovedsakeligNatt = nattAndel > 0.5;

    // Søn- og helligdager i rotasjonen
    let antallSondager = 0, arbeidetSondager = 0;
    const fridognPaSondag = [];   // ukeindeks der et helt søn-/helligdøgn er fritt
    for (let d = 0; d < antallDager; d++) {
      const wi = Math.floor(d / 7), di = d % 7;
      const dato = datoForDag(weekMeta, wi, di);
      const hd = helligdagFor(dato);
      const erSondag = di === 6 || (hd && hd.type === 'helligdag');
      if (!erSondag) continue;
      antallSondager++;
      if (dagArbeid[d] > 0) arbeidetSondager++;
      else fridognPaSondag.push(wi);
    }
    const sondagsandel = antallSondager ? arbeidetSondager / antallSondager : 0;
    const hverTredjeSondag = sondagsandel >= AVTALE.aml.hverTredjeSondag - 1e-9;

    // SAML pkt 2: 35,5 t når det arbeides minst hver tredje søndag eller
    // arbeidet hovedsakelig drives om natten.
    const redusertBasis = regime === 'AML' && (hverTredjeSondag || hovedsakeligNatt);
    const basisTimer = redusertBasis ? AVTALE.felles.ukeTimerRedusert : AVTALE.felles.ukeTimerFull;
    const basisMin = t(basisTimer);
    const stillingsprosent = basisMin ? (snittUke / basisMin) * 100 : 0;
    const divisor = redusertBasis ? AVTALE.felles.divisorRedusert : AVTALE.felles.divisorFull;

    // Utvidet (syklisk) vaktliste for glidende vinduer
    const maksVindu = regime === 'FATS'
      ? Math.max(AVTALE.fats.nattSnittUker * UKE, AVTALE.fats.ukehvileVindu, UKE)
      : Math.max(AVTALE.aml.snittUker * UKE, AVTALE.aml.ukefriVindu, UKE);
    const reps = Math.ceil((planLengde + maksVindu) / planLengde) + 1;
    const utvidet = vakter.length ? utvid(vakter, planLengde, reps) : [];
    const blokker = arbeidsblokker(utvidet);

    // Arbeidsfrie perioder (gap) – hele lista og én syklus av dem
    const alleGap = [];
    for (let i = 1; i < blokker.length; i++) {
      const lengde = blokker[i].start - blokker[i - 1].slutt;
      if (lengde > 0) alleGap.push({ start: blokker[i - 1].slutt, slutt: blokker[i].start, lengde });
    }
    const syklusGap = alleGap.filter(g => g.start >= 0 && g.start < planLengde);
    const heleDognFritt = g => {
      const forste = Math.ceil(g.start / DOGN);
      return (forste + 1) * DOGN <= g.slutt;
    };

    const harVakter = vakter.length > 0;
    const na = (id, navn, hjemmel, notat) =>
      sjekk({ id, navn, hjemmel, status: 'na', verdi: notat || 'Ingen vakter lagt inn', grense: '' });

    // ======================================================================
    // FELLES 1 – Overlappende vakter (datakvalitet)
    // ======================================================================
    let overlapp = 0;
    for (let i = 1; i < vakter.length; i++) {
      if (vakter[i].start < vakter[i - 1].slutt) {
        overlapp++;
        leggTil({
          niva: 'brudd', id: 'overlapp',
          tittel: 'Overlappende vakter',
          tekst: `${absLabel(vakter[i].start)} starter før forrige vakt er ferdig (${absLabel(vakter[i - 1].slutt)}).`,
          hjemmel: 'Turnusteknisk – vakter kan ikke overlappe',
          uke: vakter[i].wi, vakter: [vakter[i].key, vakter[i - 1].key],
        });
      }
    }
    sjekk({
      id: 'overlapp', navn: 'Ingen overlappende vakter', hjemmel: 'Turnusteknisk',
      status: !harVakter ? 'na' : (overlapp ? 'brudd' : 'ok'),
      verdi: overlapp ? overlapp + ' overlapp' : 'Ingen overlapp', grense: '0',
    });

    // ======================================================================
    // FELLES 2 – Lengde på gjennomsnittsperioden
    // ======================================================================
    const maksUker = AVTALE.felles.maksGjennomsnittsUker;
    const periodeHjemmel = regime === 'FATS'
      ? KILDE.SFATS + ' pkt. 1' : KILDE.SAML + ' pkt. 1 og 8';
    if (N > maksUker) {
      leggTil({
        niva: 'brudd', id: 'periode',
        tittel: 'Gjennomsnittsperioden er for lang',
        tekst: `Turnusen går over ${N} uker. Alminnelig arbeidstid kan gjennomsnittsberegnes over inntil ${maksUker} uker.` +
               (regime === 'AML' ? ' Behov utover dette må avtales mellom partene sentralt i selskapet (pkt. 8).' : ''),
        hjemmel: periodeHjemmel,
      });
    }
    sjekk({
      id: 'periode', navn: 'Gjennomsnittsperiode', hjemmel: periodeHjemmel,
      status: N > maksUker ? 'brudd' : 'ok',
      verdi: N + ' uker', grense: 'maks ' + maksUker + ' uker',
    });

    // ======================================================================
    // FELLES 3 – Gjennomsnittlig ukentlig arbeidstid
    // ======================================================================
    const snittHjemmel = (regime === 'FATS' ? KILDE.SFATS + ' pkt. 2' : KILDE.SAML + ' pkt. 2') + ' / ' + KILDE.OK + ' pkt. 4.1';
    if (harVakter && snittUke > basisMin + 0.5) {
      leggTil({
        niva: 'brudd', id: 'snitt',
        tittel: 'Snittet overstiger avtalt ukentlig arbeidstid',
        tekst: `Gjennomsnittet er ${timer2(snittUke)} t/uke over ${N} uker. Grensen er ${String(basisTimer).replace('.', ',')} t/uke` +
               (redusertBasis
                 ? ` fordi det ${hverTredjeSondag ? 'arbeides minst hver tredje søndag' : 'arbeides hovedsakelig om natten'}.`
                 : '.'),
        hjemmel: snittHjemmel,
      });
    }
    sjekk({
      id: 'snitt', navn: 'Gjennomsnittlig ukentlig arbeidstid', hjemmel: snittHjemmel,
      status: !harVakter ? 'na' : (snittUke > basisMin + 0.5 ? 'brudd' : 'ok'),
      verdi: timer2(snittUke) + ' t/uke', grense: 'maks ' + String(basisTimer).replace('.', ',') + ' t/uke',
    });

    // ======================================================================
    // AML-regimet
    // ======================================================================
    if (regime === 'AML') {
      // --- SAML pkt 4: maks 12,5 t alminnelig arbeidstid i løpet av 24 timer
      const maks24 = harVakter ? maksIVindu(utvidet, planLengde, DOGN) : { sum: 0, start: 0 };
      if (maks24.sum > A.maksPer24t + 0.5) {
        const treff = vakter.filter(v => v.slutt > maks24.start && v.start < maks24.start + DOGN).map(v => v.key);
        leggTil({
          niva: 'brudd', id: 'dogn125',
          tittel: 'Over 12,5 timer i løpet av 24 timer',
          tekst: `${timer2(maks24.sum)} t arbeid i døgnet som starter ${absLabel(maks24.start)}.`,
          hjemmel: KILDE.SAML + ' pkt. 4', uke: ukeFor(maks24.start), vakter: treff,
        });
      }
      sjekk({
        id: 'dogn125', navn: 'Alminnelig arbeidstid per 24 timer', hjemmel: KILDE.SAML + ' pkt. 4',
        status: !harVakter ? 'na' : (maks24.sum > A.maksPer24t + 0.5 ? 'brudd' : 'ok'),
        verdi: timer2(maks24.sum) + ' t', grense: 'maks 12,5 t',
      });

      // --- SAML pkt 3: maks 54 t i løpet av syv dager
      const maks7d = harVakter ? maksIVindu(utvidet, planLengde, UKE) : { sum: 0, start: 0 };
      if (maks7d.sum > A.maksPer7d + 0.5) {
        leggTil({
          niva: 'brudd', id: 'uke54',
          tittel: 'Over 54 timer i løpet av syv dager',
          tekst: `${timer2(maks7d.sum)} t i sjudagersperioden fra ${absLabel(maks7d.start)}.`,
          hjemmel: KILDE.SAML + ' pkt. 3', uke: ukeFor(maks7d.start),
        });
      }
      sjekk({
        id: 'uke54', navn: 'Arbeidstid per 7 dager', hjemmel: KILDE.SAML + ' pkt. 3',
        status: !harVakter ? 'na' : (maks7d.sum > A.maksPer7d + 0.5 ? 'brudd' : 'ok'),
        verdi: timer2(maks7d.sum) + ' t', grense: 'maks 54 t',
      });

      // --- SAML pkt 3: snitt maks 48 t over 8 uker
      const vindu8 = A.snittUker * UKE;
      const maks8u = harVakter ? maksIVindu(utvidet, planLengde, vindu8) : { sum: 0, start: 0 };
      const snitt8 = maks8u.sum / A.snittUker;
      if (snitt8 > A.snittMaksPerUke + 0.5) {
        leggTil({
          niva: 'brudd', id: 'snitt48',
          tittel: 'Over 48 timer i snitt over åtte uker',
          tekst: `${timer2(snitt8)} t/uke i snitt i åtteukersperioden fra ${absLabel(maks8u.start)}.`,
          hjemmel: KILDE.SAML + ' pkt. 3', uke: ukeFor(maks8u.start),
        });
      }
      sjekk({
        id: 'snitt48', navn: 'Snitt over 8 uker', hjemmel: KILDE.SAML + ' pkt. 3',
        status: !harVakter ? 'na' : (snitt8 > A.snittMaksPerUke + 0.5 ? 'brudd' : 'ok'),
        verdi: timer2(snitt8) + ' t/uke', grense: 'maks 48 t/uke',
      });

      // --- SAML pkt 5: minst 8 t sammenhengende fri i løpet av 24 timer
      let minFri = Infinity, minFriGap = null;
      syklusGap.forEach(g => { if (g.lengde < minFri) { minFri = g.lengde; minFriGap = g; } });
      if (minFriGap && minFri < A.minFriPer24t) {
        syklusGap.filter(g => g.lengde < A.minFriPer24t).forEach(g => {
          const etter = utvidet.filter(v => v.start === g.slutt).map(v => v.key);
          leggTil({
            niva: 'brudd', id: 'fri8',
            tittel: 'Under 8 timer sammenhengende fri',
            tekst: `Kun ${timer(g.lengde)} t fri mellom ${absLabel(g.start)} og ${absLabel(g.slutt)}.`,
            hjemmel: KILDE.SAML + ' pkt. 5', uke: ukeFor(g.slutt), vakter: etter,
          });
        });
      }
      sjekk({
        id: 'fri8', navn: 'Sammenhengende fri per 24 timer', hjemmel: KILDE.SAML + ' pkt. 5',
        status: !harVakter || !syklusGap.length ? 'na' : (minFri < A.minFriPer24t ? 'brudd' : 'ok'),
        verdi: isFinite(minFri) ? timer(minFri) + ' t (korteste)' : '–', grense: 'minst 8 t',
      });

      // --- SAML pkt 6: 30 t sammenhengende arbeidsfri inkl. helt kalenderdøgn per 7 dager
      const ukefrier = alleGap.filter(g => g.lengde >= A.ukefriMin && heleDognFritt(g));
      let ukefriStatus = 'ok', ukefriVerdi = '–';
      if (!harVakter) {
        ukefriStatus = 'na';
      } else if (!ukefrier.length) {
        ukefriStatus = 'brudd';
        ukefriVerdi = 'Ingen kvalifiserende ukefri';
        leggTil({
          niva: 'brudd', id: 'ukefri30',
          tittel: 'Mangler ukentlig arbeidsfri periode',
          tekst: 'Turnusen har ingen sammenhengende arbeidsfri periode på 30 timer som inneholder et helt kalenderdøgn.',
          hjemmel: KILDE.SAML + ' pkt. 6',
        });
      } else {
        let verste = 0, versteGap = null;
        ukefrier.filter(g => g.start >= 0 && g.start < planLengde).forEach(g => {
          const neste = ukefrier.find(x => x.slutt > g.slutt);
          if (!neste) return;
          const avstand = neste.slutt - g.slutt;
          if (avstand > verste) { verste = avstand; versteGap = { fra: g, til: neste }; }
        });
        ukefriVerdi = verste ? timer(verste) + ' t mellom ukefriene' : timer(ukefrier[0].lengde) + ' t';
        if (verste > A.ukefriVindu + 0.5) {
          ukefriStatus = 'brudd';
          leggTil({
            niva: 'brudd', id: 'ukefri30',
            tittel: 'For lenge mellom de ukentlige fridøgnene',
            tekst: `Det går ${timer(verste)} t fra ukefrien som slutter ${absLabel(versteGap.fra.slutt)} til neste ukefri slutter. Grensen er 168 t (syv dager).`,
            hjemmel: KILDE.SAML + ' pkt. 6', uke: ukeFor(versteGap.fra.slutt),
          });
        }
      }
      sjekk({
        id: 'ukefri30', navn: 'Ukentlig arbeidsfri (30 t + helt kalenderdøgn)', hjemmel: KILDE.SAML + ' pkt. 6',
        status: ukefriStatus, verdi: ukefriVerdi, grense: 'minst hver 7. dag',
      });

      // --- SAML pkt 7: fri annenhver søn-/helligdag i snitt, og fridøgn på
      //     søn-/helligdag minst hver fjerde uke
      let sondagStatus = 'ok';
      let sondagVerdi = antallSondager
        ? `${arbeidetSondager} av ${antallSondager} søn-/helligdager i arbeid`
        : 'Ingen søn-/helligdager i rotasjonen';
      if (!harVakter || !antallSondager) {
        sondagStatus = 'na';
      } else {
        if (sondagsandel > 0.5 + 1e-9) {
          sondagStatus = 'brudd';
          leggTil({
            niva: 'brudd', id: 'sondag',
            tittel: 'For få frie søn- og helligdager',
            tekst: `Det arbeides ${arbeidetSondager} av ${antallSondager} søn-/helligdager (${Math.round(sondagsandel * 100)} %). Avtalen gir fri annenhver søn- og helligdag i gjennomsnitt over 26 uker.`,
            hjemmel: KILDE.SAML + ' pkt. 7',
          });
        }
        // Fridøgn på søn-/helligdag minst hver fjerde uke (syklisk)
        if (!fridognPaSondag.length) {
          sondagStatus = 'brudd';
          leggTil({
            niva: 'brudd', id: 'sondag-4uke',
            tittel: 'Fridøgnet faller aldri på søn- eller helligdag',
            tekst: 'Det ukentlige fridøgnet skal falle på en søn- eller helligdag minst hver fjerde uke.',
            hjemmel: KILDE.SAML + ' pkt. 7',
          });
        } else if (N > 0) {
          const sortert = fridognPaSondag.slice().sort((a, b) => a - b);
          let versteAvstand = 0, versteFra = null;
          for (let i = 0; i < sortert.length; i++) {
            const neste = i + 1 < sortert.length ? sortert[i + 1] : sortert[0] + N;
            const avstand = neste - sortert[i];
            if (avstand > versteAvstand) { versteAvstand = avstand; versteFra = sortert[i]; }
          }
          if (versteAvstand > AVTALE.aml.sondagFridognHverNUke) {
            sondagStatus = 'brudd';
            leggTil({
              niva: 'brudd', id: 'sondag-4uke',
              tittel: 'For lenge mellom fridøgn på søn-/helligdag',
              tekst: `Det går ${versteAvstand} uker fra fridøgnet på søn-/helligdag i ${ukeNavn(versteFra)} til neste. Grensen er hver fjerde uke.`,
              hjemmel: KILDE.SAML + ' pkt. 7', uke: versteFra,
            });
          }
          sondagVerdi += ` · lengste opphold ${versteAvstand} uker`;
        }
      }
      sjekk({
        id: 'sondag', navn: 'Søn- og helligdagsfri', hjemmel: KILDE.SAML + ' pkt. 7',
        status: sondagStatus, verdi: sondagVerdi, grense: 'fri annenhver + fridøgn hver 4. uke',
      });

      // --- OK pkt 4.2: alminnelig arbeidstid legges mellom 07.00 og 17.00
      let utenfor = 0;
      const utenforPerUke = new Array(Math.max(N, 1)).fill(0);
      vakter.forEach(v => {
        v.intervaller.forEach(iv => {
          const lengde = iv.slutt - iv.start;
          const ute = Math.max(0, lengde - dagvinduOverlapp(iv.start, iv.slutt, A.dagvindu));
          utenfor += ute;
          utenforPerUke[v.wi] += ute;
        });
      });
      if (utenfor > 0) {
        utenforPerUke.forEach((min, wi) => {
          if (min <= 0) return;
          leggTil({
            niva: 'advarsel', id: 'dagvindu',
            tittel: 'Arbeidstid utenfor 07.00–17.00',
            tekst: `${timer(min)} t i ${ukeNavn(wi)} ligger utenfor 07.00–17.00. Avtalt ramme for AML-sjåfører; tid utenfor utløser tillegg etter pkt. 7.1.1/7.1.2 og bør være omforent i drøftingen.`,
            hjemmel: KILDE.OK + ' pkt. 4.2', uke: wi,
          });
        });
      }
      sjekk({
        id: 'dagvindu', navn: 'Arbeidstid innenfor 07.00–17.00', hjemmel: KILDE.OK + ' pkt. 4.2',
        status: !harVakter ? 'na' : (utenfor > 0 ? 'advarsel' : 'ok'),
        verdi: timer(utenfor) + ' t utenfor', grense: '0 t utenfor',
      });
    }

    // ======================================================================
    // FATS-regimet
    // ======================================================================
    if (regime === 'FATS') {
      // --- SFATS pkt 4: maks 10 t alminnelig arbeidstid i løpet av 24 timer
      const maks24 = harVakter ? maksIVindu(utvidet, planLengde, DOGN) : { sum: 0, start: 0 };
      if (maks24.sum > A.maksPer24t + 0.5) {
        const treff = vakter.filter(v => v.slutt > maks24.start && v.start < maks24.start + DOGN).map(v => v.key);
        leggTil({
          niva: 'brudd', id: 'dogn10',
          tittel: 'Over 10 timer i løpet av 24 timer',
          tekst: `${timer2(maks24.sum)} t arbeid i døgnet som starter ${absLabel(maks24.start)}.`,
          hjemmel: KILDE.SFATS + ' pkt. 4', uke: ukeFor(maks24.start), vakter: treff,
        });
      }
      sjekk({
        id: 'dogn10', navn: 'Alminnelig arbeidstid per 24 timer', hjemmel: KILDE.SFATS + ' pkt. 4',
        status: !harVakter ? 'na' : (maks24.sum > A.maksPer24t + 0.5 ? 'brudd' : 'ok'),
        verdi: timer2(maks24.sum) + ' t', grense: 'maks 10 t',
      });

      // --- SFATS pkt 3: maks 60 t i løpet av 7 dager
      const maks7d = harVakter ? maksIVindu(utvidet, planLengde, UKE) : { sum: 0, start: 0 };
      if (maks7d.sum > A.maksPer7d + 0.5) {
        leggTil({
          niva: 'brudd', id: 'uke60',
          tittel: 'Over 60 timer i løpet av syv dager',
          tekst: `${timer2(maks7d.sum)} t i sjudagersperioden fra ${absLabel(maks7d.start)}.`,
          hjemmel: KILDE.SFATS + ' pkt. 3', uke: ukeFor(maks7d.start),
        });
      }
      sjekk({
        id: 'uke60', navn: 'Arbeidstid per 7 dager', hjemmel: KILDE.SFATS + ' pkt. 3',
        status: !harVakter ? 'na' : (maks7d.sum > A.maksPer7d + 0.5 ? 'brudd' : 'ok'),
        verdi: timer2(maks7d.sum) + ' t', grense: 'maks 60 t',
      });

      // --- SFATS pkt 5: lengre arbeidstid enn forskriftens § 8 i maks 6 uker på rad
      const overForskrift = [];
      for (let wi = 0; wi < N; wi++) {
        let ukeSum = 0;
        for (let di = 0; di < 7; di++) ukeSum += dagArbeid[wi * 7 + di];
        const dognMaks = harVakter
          ? maksIVindu(utvidet, planLengde, DOGN, wi * UKE, (wi + 1) * UKE)
          : { sum: 0 };
        overForskrift.push(ukeSum > A.forskriftPer7d + 0.5 || dognMaks.sum > A.forskriftPer24t + 0.5);
      }
      let maksRekke = 0, rekkeStart = null;
      if (N) {
        if (overForskrift.every(Boolean)) {
          maksRekke = Infinity; rekkeStart = 0;
        } else {
          for (let i = 0; i < N; i++) {
            if (!overForskrift[i]) continue;
            let len = 0;
            while (len < N && overForskrift[(i + len) % N]) len++;
            if (len > maksRekke) { maksRekke = len; rekkeStart = i; }
          }
        }
      }
      const rekkeBrudd = maksRekke > A.maksUkerOverForskrift;
      if (rekkeBrudd) {
        leggTil({
          niva: 'brudd', id: 'forskrift8',
          tittel: 'For mange uker på rad over forskriftens § 8',
          tekst: (maksRekke === Infinity
            ? 'Alle uker i rotasjonen ligger over forskriftens § 8 (40 t per 7 dager / 9 t per 24 t). I en rullerende turnus betyr det sammenhengende bruk uten opphold.'
            : `${maksRekke} uker på rad fra ${ukeNavn(rekkeStart)} ligger over forskriftens § 8 (40 t per 7 dager / 9 t per 24 t).`) +
            ' Avtalen tillater maks 6 uker i sammenheng.',
          hjemmel: KILDE.SFATS + ' pkt. 5, jf. ' + KILDE.FSK + ' § 8',
          uke: rekkeStart === null ? undefined : rekkeStart,
        });
      }
      sjekk({
        id: 'forskrift8', navn: 'Uker på rad over forskriftens § 8', hjemmel: KILDE.SFATS + ' pkt. 5',
        status: !harVakter ? 'na' : (rekkeBrudd ? 'brudd' : 'ok'),
        verdi: (maksRekke === Infinity ? 'alle uker' : maksRekke + ' uker'), grense: 'maks 6 uker',
      });

      // --- SFATS pkt 6 og 7: nattarbeid i snitt maks 8 t per 24 t over 4 uker
      const nattDogn = [];
      for (let d = 0; d < antallDager; d++) {
        if (dagNatt[d] > A.nattTerskelPerDogn + 1e-9) nattDogn.push(d);
      }
      let nattStatus = 'na', nattVerdi = 'Ingen døgn med mer enn 3 t nattarbeid', versteNatt = null;
      if (harVakter && nattDogn.length) {
        const vinduDager = A.nattSnittUker * 7;
        let verste = 0;
        for (let startDag = 0; startDag < antallDager; startDag++) {
          let sum = 0, ant = 0;
          for (let k = 0; k < vinduDager; k++) {
            const d = (startDag + k) % antallDager;
            if (dagNatt[d] > A.nattTerskelPerDogn + 1e-9) { sum += dagArbeid[d]; ant++; }
          }
          if (!ant) continue;
          const snitt = sum / ant;
          if (snitt > verste) { verste = snitt; versteNatt = startDag; }
        }
        nattVerdi = timer2(verste) + ' t per nattdøgn';
        nattStatus = verste > A.nattSnittMaksPer24t + 0.5 ? 'brudd' : 'ok';
        if (nattStatus === 'brudd') {
          leggTil({
            niva: 'brudd', id: 'natt8',
            tittel: 'Nattarbeid over 8 timer i snitt',
            tekst: `Døgn med mer enn 3 t nattarbeid har ${timer2(verste)} t arbeidstid i snitt i fireukersperioden fra ${ukeNavn(Math.floor(versteNatt / 7))} ${DAG_KORT[versteNatt % 7]}. Grensen er 8 t.`,
            hjemmel: KILDE.SFATS + ' pkt. 6 og 7, jf. ' + KILDE.FSK + ' § 9',
            uke: Math.floor(versteNatt / 7),
            vakter: nattDogn.reduce((acc, d) => acc.concat(dagVakter[d]), []),
          });
        }
      }
      sjekk({
        id: 'natt8', navn: 'Nattarbeid – snitt per 24 t (4 uker)', hjemmel: KILDE.SFATS + ' pkt. 6 og 7',
        status: nattStatus, verdi: nattVerdi, grense: 'maks 8 t',
      });

      // --- KHT art. 8: døgnhvile 11 t (redusert 9 t, maks 3 mellom ukehviler)
      let minHvile = Infinity;
      syklusGap.forEach(g => { if (g.lengde < minHvile) minHvile = g.lengde; });
      const korteHviler = syklusGap.filter(g => g.lengde < A.dognhvileRedusert);
      const telling = tellReduserteDognhviler(alleGap, utvidet, planLengde, A);
      reduserteHviler = telling.kart;
      reduserteOppsummering = telling.oppsummering;
      const reduserte = syklusGap.filter(g => g.lengde >= A.dognhvileRedusert && g.lengde < A.dognhvile);
      korteHviler.forEach(g => {
        leggTil({
          niva: 'brudd', id: 'dognhvile',
          tittel: 'Døgnhvile under 9 timer',
          tekst: `Kun ${timer(g.lengde)} t hvile mellom ${absLabel(g.start)} og ${absLabel(g.slutt)}.`,
          hjemmel: KILDE.KHT + ' art. 8', uke: ukeFor(g.slutt),
          vakter: utvidet.filter(v => v.start === g.slutt).map(v => v.key),
        });
      });
      reduserte.forEach(g => {
        const etter = utvidet.filter(v => v.start === g.slutt).map(v => v.key);
        const info = etter.length ? reduserteHviler[etter[0]] : null;
        const nr = info ? info.n : null;
        const forMange = !!(info && info.brudd);
        leggTil({
          niva: forMange ? 'brudd' : 'advarsel',
          id: forMange ? 'dognhvile-antall' : 'dognhvile-redusert',
          tittel: forMange
            ? 'For mange reduserte døgnhviler'
            : 'Redusert døgnhvile' + (nr ? ' ' + nr + '/' + A.maksReduserteDognhviler : ''),
          tekst: `${timer(g.lengde)} t hvile mellom ${absLabel(g.start)} og ${absLabel(g.slutt)}. ` +
            (forMange
              ? `Dette er den ${nr}. reduserte døgnhvilen siden forrige ukehvile – maks ${A.maksReduserteDognhviler} er tillatt.`
              : 'Redusert døgnhvile (9–11 t) kan brukes maks tre ganger mellom to ukehviler.'),
          hjemmel: KILDE.KHT + ' art. 8', uke: ukeFor(g.slutt), vakter: etter,
        });
      });
      sjekk({
        id: 'dognhvile', navn: 'Døgnhvile', hjemmel: KILDE.KHT + ' art. 8',
        status: !harVakter || !syklusGap.length ? 'na' : (korteHviler.length ? 'brudd' : (reduserte.length ? 'advarsel' : 'ok')),
        verdi: isFinite(minHvile) ? timer(minHvile) + ' t (korteste)' : '–',
        grense: 'minst 11 t (redusert 9 t)',
      });

      // --- KHT art. 8: ukehvile 45 t (redusert 24 t) innen seks døgn
      const ukehviler = alleGap.filter(g => g.lengde >= A.ukehvileRedusert);
      let ukehvileStatus = 'ok', ukehvileVerdi = '–';
      if (!harVakter) {
        ukehvileStatus = 'na';
      } else if (!ukehviler.length) {
        ukehvileStatus = 'brudd';
        ukehvileVerdi = 'Ingen ukehvile';
        leggTil({
          niva: 'brudd', id: 'ukehvile',
          tittel: 'Mangler ukehvile',
          tekst: 'Turnusen har ingen sammenhengende hvileperiode på minst 24 timer.',
          hjemmel: KILDE.KHT + ' art. 8',
        });
      } else {
        let verste = 0, versteFra = null;
        ukehviler.filter(g => g.start >= 0 && g.start < planLengde).forEach(g => {
          const neste = ukehviler.find(x => x.start > g.slutt);
          if (!neste) return;
          const avstand = neste.start - g.slutt;
          if (avstand > verste) { verste = avstand; versteFra = g; }
        });
        ukehvileVerdi = timer(verste) + ' t arbeidsperiode';
        if (verste > A.ukehvileVindu + 0.5) {
          ukehvileStatus = 'brudd';
          leggTil({
            niva: 'brudd', id: 'ukehvile',
            tittel: 'For lenge mellom ukehvilene',
            tekst: `Det går ${timer(verste)} t fra ukehvilen som slutter ${absLabel(versteFra.slutt)} til neste ukehvile starter. Grensen er 144 t (seks døgn).`,
            hjemmel: KILDE.KHT + ' art. 8', uke: ukeFor(versteFra.slutt),
          });
        }
        const bareReduserte = ukehviler.every(g => g.lengde < A.ukehvile);
        if (ukehvileStatus === 'ok' && bareReduserte) {
          ukehvileStatus = 'advarsel';
          leggTil({
            niva: 'advarsel', id: 'ukehvile-redusert',
            tittel: 'Bare reduserte ukehviler',
            tekst: 'Alle ukehvilene i rotasjonen er under 45 timer. Redusert ukehvile må kompenseres med tilsvarende sammenhengende hvile innen utgangen av tredje uke.',
            hjemmel: KILDE.KHT + ' art. 8',
          });
        }
      }
      sjekk({
        id: 'ukehvile', navn: 'Ukehvile', hjemmel: KILDE.KHT + ' art. 8',
        status: ukehvileStatus, verdi: ukehvileVerdi, grense: 'minst hver 144. time',
      });
    }

    // ======================================================================
    // FELLES 4 – Søn- og helligdager (OK pkt 4.3 og 7.1.3)
    // ======================================================================
    let helligArbeid = 0;
    for (let d = 0; d < antallDager; d++) {
      if (dagArbeid[d] <= 0) continue;
      const wi = Math.floor(d / 7), di = d % 7;
      const hd = helligdagFor(datoForDag(weekMeta, wi, di));
      if (!hd) continue;
      if (hd.type === 'helligdag') {
        helligArbeid++;
        leggTil({
          niva: 'advarsel', id: 'helligdag',
          tittel: 'Arbeid på helligdag',
          tekst: `${DAG_NAVN[di]} i ${ukeNavn(wi)} er ${hd.navn} og skal være fridag. Arbeid gir 100 % tillegg på timelønn.`,
          hjemmel: KILDE.OK + ' pkt. 4.3 og 7.1.3', uke: wi, vakter: dagVakter[d],
        });
      } else {
        // Halvdag: 100 % tillegg for arbeid etter kl. 13.00
        const etter13 = vakter
          .filter(v => v.wi === wi && v.di === di)
          .reduce((a, v) => a + v.intervaller.reduce(
            (b, iv) => b + Math.max(0, iv.slutt - Math.max(iv.start, d * DOGN + t(13))), 0), 0);
        if (etter13 > 0) {
          helligArbeid++;
          leggTil({
            niva: 'advarsel', id: 'helligdag',
            tittel: 'Arbeid etter kl. 13.00 på ' + hd.navn.toLowerCase(),
            tekst: `${timer(etter13)} t etter kl. 13.00 i ${ukeNavn(wi)}. Dagen regnes som hel dag, og arbeid etter kl. 13.00 gir 100 % tillegg.`,
            hjemmel: KILDE.OK + ' pkt. 4.3 og 7.1.3', uke: wi, vakter: dagVakter[d],
          });
        }
      }
    }
    sjekk({
      id: 'helligdag', navn: 'Søn- og helligdager fri', hjemmel: KILDE.OK + ' pkt. 4.3',
      status: !harVakter ? 'na' : (helligArbeid ? 'advarsel' : 'ok'),
      verdi: helligArbeid ? helligArbeid + ' dag(er) med arbeid' : 'Ingen helligdagsarbeid',
      grense: 'skal være fridager',
    });

    // ======================================================================
    // FELLES 5 – Avtaleperiode og heltid
    // ======================================================================
    const forsteDato = datoForDag(weekMeta, 0, 0);
    if (forsteDato && isoDato(forsteDato) < AVTALE.gjelderFra) {
      leggTil({
        niva: 'info', id: 'ikrafttredelse',
        tittel: 'Turnusen starter før særavtalen gjelder',
        tekst: `Første uke starter ${isoDato(forsteDato)}. Særavtalene om gjennomsnittsberegning (S2) gjelder fra 01.04.2026.`,
        hjemmel: (regime === 'FATS' ? KILDE.SFATS : KILDE.SAML),
      });
    }
    if (harVakter && stillingsprosent < 99.5) {
      leggTil({
        niva: 'info', id: 'heltid',
        tittel: 'Turnusen er en deltidsstilling',
        tekst: `Stillingsprosenten er ${stillingsprosent.toFixed(1).replace('.', ',')} %. Arbeidsoppgavene skal så langt som mulig organiseres slik at det legges til rette for heltidsstillinger.`,
        hjemmel: KILDE.OK + ' pkt. 18',
      });
    }

    // ---------- Oppsummering ----------
    const brudd = funn.filter(f => f.niva === 'brudd');
    const advarsler = funn.filter(f => f.niva === 'advarsel');
    const infoer = funn.filter(f => f.niva === 'info');

    return {
      regime, funn, brudd, advarsler, infoer, sjekker, vaktFlagg, ukeFlagg,
      reduserteHviler, reduserteOppsummering,
      nokkeltall: {
        antallUker: N,
        sumNetto, sumBrutto, snittUke,
        basisTimer, basisMin, redusertBasis, divisor,
        stillingsprosent,
        nattAndel, hovedsakeligNatt,
        antallSondager, arbeidetSondager, sondagsandel, hverTredjeSondag,
      },
    };
  }

  const API = {
    AVTALE, KILDE, DAG_KORT, DAG_NAVN,
    analyser, pause, helligdagFor, isoUkeTilMandag, isoDato, datoForDag,
    timer, timer2, klokke,
  };

  global.Regelverk = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
