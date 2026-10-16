# Turnusgenerator – Drøftingsverktøy · Kravspesifikasjon

Oppsummert fra versjonen som er publisert på GitHub Pages (`gh-pages`, versjon 1.1, avtaleverk S2 fra 01.04.2026). Teknologinøytral, slik at den kan bygges på nytt i et annet format.

---

## 1. Formål

Et verktøy for avdelingsledere som skal:
1. Bygge en turnus (vakter per uke over én eller flere uker)
2. Kontrollere turnusen mot overenskomsten og særavtalene (AML eller FATS)
3. Beregne stillingsprosent
4. Lage et drøftingsnotat (PDF) med signaturlinjer til fagforbundet

Ingen innlogging og ingen backend. Alle data ligger lokalt hos brukeren.

---

## 2. Datamodell

| Felt | Innhold |
|---|---|
| `weeks` | Liste over uker → 7 dager (man–søn) → liste med vakter |
| Vakt | `{ start, end, availability[] }`: minutter fra midnatt. `end` kan være > 1440 når vakten går over midnatt. |
| `availability` | Liste med `{ start, end }`: tilgjengelighetsperioder inne i vakten (bare i FATS) |
| `weekMeta` | Per uke: `{ num, year }`. I rotasjonsmodus er `year = null` og uker nummereres 1, 2, 3 … |
| `activeWeek` | Indeks for uka som vises |
| `lastebil` | `true` = FATS-regimet, `false` = AML-regimet |
| `formData` | avdeling, avdelingsleder, typeTurnus, ikrafttredelsesdato, navn, antallSjaforer, aarsak, fagforbundetSyn, annenKommentar, epostTillitsvalgt, epostLeder, rullerende, lastebil |

**Standardverdier ved første oppstart:** avdeling «Bergen Distribusjon», leder «Ingrid Solheim», type «Personlig», ikrafttredelse = i dag + 14 dager, første uke = ISO-uka to uker frem i tid, én vakt mandag 07:00–15:00.

---

## 3. Layout

- Slank topplinje: «Turnusgenerator · Drøftingsverktøy»
- To kolonner: hovedinnhold til venstre (kort 1–3), og et fast (sticky) oppsummeringspanel til høyre (~320 px)
- Under 900 px: én kolonne, og panelet legger seg nederst uten å være sticky
- Under 768 px: tidslinjen kan leses, men ikke dras i. Redigering skjer i et modalvindu.
- Bunntekst med versjon og hvilken avtale den gjelder fra

### Designsystem
- Fonter: IBM Plex Sans (tekst), IBM Plex Mono (alle tall, klokkeslett, timer og prosenter)
- Farger: primær `#1a56db` · fare `#dc2626`/`#fee2e2` · varsel `#d97706`/`#fef3c7` · ok `#16a34a`/`#dcfce7` · bakgrunn `#f1f5f9` · kant `#cbd5e1` · tekst `#0f172a`/`#64748b`
- Vakttyper: Dag `#fde68a` · Kveld `#fdba74` · Natt `#c7d2fe` · Helg `#fbcfe8`
- Spacing bygger på 4 px. Kortene er hvite med avrundede hjørner (12 px).

---

## 4. Seksjon 1 – Informasjon

| Felt | Type | Merknad |
|---|---|---|
| Avdeling | tekst | obligatorisk |
| Avdelingsleder | tekst | obligatorisk |
| Type turnus | valg: Personlig / For flere sjåfører | obligatorisk |
| Ikrafttredelsesdato | dato | obligatorisk |
| Sjåfør / navn | tekst | vises bare ved Personlig |
| Antall sjåfører | tall ≥ 1 | vises bare ved Flere |
| E-post til tillitsvalgt | e-post | valgfritt, mottaker i e-posten |
| Avdelingsleders e-post | e-post | valgfritt |
| Rullerende turnus | bryter | slår på rotasjonsmodus (se 5.1) |
| Yrkessjåfør – FATS | bryter | På = FATS-regimet, Av = AML-regimet |
| Årsak til turnusendring | tekstfelt, 3 linjer | |
| Fagforbundets syn / forslag | tekstfelt, 3 linjer | |

Seksjonsnummeret blir grønt og får merket «✓ Komplett» når alle de fire obligatoriske feltene er fylt ut. Feilmeldinger vises som rød tekst under feltet.

---

## 5. Seksjon 2 – Vakter

### 5.1 Ukefaner
- Én fane per uke, og en «+»-knapp som legger til en ny, tom uke
- **Kalendermodus** (rullerende av): fanen viser «Uke 22 '26». Ny uke = neste ISO-uke, også over et årsskifte (52/53 uker).
- **Rotasjonsmodus** (rullerende på): fanene heter «Uke 1, 2, 3 …» uten år. Datoperioden regnes fra mandagen i uka der ikrafttredelsesdatoen ligger, pluss uke-indeks × 7.
- Dobbeltklikk på en fane åpner redigering av ukenummer (og år i kalendermodus). De følgende ukene nummereres om fortløpende.
- Hold musepekeren over en fane for å vise ×. Klikk på × ber om bekreftelse («Slette uke X?»). Den siste uka kan ikke slettes.
- Fanen blir rød ved brudd og får gul markering ved varsel.
- Under fanene vises datoperioden, f.eks. «25. – 31. mai 2026».

### 5.2 Tidslinje
- 7 rader (Man–Søn). Dagkolonnen er 72 px. Lørdag og søndag har rosa dagnavn.
- Tidsakse 00–23 med etikett hver time og et svakt rutenett
- Tider festes til nærmeste 15 minutter (snap). Korteste vakt er 15 minutter.
- **Vakter over midnatt** vises som to blokker: «start –» med ↪ på dagen vakten begynner, og en fortsettelse på dagen etter. En vakt fra søndag til mandag fortsetter på mandag i neste uke. Finnes ikke neste uke, opprettes den automatisk.
- Vaktblokk: avrundede hjørner (6 px) og skygge. Øverst står kategorien med en prikk (DAG/KVELD/NATT/HELG), under står «HH:MM – HH:MM». Begge kantene har et ⋮-håndtak (ew-resize), og midten har grab-markør.

**Mus (desktop):**
| Handling | Resultat |
|---|---|
| Dra på tom tidslinje | lager ny vakt (kan dras forbi midnatt) |
| Dra midt på vakt | flytter vakten i tid, og kan flytte den til en annen dag (forhåndsvisning i målraden) |
| Dra venstre/høyre kant | endrer start- eller sluttid |
| Slipp | snap til 15 min, rydd tilgjengelighetsperioder utenfor vakten, kjør regelkontroll, lagre |

**Knapper på vakten:**
- **↓ Kopier**: meny med «Kopier vakt» (til neste dag, eller til mandag i neste uke) og «Kopier alle hverdager» (man–fre)
- **⊕ Tilgjengelighetstid** (bare FATS): åpner et modalvindu for å legge til eller slette perioder inne i vakten. Periodene kan ikke overlappe hverandre, og de vises som skravering på blokken.
- **«9t»-merke** (bare FATS): redusert døgnhvile, nummerert 1/3, 2/3, 3/3. Merket blir rødt fra og med den fjerde.

**Mobil (< 768 px):** Trykk på en dag for å åpne et modalvindu med listen over vaktene den dagen (Rediger / Slett) og «+ Legg til ny vakt». Start og slutt velges i nedtrekkslister med 15-minuttersintervaller.

### 5.3 Vaktkategori (automatisk farge)
- Vakten får kategorien med flest overlappende minutter: DAG 06–18, KVELD 14–23, NATT 22–06 (over midnatt)
- Lørdag og søndag gir alltid HELG
- Vakter med brudd blir røde med hvit tekst og ⚠. Vakter med varsel får gul kant.

### 5.4 Detaljliste (aktiv uke)
- AML: Dag | Start | Slutt | Lunsj | Nettotid | ×
- FATS: Dag | Start | Slutt | Lunsj | Tilgjengelighet | Arbeidstid | Lønnstid | ×
- Med på lista er fortsettelsen av en vakt fra søndag i forrige uke («Søndag–Mandag»)
- Sumlinje for uka. Rader med brudd blir røde. × sletter vakten uten bekreftelse.

### 5.5 Pause og nettotid
| Regime | Regel |
|---|---|
| AML (AML § 10-9) | brutto > 5,5 t → 30 min |
| FATS (FSK § 12) | brutto ≥ 6 t → 30 min, brutto > 9 t → 45 min |

- Nettotid = brutto − pause
- Lønnstid / arbeidstid (FATS) = nettotid − tilgjengelighetstid
- For en vakt fra søndag til mandag fordeles brutto, pause og tilgjengelighet på de to ukene etter hvor mye av vakten som ligger på hver side av midnatt

---

## 6. Seksjon 3 – Annen kommentar
Tekstfelt «Notat» (4 linjer), merket «Synlig på drøftingsnotatet».

---

## 7. Oppsummeringspanel (høyre)

1. **Mørk topp:** «OPPSUMMERING» og «[Avdeling] · Rotasjon på X uker»
2. **Halvsirkel-måler (gauge)** for stillingsprosent, skala 0–130 %. Nålen og buen viser verdien. Fargen er grønn til og med 80 %, gul fra 80 % og rød over 100 % (da blir også tallet rødt).
   Stillingsprosent = (snitt nettotimer per uke ÷ beregningsgrunnlag) × 100
3. **Nøkkeltall (2×2):** Antall uker · Sum timer · Snitt/uke · Beregningsgrunnlag (37,5 eller 35,5 t/uke, med forklaring når det er 35,5)
4. **Regelkontroll-panel:**
   - Grønn kant uten avvik, gul ved varsler, rød ved brudd. Teller som f.eks. «2 brudd · 1 varsel».
   - Undertittel med regime og grunnlag, f.eks. «AML · beregningsgrunnlag 37,5 t/uke»
   - Liste over avvik med hjemmel. Klikk på et avvik hopper til uka det gjelder.
   - Teller for reduserte døgnhviler (FATS)
   - Utvidbar seksjon «Alle kontrollpunkter»: hele kontrollisten med målt verdi, grense og status, også punkter som er i orden
   - Kildetekst om hvilken avtale kontrollen bygger på
5. **Handlinger:**
   - «Last ned PDF»: deaktivert (grå) til de obligatoriske feltene er fylt ut og turnusen har minst én vakt. Hjelpetekst: «Fyll ut obligatoriske felt og legg til minst én vakt»
   - «Send på e-post» (samme deaktivering) og «Skriv ut» (utskrift fra nettleseren)
   - «Sist lagret kl. HH:MM · auto-lagret som utkast»
   - «🗑 Nullstill turnus»: tømmer alt etter bekreftelse

---

## 8. Regelkontroll (kjøres etter hver endring)

Alle grenseverdier ligger samlet ett sted (objektet `AVTALE`), slik at de kan endres uten å røre logikken.

**Avtalegrunnlag:** Overenskomst PBV–Fagforbundet Del B (1.4.2026–31.3.2028) · Særavtale S2 AML · Særavtale S2 FATS · AML kap. 10 · Forskrift om arbeidstid for sjåfører (FOR-2005-06-10-543) · Kjøre- og hviletidsforordningen 561/2006.

### Felles
| Kontroll | Grense |
|---|---|
| Overlappende vakter | ikke tillatt (brudd) |
| Gjennomsnittsperiode | maks 16 uker |
| Snitt ukentlig arbeidstid | 37,5 t (35,5 t, se under). Snitt over grensen er brudd. |
| Søn- og helligdager | skal være fri. Arbeid gir merknad om 100 % tillegg. |
| Heltid | merknad når stillingsprosenten er under 100 |

**35,5-timersgrunnlag (bare AML):** gjelder når det arbeides minst hver tredje søndag, eller når arbeidet hovedsakelig er nattarbeid. Divisor: 1950 t ved 37,5 og 1850 t ved 35,5.

**Helligdager** beregnes automatisk ut fra påskedag: 1. nyttårsdag, skjærtorsdag, langfredag, 1. og 2. påskedag, 1. mai, 17. mai, Kristi himmelfart, 1. og 2. pinsedag, 1. og 2. juledag. Disse regnes som hele dager selv om arbeidet ordinært slutter kl. 13 (OK 4.3): onsdag før skjærtorsdag, påskeaften, pinseaften, julaften og nyttårsaften.

### AML-regimet (S2 AML)
| Regel | Grense | Metode |
|---|---|---|
| Arbeid per 24 t | maks 12,5 t | glidende 24-timersvindu |
| Fri per 24 t | minst 8 t sammenhengende | korteste gap mellom vakter |
| Arbeid per 7 døgn | maks 54 t | glidende vindu |
| Snitt over 8 uker | maks 48 t/uke | glidende vindu |
| Ukentlig fri | 30 t sammenhengende, inkludert et helt kalenderdøgn, innen 168 t | avstand mellom kvalifiserende fri |
| Søn-/helligdager | fri annenhver i snitt over 26 uker (≤ 50 % med arbeid), og fri søn-/helligdag minst hver 4. uke | syklisk |
| Arbeidstid 07–17 | tid utenfor gir **varsel** (tillegg) | |
| Natt | 21–06 | |

### FATS-regimet (S2 FATS + forskrift + KHT)
| Regel | Grense |
|---|---|
| Arbeid per 24 t | maks 10 t |
| Arbeid per 7 døgn | maks 60 t |
| Over forskriftens § 8 (40 t/7 d eller 9 t/24 t) | maks 6 uker på rad |
| Døgn med > 3 t nattarbeid | snitt maks 8 t per 24 t, over 4 uker |
| Døgnhvile | 11 t. 9–11 t = redusert (varsel), under 9 t = brudd |
| Reduserte døgnhviler | maks 3 mellom to ukehviler (den 4. er brudd) |
| Ukehvile | 45 t (redusert 24 t) innen 144 t |
| Natt | 22–06 |
| Tilgjengelighetstid | trekkes fra arbeidstiden, men regnes ikke som hvile |

### Tolkningsvalg
1. Turnusen behandles alltid som **rullerende**: etter siste uke kommer første uke igjen, og alle vinduer beregnes syklisk. Dermed fanges brudd i overgangen og hvilen etter siste vakt.
2. Når et vindu deler en vakt, fordeles nettotiden jevnt over vaktens lengde.
3. Nattsnittet beregnes bare over døgn med mer enn 3 t nattarbeid.
4. Første rotasjonssyklus brukes bare til å «varme opp» telleren for reduserte hviler.

### Varsling
- Vakter, ukefaner og rader i detaljlista fargemerkes
- En toast vises når en endring fører til et **nytt** brudd. Nøkkelen er regel + uke, så samme brudd med ny tallverdi varsles ikke på nytt.
- Eksport med brudd må bekreftes i en dialog som lister opp de fire første bruddene. Eksporten stoppes ikke.

---

## 9. Drøftingsnotat (PDF)

A4 stående, marger på 16 mm. Filnavn: `Drøftingsnotat_[Avdeling]_[YYYY-MM-DD].pdf` (dagens dato).

1. **Blå topptekst:** «DRØFTINGSNOTAT – TURNUS», avdeling og leder
2. **Nøkkelinfo-kort:** type turnus, navn eller antall sjåfører, ikrafttredelse (DD.MM.YYYY), rullerende ja/nei, FATS ja/nei
3. **Stillingsprosent-kort:** prosent og stolpe (rød over 100 %)
4. **Én tabell per uke:** overskrift med uke og datoperiode (følger rotasjonsmodus), stripete rader og fargede typemerker
   - AML: Dag | Type | Start | Slutt | Lunsj | Nettotid
   - FATS: Dag | Start | Slutt | Lunsj | Tilgjeng. | Arbeidstid | Lønnstid
   - Fortsettelse fra forrige søndag med fotnote. Sumlinje «Sum uke». Ny side før tabellen dersom det er for lite plass igjen.
5. **«Regelkontroll mot avtaleverket»:** statusbanner, hele kontrollisten og alle avvik med hjemmel
6. **Tilleggsinformasjon:** Årsak · Fagforbundets syn · Annen kommentar
7. **Signaturbokser** nederst på siste side: Avdelingsleder + dato, og Tillitsvalgt / Fagforbundet + dato
8. **Bunntekst:** «Side X av Y» på hver side

### Send på e-post
1. Lag og last ned PDF-en (samme flyt som over, med bekreftelse ved brudd)
2. Vis modalvindu: «1. PDF-en er lastet ned. 2. E-postklienten åpnes nå. 3. Dra filen [filnavn] inn i e-posten.»
3. «OK, åpne e-post» åpner `mailto:` med
   - Til: e-post til tillitsvalgt
   - Emne: «Drøftingsnotat turnus – [Avdeling]»
   - Tekst: «Hei,\n\nVedlagt drøftingsnotat for turnusendring ved [Avdeling].\n\nMed vennlig hilsen\n[Avdelingsleder]»

---

## 10. Lagring
- Lagres automatisk lokalt (`localStorage`-nøkkel `turnus-draft`) 1 sekund etter siste endring: `{ weeks, weekMeta, activeWeek, lastebil, formData, savedAt }`
- Når siden åpnes og det finnes et utkast, vises et banner: «Vi fant et lagret utkast fra [tid]. [Gjenopprett] [Forkast]»
- Eldre utkast migreres ved innlasting (vakter uten `availability` får en tom liste)

## 11. Tekniske krav
- Ingen `alert()`. Bruk modalvinduer, inline-feil og toasts.
- Skal fungere uten byggesteg og uten server (statisk hosting eller `file://`)
- Bare to eksterne avhengigheter: PDF-bibliotek (jsPDF 2.5.1) og Google Fonts
- Utskriftsvisning skjuler topplinje, panel og knapper
