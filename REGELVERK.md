# Regelverket i turnusplanleggeren

Planleggeren kontrollerer hver turnus mot drøftingsresultatet mellom Posten Bring
Varebil AS og Fagforbundet. Alle grenseverdier ligger samlet i `regelverk.js`
(objektet `AVTALE`), slik at en endring i avtaleverket kan gjøres ett sted.

## Avtalegrunnlag

| Kode    | Dokument |
|---------|----------|
| `OK`    | Overenskomst PBV – Fagforbundet, Del B, 1.4.2026 – 31.3.2028 |
| `SAML`  | Særavtale S2 om gjennomsnittsberegning av alminnelig arbeidstid (AML), fra 1.4.2026 |
| `SFATS` | Særavtale S2 om gjennomsnittsberegning av alminnelig arbeidstid (FATS), fra 1.4.2026 |
| `AML`   | Arbeidsmiljøloven kap. 10 (§ 10-5 hjemler gjennomsnittsberegningen) |
| `FSK`   | Forskrift om arbeidstid for sjåfører og andre innenfor vegtransport (FOR-2005-06-10-543) |
| `KHT`   | Kjøre- og hviletidsforordningen (EF) nr. 561/2006 |

Hvilket regelsett som brukes styres av bryteren **Yrkessjåfør – FATS**:

* **Av** – sjåføren er underlagt arbeidsmiljøloven (varebilsjåfør, B-sertifikat).
  Særavtale S2 (AML) gjelder.
* **På** – sjåføren er underlagt forskriften (yrkessjåfør, C/CE-sertifikat).
  Særavtale S2 (FATS) gjelder.

Særavtalene sier uttrykkelig at sjåfører under det ene regelsettet henvises til
den andre avtalen, så de to settene kjøres aldri samtidig.

## Felles kontrollpunkter

| Kontroll | Grense | Hjemmel |
|----------|--------|---------|
| Gjennomsnittsperiode | maks 16 uker | SAML pkt. 1 / SFATS pkt. 1 |
| Gjennomsnittlig ukentlig arbeidstid | 37,5 t (35,5 t, se under) | SAML pkt. 2 / SFATS pkt. 2 / OK pkt. 4.1 |
| Søn- og helligdager | skal være fridager; arbeid gir 100 % tillegg | OK pkt. 4.3 og 7.1.3 |
| Overlappende vakter | ikke tillatt | turnusteknisk |
| Heltid | merknad ved stillingsprosent under 100 | OK pkt. 18 |

**35,5-timersgrensen.** For AML-sjåfører settes beregningsgrunnlaget til 35,5 t
når det arbeides minst hver tredje søndag, eller når arbeidet hovedsakelig
drives om natten (SAML pkt. 2). Grunnlaget vises i oppsummeringspanelet og
brukes både i stillingsprosenten og i snittkontrollen. Overenskomstens divisor
følger med: 1950 timer ved 37,5 t/uke, 1850 timer ved 35,5 t/uke (OK pkt. 8.1.1).

**Pauser.** Spise- og hvilepauser over 15 minutter regnes ikke som arbeidstid for
sjåfører (OK pkt. 4.1). Pauselengden settes etter AML § 10-9 (30 min ved mer enn
5,5 t) i AML-regimet, og etter forskriften § 12 (30 min fra 6 t, 45 min over 9 t)
i FATS-regimet.

**Tilgjengelighetstid.** Tilgjengelighetstid lagt inn på en vakt trekkes fra
arbeidstiden i FATS-regimet, men regnes ikke som hvile. Hver vakt behandles
derfor med to representasjoner: hele spennet fra start til slutt i
hvilekontrollene, og arbeidsintervallene – spennet minus tilgjengelighets-
periodene – i arbeidstidskontrollene. I AML-regimet ses det bort fra
tilgjengelighetstid, slik resten av planleggeren også gjør.

## AML-regimet (særavtale S2 – AML)

| Pkt. | Regel | Slik kontrolleres den |
|------|-------|-----------------------|
| 1 | Gjennomsnittsberegning inntil 16 uker | antall uker i rotasjonen |
| 2 | Snitt maks 37,5 t (35,5 t) per uke | sum netto arbeidstid delt på antall uker |
| 3 | Maks 54 t i løpet av syv dager | glidende 7-døgnsvindu |
| 3 | Snitt maks 48 t per uke over åtte uker | glidende 8-ukersvindu |
| 4 | Maks 12,5 t i løpet av 24 timer | glidende 24-timersvindu |
| 5 | Minst 8 t sammenhengende fri i løpet av 24 timer | korteste arbeidsfrie periode mellom to vakter |
| 6 | 30 t sammenhengende arbeidsfri, inkludert et helt kalenderdøgn, i løpet av syv dager | avstanden fra slutten av én kvalifiserende ukefri til slutten av den neste må være høyst 168 t |
| 7 | Fri annenhver søn-/helligdag i snitt over 26 uker | andel søn-/helligdager med arbeid må være høyst 50 % |
| 7 | Fridøgnet skal falle på søn-/helligdag minst hver fjerde uke | lengste opphold mellom frie søn-/helligdøgn, målt syklisk |
| 8 | Behov utover dette avtales sentralt | nevnes i bruddteksten når perioden er for lang |

I tillegg kontrolleres OK pkt. 4.2: alminnelig arbeidstid for AML-sjåfører legges
mellom kl. 07.00 og 17.00. Tid utenfor gir **varsel**, ikke brudd, siden den
utløser tillegg etter pkt. 7.1.1 og 7.1.2 og forutsettes omforent i drøftingen.

## FATS-regimet (særavtale S2 – FATS)

| Pkt. | Regel | Slik kontrolleres den |
|------|-------|-----------------------|
| 1 | Gjennomsnittsberegning inntil 16 uker | antall uker i rotasjonen |
| 2 | Snitt maks 37,5 t per uke | sum netto arbeidstid delt på antall uker |
| 3 | Maks 60 t i løpet av 7 dager | glidende 7-døgnsvindu |
| 4 | Maks 10 t i løpet av 24 timer | glidende 24-timersvindu |
| 5 | Lengre arbeidstid enn forskriftens § 8 i maks 6 uker sammenhengende | uker over 40 t per 7 dager eller 9 t per 24 t telles i sammenhengende rekker, syklisk |
| 6 | Døgn med mer enn 3 t nattarbeid: snitt maks 8 t arbeidstid per 24 t | snitt over nattdøgnene i vinduet |
| 7 | Gjennomsnittsperioden for nattarbeid er 4 uker | glidende 4-ukersvindu |

Kjøre- og hviletid kontrolleres i tillegg, siden turnusen skal kunne kjøres
lovlig: døgnhvile 11 t (redusert 9 t gir varsel, under 9 t gir brudd) og ukehvile
45 t / redusert 24 t innen 144 timer. Reduserte døgnhviler telles kronologisk og
nummereres 1/3, 2/3, 3/3 på vaktene; telleren nullstilles av en ukehvile på 45 t,
og den fjerde reduserte hvilen mellom to ukehviler er brudd. Første syklus av
rotasjonen brukes bare til å varme opp telleren, slik at tallet blir riktig også
for en rullerende turnus.

## Tolkningsvalg

Disse valgene er tatt der avtaleteksten må operasjonaliseres. De ligger som
konstanter eller kommentarer i `regelverk.js` og kan justeres om partene legger
noe annet til grunn.

1. **Turnusen behandles som rullerende.** Siste uke etterfølges av første uke, og
   alle glidende vinduer beregnes syklisk. Uten dette ville brudd i overgangen
   mellom siste og første uke aldri bli oppdaget.
2. **Nettotid fordeles jevnt.** Når et vindu deler en vakt, fordeles vaktens
   nettotid proporsjonalt over vaktens lengde. Pausen ligger et sted inne i
   vakten, og dette er den nøytrale fordelingen.
3. **Ukentlig arbeidsfri (SAML pkt. 6)** måles fra slutten av én kvalifiserende
   hvileperiode til slutten av den neste; grensen er 168 timer. En hvileperiode
   kvalifiserer bare når den er minst 30 timer *og* dekker et helt kalenderdøgn.
4. **Nattperioden.** AML-regimet bruker kl. 21.00–06.00 (aml. § 10-11 første
   ledd). FATS-regimet bruker kl. 22.00–06.00. Lovdata var ikke tilgjengelig fra
   utviklingsmiljøet til å bekrefte forskriftens definisjon ordrett, så FATS-
   verdien bør bekreftes mot forskriften § 3 før den brukes i en reell drøfting.
   Den ligger som én konstant (`AVTALE.fats.natt`).
5. **Nattsnittet (SFATS pkt. 6)** beregnes som snittet av arbeidstiden i de
   døgnene som faktisk har mer enn 3 timer nattarbeid, ikke over alle døgn i
   perioden. Det er den strengeste og mest vernende lesningen.
6. **Forskriftens § 8** legges til grunn med 40 t per 7 dager og 9 t per 24 t.
7. **Snitt over grensen er brudd, ikke varsel.** Særavtalene sier at
   gjennomsnittlig arbeidstid «kan ikke overstige» 37,5/35,5 t, så en turnus over
   grensen flagges som brudd også når den ellers er lovlig som deltid pluss
   merarbeid.

## Slik varsles brudd

* **Panelet «Regelkontroll»** viser status hele tiden: grønn kant uten avvik, gul
  ved varsler, rød ved brudd. Hvert avvik viser hjemmelen, og et klikk hopper til
  uka det gjelder.
* **«Alle kontrollpunkter»** viser hele kontrollisten med målt verdi og grense,
  også de som er i orden – det er den som dokumenterer at turnusen faktisk er
  kontrollert.
* **Tidslinjen** farger vakter som inngår i et brudd røde, og vakter med varsel
  får gul ramme. Ukefanene markeres tilsvarende.
* **Toast-varsel** dukker opp i det øyeblikket en endring innfører et *nytt*
  brudd.
* **Eksport** krever bekreftelse når turnusen har brudd, og drøftingsnotatet får
  en egen side «Regelkontroll mot avtaleverket» med kontrolliste, avvik og
  hjemmel, slik at fagforbundet ser hva som er vurdert.
