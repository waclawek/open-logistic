# Panel spedytora (open-logistic) — product brief

- Date: 2026-09-19
- Mode: existing (+ sprawdzenia dla własnego pomysłu: brak użytkowników); Owner: Julia Jakubowska (ekran spedytora); Pass: Quick pass
- Evidence basis: kod forka `open-logistic` (moduł `logistics`, 7 stron + dane + agenci), tablica zespołu z 2026-09-19 (dwa zrzuty: diagram procesu, szkic ekranu) i decyzje Julii z tej sesji. Brak rozmów z prawdziwym spedytorem i danych z użycia; potrzeba „szybkich decyzji per przewóz” jest przekonaniem zespołu, nie obserwacją.
- Coverage: 24 claims — 20 sourced (interview 0, data 0, document 17, product 3, benchmark 0), 0 synthetic, 4 assumed; 0 entries on the collection plan
- Synthetic hypotheses outside Coverage: 0
- Definition of Ready signed by: not yet signed — brakuje potwierdzenia zespołu (Q01) i formy „dodatkowego załadunku” (Q02); ready for: implementation planning of the stated scope (szkielet panelu), nie dla wpięcia AI
- Sources: `apps/mercato/src/modules/logistics/` (stan na commit `5bfe0388`), `.ai/specs/2026-09-19-app-spec-logistics-dashboard.md`, `README.md`, tablica zespołu 2026-09-19 (zrzuty w sesji), `.ai/specs/research/decisions/2026-09-19-panel-spedytora.md`

## Decision summary

Decyzja (uzgodniona z Julią 2026-09-19): tniemy zakres do **szkieletu panelu spedytora** — moduł `logistics` kasujemy w całości i budujemy od zera dwie zakładki: „AI Inbox / Offers” (link do wbudowanej skrzynki OM) i „AI Przewozy” (tabela przewozów + ekran szczegółów z Order 1 i Order 2). Reszta (wycena, giełda, agenci) ma się do tego panelu wpiąć później (D01–D04).

Kto ma problem: spedytor w firmie transportowej, który dla każdego przewozu musi zatwierdzić przewoźnika z giełdy i ewentualny dodatkowy załadunek. To opis z tablicy zespołu, bez relacji prawdziwego spedytora (A01).

Największa niepewność: kasujemy fundament zbudowany przez Łukasza Wacławka (7 stron, spec Etapu 1, PR #7/#8) — zespół nie potwierdził tego cięcia (Q01). Druga: jak zapisać „dodatkowy załadunek” przy modelu „Order 2 = osobne zamówienie” (Q02) — to blokuje drugi przycisk szybkiej decyzji, nie sam szkielet.

Następny krok: Julia buduje szkielet (spec przez `om-spec-writing` albo od razu implementacja) i równolegle daje znać zespołowi o kasacji modułu.

## Vision

Spedytor ma jeden ekran, na którym widzi wszystkie przewozy i jednym kliknięciem zatwierdza to, co przygotował automat; agent nigdy nie wysyła nic sam. Kierunek zespołu, nie zmierzona korzyść. `[DOCUMENT]` tablica zespołu 2026-09-19; decyzja Julii „na końcu procesu zawsze człowiek” (pamięć sesji z 2026-09-19 ~15:00)

## Target group and stakeholders

- Customer (pays): jury hackathonu HackOn Wrocław 2026 (demo), docelowo firma spedycyjna — wybór zespołu `[DOCUMENT]` tablica zespołu 2026-09-19
- User (uses): spedytor / dyspozytor firmy transportowej; brak obserwacji realnej pracy `[ASSUMPTION]` pochodzenie: zespół
- Stakeholders: Łukasz Wacławek (właściciel forka `waclawek/open-logistic`, autor Etapu 1), reszta zespołu wpinająca A1/A2/A3 `[PRODUCT]` `git log` forka 2026-09-19
- Decider for scope decisions: Julia Jakubowska dla ekranu spedytora; zespół dla kasacji wspólnego modułu (Q01)

## Problems, with evidence

- Przewóz ma dwie strony (zamówienie klienta i zamówienie u podwykonawcy), a decyzje o przewoźniku i dodatkowym załadunku wymagają zatwierdzenia człowieka — dziś w aplikacji nie ma ekranu, który pokazuje obie strony razem `[DOCUMENT]` diagram procesu, tablica zespołu 2026-09-19
- Obecne 7 stron modułu `logistics` pokazuje zlecenia, flotę, trasy, mapę, statystyki i propozycje osobno; żadna nie ma widoku „Order 1 + Order 2” ani szybkich decyzji per przewóz `[PRODUCT]` `apps/mercato/src/modules/logistics/backend/logistics/*`
- Że spedytor faktycznie traci czas na te decyzje i ile — nie wiemy `[ASSUMPTION]` brak materiału

## Product and how it stands out

- What it is: panel w backoffice OM z grupą menu o dwóch pozycjach i ekranem szczegółów przewozu; patrz Scope `[DOCUMENT]` szkic ekranu, tablica zespołu 2026-09-19
- What makes it different: brak sprawdzonych porównań; benchmark odłożony — nie wpływa na decyzję o szkielecie

| reference | what it does well | where it falls short for our users | checked on | link |
|---|---|---|---|---|

## Goals and success criteria

- Business goal: pokazać na demo klikalny przepływ „przewóz → zatwierdź przewoźnika” na danych z seedu; właściciel Julia (D01)
- User outcome: spedytor otwiera przewóz, widzi Order 1 i Order 2 i zatwierdza propozycję jednym kliknięciem `[DOCUMENT]` szkic ekranu, tablica zespołu 2026-09-19
- Primary metric: brak — demo, nie produkt z użytkownikami; baseline nieznany
- What must not get worse: nie ruszamy `packages/*` (zasada tracku: overlay w `apps/mercato`) `[DOCUMENT]` `materialy_z_tracks_wybranych/aicompany_track.txt`

## Scope

- **Now:** nowy moduł-nakładka z grupą menu (2 pozycje), stroną „AI Przewozy” (tabela: klient, trasa, status Order 1, status Order 2, akcje „zatwierdź przewoźnika” / „zatwierdź dodatkowy załadunek”), ekranem szczegółów przewozu (sekcja Order 1, sekcja Order 2 z autem i wolnym miejscem wg R04), pozycją „AI Inbox / Offers” prowadzącą do wbudowanej skrzynki OM; dane = zamówienia sprzedaży z seedu; R01–R03, D01–D04
- **Later:** wpięcie A1 (wycena z maila), A2 (szukanie przewoźnika na giełdzie), A3 (dodatkowy załadunek w trasie), ewentualny powrót logiki z usuniętego modułu (D01)
- **Not doing:** see Non-goals

## Domain glossary

| Term | Meaning | Owned by | Visible to |
|---|---|---|---|
| Przewóz | jednostka pracy spedytora: dokładnie jedno Order 1 i 0–1 Order 2 | logistics | spedytor |
| Order 1 | zamówienie klient → nasza firma (zamówienie sprzedaży OM) | sales | spedytor |
| Order 2 | zamówienie nasza firma → przewoźnik z giełdy; osobny rekord zamówienia powiązany z Order 1, niesie dane auta: typ, ładowność/wielkość (D02, R04) | sales + logistics | spedytor |
| Giełda | zewnętrzne źródło przewoźników i ładunków; w demo symulowane | poza zakresem | — |
| Dodatkowy załadunek | ładunek z giełdy dołożony do jadącego auta (A3); mieści się tylko w wolnym miejscu z R04; forma zapisu otwarta (Q02) | logistics | spedytor |
| Wolne miejsce | ładowność auta z Order 2 minus wielkość towaru z Order 1 (R04) | logistics | spedytor |

## Key flows

- Current state: 7 osobnych stron w grupie „Logistyka”, zlecenia w tabeli bez rozróżnienia Order 1 / Order 2, propozycje agentów na osobnej stronie `[PRODUCT]` `apps/mercato/src/modules/logistics/components/*`
- Future state: menu → „AI Przewozy” → tabela → wiersz → szczegóły (Order 1 / Order 2) → „zatwierdź przewoźnika” zmienia status Order 2 na zatwierdzony; „zatwierdź dodatkowy załadunek” działa dopiero po Q02 `[DOCUMENT]` diagram procesu, tablica zespołu 2026-09-19

## Business rules

| Id | Rule | Applies to | Source | Status | Review by | Required path to change | Owner | Supersedes |
|---|---|---|---|---|---|---|---|---|
| R01 | Przewóz bez Order 1 nie istnieje: nie da się utworzyć Order 2 ani przewozu bez istniejącego zamówienia klienta | tabela, szczegóły, API | `[DOCUMENT]` wiadomość Julii 2026-09-19 | active | koniec hackathonu | Julia | Julia Jakubowska | none |
| R02 | Zatwierdzenie przewoźnika i dodatkowego załadunku wykonuje człowiek jednym kliknięciem; agent tylko proponuje | akcje w tabeli i szczegółach | `[DOCUMENT]` decyzja Julii 2026-09-19 ~15:00 (pamięć sesji) | active | koniec hackathonu | Julia | Julia Jakubowska | none |
| R03 | Kod tylko w `apps/mercato/src/modules/<moduł>`; brak zmian w `packages/*` i migracji własnych tabel | cały moduł | `[DOCUMENT]` zasady tracku AI Company | active | koniec hackathonu | zespół | Julia Jakubowska | none |
| R04 | Order 2 przechowuje dane auta (ładowność/wielkość). Wolne miejsce = ładowność auta z Order 2 − wielkość towaru z Order 1; dodatkowy załadunek wybiera się tylko w granicach wolnego miejsca | ekran szczegółów, akcja „zatwierdź dodatkowy załadunek”, A3 | `[DOCUMENT]` wiadomość Julii 2026-09-19 (po sesji) | active | koniec hackathonu | Julia | Julia Jakubowska | none |

## Non-goals

| Id | We are not building | Why | Owner | Status | Review by | Required path to change | Source | Supersedes |
|---|---|---|---|---|---|---|---|---|
| N01 | Wycena, giełda, agenci A1–A3, mapa, flota, statystyki w tym przebiegu | cięcie zakresu do szkieletu, resztę wpina zespół później | Julia Jakubowska | active | koniec hackathonu | Julia | `[DOCUMENT]` wiadomość Julii 2026-09-19 | none |
| N02 | Własna tabela „Przewóz” z migracją | przewóz = para zamówień sprzedaży, zero migracji (R03) | Julia Jakubowska | active | po demo | zespół | `[DOCUMENT]` decyzja z tej sesji (D02) | none |

## Decisions

| Id | Date | Decision | Why | Owner | Status | Review by | Required path to change | Source | Supersedes |
|---|---|---|---|---|---|---|---|---|---|
| D01 | 2026-09-19 | Usunąć cały moduł `logistics` (strony, lib, api, agenci, kopia w `packages/create-app/template`, docs/logistics) i zacząć panel od zera | Julia wybrała czysty start ponad zachowanie logiki; alternatywy: skasować tylko strony i zostawić lib/api (rekomendacja agenta, odrzucona) lub dołożyć 2 zakładki obok 7 stron | Julia Jakubowska | active | Q01 (zespół) | zespół | `[DOCUMENT]` odpowiedź Julii w sesji 2026-09-19 | none |
| D02 | 2026-09-19 | Order 2 = osobny rekord zamówienia sprzedaży powiązany z Order 1 polem dodatkowym; niesie dane auta i ładowność (R04) | bliżej diagramu procesu; alternatywa: pola przewoźnika na tym samym zamówieniu (rekomendacja agenta, odrzucona) | Julia Jakubowska | active | po demo | Julia | `[DOCUMENT]` odpowiedź Julii w sesji 2026-09-19 | none |
| D03 | 2026-09-19 | „AI Inbox / Offers” = link do wbudowanego modułu `inbox_ops` (`/backend/inbox-ops`), nie własna strona | zero pracy, zespół A1 wpina się w gotową skrzynkę; alternatywy: placeholder lub własna tabela ofert | Julia Jakubowska | active | po demo | Julia | `[DOCUMENT]` odpowiedź Julii w sesji 2026-09-19 | none |
| D04 | 2026-09-19 | Zakres tego przebiegu = menu (2 pozycje) + tabela przewozów z szybkimi decyzjami + ekran szczegółów Order 1 / Order 2 | to część, za którą Julia odpowiada w zespole; reszta wpinana później | Julia Jakubowska | active | koniec hackathonu | Julia | `[DOCUMENT]` wiadomość Julii i szkic ekranu 2026-09-19 | none |

## Riskiest assumptions

| Id | Assumption | Importance | Evidence today | If false | Smallest test | Owner | By when | Result |
|---|---|---|---|---|---|---|---|---|
| A01 | Spedytor chce podejmować decyzje per przewóz w tabeli, nie w skrzynce propozycji `[ASSUMPTION]` zespół | medium | tylko tablica zespołu | ekran duplikuje `inbox_ops/proposals` | pokazać szkielet jednej osobie ze spedycji i spytać, gdzie szukałaby decyzji | Julia | po demo | accepted untested (D04) |
| A02 | Dwa zamówienia sprzedaży da się powiązać polem dodatkowym bez zmian w `sales` `[ASSUMPTION]` z przeglądu kodu: brak natywnego pola „parent” w `sales_order` | high | `packages/core/src/modules/sales/data/entities.ts` nie ma pola powiązania (grep w sesji) | wracamy do wariantu „pola na tym samym zamówieniu” | zdefiniować pole w `ce.ts`, zasiać 1 parę, wyświetlić w szczegółach | Julia | pierwszy dzień implementacji | untested |

## Kill criteria

Jeśli w pierwszym dniu implementacji powiązanie Order 1–Order 2 (A02) nie działa na seedzie, wracamy do pól na jednym zamówieniu; decyduje Julia. Jeśli zespół sprzeciwi się kasacji modułu (Q01), D01 wraca do wariantu „skasować tylko strony”.

## Hypotheses to test

Brak — nie było paneli syntetycznych.

## Open questions

| Id | Question | Blocking | Who can answer | Status |
|---|---|---|---|---|
| Q01 | Czy zespół (Łukasz Wacławek) zgadza się na usunięcie modułu `logistics`, jego speca Etapu 1 (PR #8 z naszym kodem jest już zamknięty bez merge)? | tak — D01 wykonana bez zgody zespołu tworzy konflikt z `develop` forka i PR #7 | Łukasz Wacławek | open |
| Q02 | Jak zapisujemy „dodatkowy załadunek”: trzecie zamówienie powiązane z przewozem, czy pole na Order 1? Wyliczenie wolnego miejsca ustalone (R04); otwarta tylko forma zapisu | częściowo — blokuje zapis akcji „zatwierdź dodatkowy załadunek”, nie tabelę, szczegóły ani pokazanie wolnego miejsca | Julia z zespołem (A3) | open |
| Q03 | Czy pozostałe grupy menu OM (CRM, sprzedaż…) chowamy dla demo przez `/backend/sidebar-customization`, czy zostają? | nie | Julia | open |

## Definition of Ready addendum (existing)

Ekrany dotknięte: cała grupa „Logistyka” znika, pojawia się nowa grupa z 2 pozycjami; grupa „AI Inbox Actions” zostaje. Użytkownicy: rola `dyspozytor` z seedu znika razem z modułem — nowy moduł musi ją odtworzyć (lub użyć admina na demo). Dane: brak migracji; wartości pól dodatkowych z `ce.ts` starego modułu zostają w bazie jako osierocone, nie przeszkadzają. Rollback: `git revert` commitu kasującego. Problems i Target group opierają się na dokumentach zespołu, nie na obserwacji użytkowników — gotowe do planowania szkieletu, nie do walidacji produktu. Otwarte przed implementacją: Q01.

## Collection plan

Brak wniosków o materiał — decyzja o szkielecie nie wymaga nowych danych; A01 sprawdzamy po demo.
