# App Spec: Logistyka — fundament panelu dyspozytora

**Data:** 2026-09-19

**Status:** FOUNDATION IMPLEMENTED — fundament nawigacji ma implementację i zapis weryfikacji w [raporcie](../../docs/logistics/verification.md). Nie oznacza to wdrożenia funkcji operacyjnych.

**Rozszerzenie operacyjne (2026-09-19):** [Logistics — first operational release](2026-09-19-app-spec-logistics-operations.md) rozszerza ten App Spec o zlecenia, przejazdy, przydziały, ręczne wykonanie i pomiar pustych kilometrów. Użytkownik potwierdził własną flotę, cel ograniczenia pustych kilometrów i ręczny dispatch. Poniższy dokument zachowuje historyczny zakres fundamentu; jego wyłączenia dotyczą wyłącznie tamtego etapu. Reguły nowego etapu są w rozszerzeniu, które wymaga ukończenia przeglądów i potwierdzenia przed implementacją.

**Zakres bieżący:** grupa menu „Logistyka” i siedem stron przygotowanych do dalszej rozbudowy.

**Źródło prawdy:** ten App Spec dla fundamentu panelu. Użytkownik polecił samodzielnie rozstrzygnąć założenia i ukończyć dokument bez dalszych pytań. Zlecenie kończy się specyfikacją; implementacja i dekompozycja na feature specs nie są częścią tej pracy.

## TLDR / Overview / Problem Statement

Firma ma docelowo przyjmować zlecenia transportowe, przydzielać pojazdy i kierowców oraz planować przejazdy. Obecne zadanie przygotowuje wyłącznie miejsce tych funkcji w istniejącej aplikacji Open Mercato. Operator ma móc znaleźć każdą z siedmiu sekcji i rozpoznać jej przeznaczenie. Ten etap nie zapewnia jeszcze obsługi transportu.

**Proposed Solution:** jedna grupa w lewym menu, siedem chronionych podstron, spójne nagłówki i komunikaty o funkcjach planowanych. Bez pozornych danych operacyjnych i przycisków sugerujących dostępność niewdrożonych operacji.

## Źródła i granice ustaleń

- S1: `C:/Dev/hackonv1/docs/logistyka-openmercato-architektura.md`, zwłaszcza §3–4 — właściciele danych i dokładna lista siedmiu sekcji.
- S2: `C:/Dev/hackonv1/docs/logistyka-agent-koncepcja.md` — docelowe ofertowanie, doładunki i reakcje na zakłócenia. Koncepcja nie jest deklaracją gotowych funkcji.
- S3: bieżące polecenie użytkownika — pierwszym krokiem ma być baza do dalszej pracy. Ta kolejność ma pierwszeństwo przed etapami demo w S1/S2.
- S4: `packages/core/AGENTS.md`, `.ai/docs/module-development.md`, `packages/ui/AGENTS.md` — strony modułów, metadane, ACL i wspólne UI.
- S5: `packages/core/src/modules/workflows/backend/work-inbox/page.meta.ts` — lokalny przykład standardowej grupy menu, kolejności, tłumaczeń i ochrony strony.
- S6: późniejsze polecenie użytkownika: kontynuować autonomicznie, przyjąć rozsądne założenia i zakończyć bez pytań. Zastępuje oczekiwanie na odpowiedzi Phase 0 oraz końcowe potwierdzenie; nie rozszerza zlecenia ze specyfikacji na kod.

Przeszukano `.ai/specs/` i `.ai/specs/enterprise/`: brak App Spec panelu transportowego. Specyfikacje WMS opisują magazyn i logistykę zwrotów, a nie dyspozycję pojazdów. Nie sprawdzano kont dostawców ani gotowości działającego środowiska. Publiczne opisy API przywołane w S1/S2 nie są zależnością tego etapu.

## 1. Business Context `PM`

### 1.1 Business Model

Potwierdzone: użytkownik chce stworzyć firmę logistyczną zarządzającą samochodami, zleceniami i trasami.

**Kto płaci — założenie A1:** klienci płacą firmie za przewóz, a aplikacja jest narzędziem wewnętrznym, nie sprzedawanym SaaS. Przyjęto na podstawie „chcemy stworzyć firmę logistyczną” oraz zgody na samodzielne założenia.

**Flywheel — założenie A2:** więcej zleceń → lepsze łączenie ładunków → mniej pustych kilometrów → lepszy wynik na przejazd → możliwość obsługi kolejnych klientów. Fundament menu umożliwia dalszą budowę narzędzia; sam nie realizuje tej pętli.

#### Checklist
- [x] Płatnik i przedmiot płatności określone jako założenie A1.
- [x] Mechanizm rozwoju określony jako założenie A2, bez deklarowania potwierdzonych wyników.

### 1.2 Business Goals

**Primary goal — założenie A3:** docelowo obniżyć udział pustych kilometrów o 10% względnie wobec bazowych czterech pełnych tygodni, w pierwszych ośmiu pełnych tygodniach działania planowania. To proponowany cel produktu, nie obietnica wyniku fundamentu. Wskaźnik = 100 × kilometry bez ładunku / wszystkie kilometry floty; porównywana ta sama flota i pełne okresy. Źródła docelowe: zweryfikowany przebieg pojazdów i ewidencja ładunku na odcinkach. Brak któregokolwiek źródła oznacza „brak danych”, a nie zero. Raport musi ujawniać pokrycie danych; nie wolno poprawiać wyniku przez pomijanie brakujących lub niekorzystnych przejazdów. Pomiar i jego UI są poza etapem 1.

**Cel pierwszego etapu:** po zalogowaniu operator otwiera dowolną sekcję Logistyki w najwyżej trzech kliknięciach i rozpoznaje jej przeznaczenie. Odbiór: 7/7 stron dostępnych, 0 martwych odsyłaczy, 0 danych przedstawianych jako rzeczywiste bez źródła. To miara kompletności fundamentu, nie finansowy ROI.

**Secondary goal (reference app):** N/A — nie uzgodniono budowy aplikacji referencyjnej.

**Zakres pierwszego etapu — założenie A4:** jedna grupa Logistyka i siedem chronionych stron informacyjnych, bez operacji transportowych.

**Poza pierwszym etapem:** CRUD pojazdów/kierowców/zleceń, dane demo, rezerwacje i przydziały, edytor lub optymalizator tras, mapa z GPS, integracja Linqo/giełd, statystyki wyliczane z danych, agenci, powiadomienia, portal i aplikacja kierowcy. Nie zakładamy ich usunięcia z produktu docelowego.

#### Checklist
- [x] Docelowy KPI, źródła, okres i cel liczbowy zapisane jako założenie A3.
- [x] Granice pierwszego kroku zapisane jako założenie A4 zgodne z minimalnym zakresem polecenia.

### 1.3 Ubiquitous Language

| Termin | Jedno znaczenie | Źródło danych | Okres |
|---|---|---|---|
| Logistyka | Grupa nawigacji i obszar operacyjny transportu | Definicje stron modułu | N/A |
| Pulpit dyspozytora | Strona wejściowa do obszaru Logistyki | W tym etapie treść statyczna | N/A |
| Zlecenie transportowe | Wymagania i wykonanie przewozu; odrębne od zamówienia handlowego | Docelowo domena `logistics` | N/A |
| Zamówienie handlowe | Uzgodnione warunki handlowe z klientem | Istniejący `sales` | N/A |
| Pojazd | Zasób realizujący przewóz | Docelowo `resources` + profil logistyczny | N/A |
| Kierowca | Osoba wykonująca przewóz, nie automatycznie użytkownik panelu | Docelowo `staff` + profil logistyczny | N/A |
| Przejazd | Wykonanie uporządkowanych odbiorów i dostaw z przydzielonymi zasobami | Docelowo `logistics` | N/A |
| Trasa | Plan drogi pomiędzy przystankami przejazdu | Docelowo planowanie i źródło tras | N/A |
| Propozycja | Wariant wymagający decyzji, a nie wykonana zmiana | Docelowy proces decyzji | N/A |
| Zakłócenie | Zdarzenie podważające wykonalność bieżącego planu | Docelowo `logistics` | N/A |
| Funkcja planowana | Funkcja jeszcze niedostępna; nie oznacza braku rekordów | Zakres wdrożenia | N/A |
| Puste kilometry | Kilometry przejechane bez przewożonego ładunku | Docelowo przebieg i ewidencja ładunku na odcinkach | Cztery tygodnie bazowe / osiem tygodni pomiaru; §1.2 |

#### Checklist
- [x] Zlecenie, zamówienie, przejazd i trasa mają różne znaczenia.
- [x] Docelowy KPI ma formułę w §1.2; pierwszy etap go nie oblicza ani nie prezentuje.

### 1.4 Domain Model / Data Models

**Pierwszy etap nie tworzy encji biznesowych, tabel, relacji ani migracji.** Występują tylko istniejące tożsamości i uprawnienia OM oraz konfiguracja stron. Tabela pól encji: N/A dla tego etapu. Nie projektujemy teraz schematów `TransportJob`, `Trip` czy profili floty jako ukrytego rozszerzenia zakresu.

Granice przyszłych właścicieli danych z S1: `customers` — klienci i kontakty; `sales` — dokumenty handlowe; `resources` — zasoby; `staff` — personel; `planner` — deklarowana dostępność; `logistics` — wymagania i wykonanie transportu. To kontekst dalszej analizy, nie nowe zależności pierwszego wdrożenia. Szczegółowe pola przyszłych encji wymagają rozszerzenia i przeglądu App Spec przed specyfikacjami funkcji.

**Inwarianty fundamentu:** wejście na stronę nie tworzy i nie zmienia danych domenowych; etykieta „planowane” nie udaje stanu „brak zleceń”; operator bez uprawnienia nie uzyskuje dostępu przez bezpośredni URL; zakres organizacji wynika z sesji OM.

#### Checklist
- [x] Właściciele przyszłych danych odróżnieni od zakresu bieżącego.
- [x] Brak nowych encji wyjaśniony; precyzyjne pola nie są potrzebne dla stron statycznych.
- [x] Przegląd DDD sekcji 1–2: brak CRITICAL; uzupełniono jawną etykietę A4.

## 2. Identity Model `PM`

| Persona | Role key | Tożsamość / powierzchnia | Zakres | Działanie w etapie 1 |
|---|---|---|---|---|
| Dyspozytor | Istniejąca rola z przypisanym `logistics.view`; bez wymogu konkretnej nazwy | Internal / backend OM | Aktualny tenant i organizacja | Otwiera siedem podstron |
| Administrator firmy | Istniejąca rola administracyjna | Internal / backend OM | Organizacje dostępne w OM | Przydziela dostęp istniejącym mechanizmem ACL |
| Kierowca i klient firmy | N/A w tym etapie | Nie powstają konta ani powierzchnie aplikacji | N/A | Brak ścieżek użytkownika |

**Portal decision:** NOT USED w pierwszym etapie. Zadanie dotyczy wewnętrznego panelu dyspozytora. Kartoteka kierowcy nie jest drugim systemem tożsamości. Późniejszy dostęp kierowców/klientów wymaga świadomego rozszerzenia modelu.

Jedno uprawnienie odczytu `logistics.view` chroni wszystkie siedem stron i menu. Uprawnienia przyszłych zapisów nie są przyznawane przez tę funkcję. Należy korzystać z istniejącego dopasowania wildcardów, także dla `logistics.*` i `*`, oraz `requireAuth` / `requireFeatures` w metadanych. `defaultRoleFeatures` nadaje administratorowi wyłącznie `logistics.view`; istniejące instalacje korzystają ze standardowego sync ACL. Rola operatora otrzymuje funkcję przez istniejący panel ACL; nie tworzymy nowej roli ani drugiego panelu zarządzania dostępem. Administrator wykonuje operacje w ramach istniejącego uprawnienia do zarządzania ACL, którego nie nadaje `logistics.view`. Brak domyślnego grantu dla wszystkich pracowników. Cofnięcie jednego grantu nie odbiera dostępu, jeśli pozostaje skuteczne uprawnienie z innej roli lub wildcardu.

#### Checklist
- [x] Jedna wewnętrzna tożsamość i określony zakres organizacji.
- [x] Brak portalu uzasadniony bieżącym zakresem.
- [x] Model przeszedł niezależny przegląd Phase 0.

## 3. Workflows `PM`

Trzy przepływy obejmują cykl dostępu do fundamentu: udostępnienie, użycie, odebranie. WF1 i WF3 korzystają w całości z istniejącej administracji OM; nie rozszerzają produktu o nowe funkcje administracyjne. Docelowe procesy transportowe z S1/S2 pozostają poza zakresem. Miary poniżej są kryteriami wartości i odbioru, nie deklaracją osiągniętego finansowego ROI.

### WF1 — Administrator udostępnia Logistykę operatorowi

**Journey:** istniejący operator i rola → administrator nadaje `logistics.view` w istniejącym ACL → zapis → operator odświeża panel i otwiera Logistykę.

**ROI / miara:** dostęp można nadać standardową konfiguracją ACL bez zmiany kodu i wdrożenia; jeżeli operator ma już właściwą rolę, wystarczy jeden zapis grantu tej roli. 100% kontrolnych kont z efektywnym uprawnieniem uzyskuje dostęp. Grant współdzielonej roli obejmuje wszystkich jej członków. Nie szacujemy zaoszczędzonych godzin bez pomiaru bazowego.

**Granice:** początek — administrator decyduje o dostępie istniejącego operatora; koniec — operator otwiera chronioną stronę; poza przepływem — rekrutacja, zakładanie firmy i użytkowników, role kierowców, uprawnienia do przewozów.

**Warunek dostępu administratora WF1/WF3:** efektywne `auth.roles.list`, `auth.roles.manage` i `auth.acl.manage` albo pokrywające je standardowe wildcardy. Jeżeli operacja wymaga także strony użytkownika, obowiązują jej istniejące uprawnienia wymienione w §3.5.

**Wyjątki:** (1) brak wymaganego uprawnienia administratora → standardowa odmowa, ACL bez zmian; (2) grant już istnieje → brak duplikacji i brak dodatkowego grantu; (3) błąd/konflikt zapisu ACL → brak komunikatu sukcesu, odczyt rzeczywistego stanu przed ponowieniem; (4) niewłaściwa organizacja → brak rozszerzenia zakresu operatora; (5) nieodświeżone menu → standardowe odświeżenie, bez obchodzenia ochrony URL.

| Krok | Platform readiness | Luka |
|---|---|---|
| Wybór istniejącej roli/operatora | `auth`, istniejący panel ról/użytkowników | Brak |
| Nadanie i zapis uprawnienia | Istniejący ACL, komendy i kontrola zakresu `auth` | Deklaracja `logistics.view` i domyślny grant administracyjny |
| Otwarcie przez operatora | Backend routes, metadata i menu OM | Nowe strony; wspólna luka z WF2 |

### WF2 — Dyspozytor znajduje właściwy obszar przyszłej pracy

**Journey:** zalogowany operator → grupa Logistyka → wybrana strona → czytelny opis funkcji planowanej → powrót do pulpitu lub innej sekcji.

**ROI / miara:** 7/7 obszarów ma jednoznaczne miejsce; każdy dostępny w ≤3 kliknięciach po logowaniu; 0 martwych odsyłaczy i 0 fikcyjnych danych. Mierzymy te warunki w scenariuszach odbioru, bez obietnicy wzrostu wydajności transportu.

**Granice:** początek — potrzeba znalezienia jednego z siedmiu obszarów; koniec — operator odczytał przeznaczenie i stan dostępności; poza przepływem — tworzenie zlecenia, przydział i wyznaczanie trasy.

**Wyjątki:** (1) bezpośredni URL lub odświeżenie → ten sam chroniony ekran; (2) wygasła sesja → standardowe logowanie OM; (3) brak uprawnienia → standardowa odmowa, brak treści strony; (4) mały ekran/klawiatura → istniejące menu mobilne i fokus; (5) brak GPS lub opcjonalnych modułów → wszystkie siedem stron nadal działa, bo nie pobierają danych operacyjnych.

| Krok | Platform readiness | Luka |
|---|---|---|
| Login i kontekst organizacji | `auth` i powłoka OM | Brak |
| Wybór grupy/strony | Auto-discovery + metadane stron | Siedem pozycji w jednej grupie |
| Opis funkcji i powrót | Wspólne UI, i18n, odsyłacze | Statyczna treść siedmiu stron |

### WF3 — Administrator odbiera skuteczny dostęp do Logistyki

**Journey:** decyzja o odebraniu dostępu → sprawdzenie źródeł efektywnego ACL → usunięcie właściwego grantu/przypisania standardowym mechanizmem OM → zapis → kolejny żądany widok jest niedostępny.

**ROI / miara:** 100% kontrolnych kont bez efektywnego `logistics.view` ma odmowę bezpośredniego wejścia i brak grupy po odświeżeniu. Brak nowego procesu administracyjnego lub ręcznego czyszczenia danych transportowych.

**Granice:** początek — decyzja administratora; koniec — zweryfikowana odmowa kolejnego autoryzowanego żądania po skutecznym zapisie ACL; poza przepływem — usunięcie konta, zmiana globalnej semantyki ról i natychmiastowe zdalne wymazanie już wyrenderowanej strony.

**Wyjątki:** (1) pozostaje inna rola lub wildcard → dostęp pozostaje zgodnie z efektywnym ACL, nie zgłaszamy sukcesu odebrania; (2) stara otwarta karta → może zachować statyczny opis, kolejne żądanie jest sprawdzane; (3) administrator zamyka formularz bez zapisu → dostęp bez zmian; (4) konflikt lub błąd sieci przy zapisie → odczyt ACL przed ponowieniem, bez zakładania sukcesu/porażki na podstawie timeoutu; (5) grant roli współdzielonej → standardowa zmiana wpływa na wszystkich jej członków, nie przedstawiamy jej jako zmiany pojedynczej osoby.

| Krok | Platform readiness | Luka |
|---|---|---|
| Sprawdzenie i zmiana ACL | Istniejący `auth`, role i ACL użytkownika | Brak; standardowe reguły OM |
| Zapis i unieważnienie cache uprawnień | Istniejąca ścieżka mutacji `auth` | Brak nowej implementacji |
| Weryfikacja dostępu | Guardy strony i filtrowanie menu | To samo `logistics.view` co WF1/WF2 |

**Reality check:** po implementacji wszystkie trzy przepływy kończą się rzeczywistym wynikiem opisanym wyżej. Firma nie może jeszcze prowadzić transportu na tym fundamencie. Dostępna jest kompletna nawigacja; operacje są jawnie niedostępne i nie można rozpocząć procesu, którego system nie potrafi zakończyć.

#### Checklist
- [x] Trzy przepływy z mierzalnymi kryteriami wartości, granicami, wyjątkami i mapowaniem każdego kroku; bez wyliczania nieudowodnionego ROI finansowego.
- [x] Challenger procesów: brak CRITICAL; poprawiono opis współdzielonej roli. Reality check oddziela gotową nawigację od niewdrożonych operacji.

## 3.5 UI Architecture `PM + UX`

### Navigation / Custom Pages

Jedna nowa grupa **Logistyka** w istniejącym lewym menu. Dokładnie siedem wpisów, w kolejności z S1 §4. „Pojazdy / kierowcy” pozostaje jedną wspólną pozycją. Wszystkie podstrony dostępne dla tej samej persony i uprawnienia z §2.

Adresy poniżej są propozycją nowych stron; nie są deklaracją istniejących tras aplikacji.

| Kolejność | Strona | Proponowany URL | Cel docelowy | Treść strony w pierwszym etapie |
|---|---|---|---|---|
| 1 | Pulpit dyspozytora | `/backend/logistics` | Przegląd przejazdów, zleceń i decyzji | Nagłówek, opis obszaru i odsyłacze do pozostałych sześciu stron |
| 2 | Zlecenia transportowe | `/backend/logistics/transport-jobs` | Operacyjna obsługa przewozów i powiązań Sales | „Obsługa zleceń transportowych jest planowana i nie jest jeszcze dostępna.” |
| 3 | Pojazdy / kierowcy | `/backend/logistics/fleet` | Flota, personel i dostępność | „Kartoteki pojazdów i kierowców są planowane i nie są jeszcze dostępne.” |
| 4 | Przejazdy i trasy | `/backend/logistics/trips` | Przystanki, przydziały i plan przejazdu | „Tworzenie przejazdów i tras nie jest jeszcze dostępne.” |
| 5 | Mapa floty | `/backend/logistics/map` | Pozycje pojazdów z czasem i źródłem pomiaru | „Mapa floty będzie dostępna po uruchomieniu integracji lokalizacji.” |
| 6 | Statystyki | `/backend/logistics/statistics` | Wynik i wykorzystanie floty | „Statystyki będą dostępne po wdrożeniu danych operacyjnych.” |
| 7 | Propozycje i zakłócenia | `/backend/logistics/proposals-disruptions` | Propozycje zmian i zakłócenia | „Obsługa propozycji i zakłóceń jest planowana i nie jest jeszcze dostępna.” |

### Dashboard Widgets / Widget Injections / Portal Pages

N/A w pierwszym etapie. Pulpit jest stroną nawigacyjną, nie zestawem widgetów z fikcyjnymi KPI. Nie zmieniamy globalnego pulpitu OM ani strony po logowaniu. Nie dodajemy wstrzyknięć do Sales ani zewnętrznego portalu.

### Istniejące powierzchnie administratora

To już istniejące strony ustawień Auth, a nie dodatkowe wpisy Logistyki. Nazwy ról są konfigurowalne; strzeżemy funkcji, nie nazw ról.

| Powierzchnia | URL | Wymagane istniejące uprawnienia | Użycie |
|---|---|---|---|
| Lista ról | `/backend/roles` | `auth.roles.list` | Wybór istniejącej roli WF1/WF3 |
| Edycja roli / Access | `/backend/roles/[id]/edit` | `auth.roles.manage`; zapis/odczyt ACL dodatkowo `auth.acl.manage` | Nadanie/odebranie `logistics.view` |
| Lista użytkowników | `/backend/users` | `auth.users.list` | Gdy potrzebna kontrola indywidualnego przypisania |
| Edycja użytkownika | `/backend/users/[id]/edit` | `auth.users.edit`; API ACL dodatkowo `auth.acl.manage` | Istniejące przypisania i indywidualne ACL |

Dowód: metadane odpowiednich stron w `auth/backend/{roles,users}` oraz `auth/api/{roles,users}/acl/route.ts`. Logistyka nie przyznaje tych uprawnień i nie modyfikuje tych stron.

### Key User Flows

Login OM → rozwinięcie Logistyki (jeżeli zwinięta) → wybór strony → zrozumienie przeznaczenia. Najwyżej trzy kliknięcia po zakończeniu logowania. Alternatywnie: pulpit Logistyki → odsyłacz do podstrony. Bezpośredni URL i odświeżenie otwierają ten sam chroniony ekran.

Administrator: istniejący adres/lista ról → edycja wybranej roli → sekcja Access → zapis. Zadanie konfiguracji pozostaje w ustawieniach OM; nie przebudowujemy jego liczby kroków na potrzeby tego fundamentu. Limit ≤3 dotyczy dotarcia operatora do głównego zadania Logistyki, nie całego istniejącego procesu administracyjnego.

### Empty States

Każda strona ma tytuł zgodny z menu, krótki opis, jawny stan „Funkcja planowana” i dostępny powrót do pulpitu. Pulpit informuje: „Panel Logistyki jest przygotowany do rozbudowy. Wybierz sekcję, aby zobaczyć jej przeznaczenie.” Teksty to proponowana polska treść do plików i18n, nie literały w komponentach. Wymagane tłumaczenia według zestawu języków repo.

Brak przycisków „Dodaj”, „Zapisz”, „Wyznacz trasę” lub „Połącz GPS”, skoro ich operacje nie istnieją. Brak fikcyjnych pinów, tabel demonstracyjnych, zerowych liczników zleceń i pozornej aktywności GPS. Zwykłe odsyłacze nawigacyjne działają klawiaturą. Zaznaczenie aktywnej strony, responsywność i nawigacja mobilna korzystają z istniejącej powłoki OM.

#### Checklist
- [x] Siedem stron, kolejność, propozycje adresów i treść stanów określone.
- [x] Główna ścieżka ≤3 kliknięć; brak nowych komponentów operacyjnych.
- [x] Niezależny przegląd UI/DDD: ujednolicono pojęcie zakłócenia i usunięto obietnice wdrożenia wszystkich funkcji w następnym etapie.

## 4. Workflow Gap Analysis `Architect`

Skala skilla: 0 = istniejąca funkcja; 1 = commit konfiguracji; 2 = mała luka 1–2 commitów; 3 = średnia 2–3; 4 = duża 3–5; 5 = 5+ lub zależność zewnętrzna. Wynik skali nie jest liczbą commitów.

| Workflow / krok | Mechanizm | Luka / score | Scope | Atomowe commity |
|---|---|---|---|---|
| WF1 wybór roli/operatora, edycja i zapis ACL | Istniejący `auth` | Brak / 0 | istniejąca platforma | 0 |
| WF1 nowa funkcja i grant domyślny | `acl.ts`, `setup.ts`, standardowy sync | Deklaracja / 1 | app | C1 współdzielony |
| WF1 otwarcie; WF2 wszystkie kroki nawigacji | Metadata, auto-discovery, UI i i18n | Statyczne strony / 2 | app | C1 + C2 współdzielone |
| WF3 sprawdzenie/zmiana ACL, cache | Istniejący `auth` | Brak / 0 | istniejąca platforma | 0 |
| WF3 odmowa na stronach Logistyki | Te same guardy i menu | Pokrycie / 2 | app | C2 współdzielony |

**Suma po deduplikacji:** 2 atomowe commity, nie suma wierszy. C1 dostarcza komplet siedmiu stron, uprawnienie, tłumaczenia i aktywację; C2 testy integracyjne dostępu/nawigacji oraz instrukcję wdrożenia. Oba trafiają do jednego wdrożenia; C1 sam nie spełnia bramki wydania. Szczegóły: [plan commitów](app-spec-notes/logistics-commits.md).

| Workflow | Priorytet | Nowy kod | Obejście / blokada ROI |
|---|---|---|---|
| WF1 | Warunek dostępu | Tylko deklaracje C1 | Bez obejść i zmian platformy |
| WF2 | Główna wartość etapu | Statyczne strony C1, weryfikacja C2 | Brak zależności zewnętrznych |
| WF3 | Warunek bezpiecznego wydania | Wspólne guardy C1, weryfikacja C2 | Nie zmieniamy istniejącej semantyki ACL |

Nie ma luk typu `platform`, więc badanie upstream przez tracker nie jest potrzebne. Checkpoint #1: PASS po uściśleniu istniejącej aktywacji i komponentów strony; [wynik](app-spec-notes/architect-logistics-checkpoints.md).

## 4.5 Module Architecture `Architect`

Jeden moduł aplikacyjny `logistics` w `apps/mercato/src/modules/logistics/`. Odpowiedzialność pierwszego etapu: strony, metadane, ACL, tłumaczenia. Żadnych encji. Rejestracja jako `{ id: 'logistics', from: '@app' }` w istniejącym `enabledModules` w `apps/mercato/src/modules.ts`. To zmiana konfiguracji aktywacji; cała nowa implementacja pozostaje wewnątrz modułu. Bez zmian powłoki aplikacji.

**Reuse:** backend OM; automatyczne odkrywanie stron; metadane `pageGroupKey`, `pageTitleKey`, `pageOrder`; standardowe `requireAuth` / `requireFeatures`; deklaracja `acl.ts` i `setup.ts`; `Page`, `PageHeader`, `PageBody` z `@open-mercato/ui/backend/Page` oraz opcjonalnie `EmptyState` z `@open-mercato/ui/primitives/empty-state` z jawną treścią o funkcji planowanej. Nie potrzeba menu injection ani nowego wspólnego komponentu dla zwykłych nowych stron modułu.

`resources`, `staff`, `planner`, `sales`, GPS i komponenty agentowe nie są zależnościami uruchomienia tego fundamentu. Nie włączamy modułów tylko dlatego, że wspomina je docelowa koncepcja. Implementacja funkcji dostępnych wyłącznie w Enterprise wymaga późniejszej osobnej specyfikacji we właściwym katalogu.

## 5. User Stories `PM`

### US1 — Nadać dostęp (WF1)

Jako administrator wewnętrzny z efektywnymi `auth.roles.list`, `auth.roles.manage` i `auth.acl.manage` nadaję istniejącej roli operatora `logistics.view`, aby udostępnić siedem stron bez zmiany kodu. **Powierzchnia:** istniejące role/ACL OM opisane w §3.5; odbiór na pulpicie.

**Sukces:** zapisane efektywne ACL daje dostęp do 7/7 URL; brak dodatkowych uprawnień mutacji. **Happy:** wybór właściwej roli i kontekstu → zapis grantu → operator odświeża menu i otwiera pulpit. **Alternate:** grant istnieje przez rolę/wildcard → bez zmiany ACL operator od razu korzysta z panelu; nowy tenant otrzymuje domyślny grant administratora przez setup, istniejący przez standardowy sync. **Failure:** brak prawa zarządzania lub błędny zakres → odmowa i brak zmiany; konflikt zapisu → standardowy konflikt, odczyt bieżącego ACL przed ponowieniem; timeout → wynik zapisu nieznany do ponownego odczytu. Zamknięcie formularza przed zapisem nie zmienia ACL. Zmiana roli obejmuje wszystkich jej członków — to nie indywidualny grant.

### US2 — Otworzyć właściwą sekcję (WF2)

Jako dyspozytor wewnętrzny z `logistics.view` otwieram wybrany obszar, aby rozpoznać miejsce przyszłej pracy w ≤3 kliknięciach po logowaniu. **Powierzchnia:** siedem stron §3.5.

**Sukces:** 7/7 nazw, opisów i odsyłaczy zgodnych z tabelą; brak pozornej funkcjonalności transportowej. **Happy:** menu → strona → opis „Funkcja planowana” → powrót. **Alternate:** zakładka przeglądarki, odświeżenie lub odsyłacz pulpitu otwierają ten sam ekran; klawiatura i menu mobilne prowadzą do tych samych celów. **Failure:** wygasła sesja → standardowe logowanie; brak uprawnienia → standardowa odmowa; błąd pobrania strony → standardowy błąd aplikacji i możliwość ponowienia, bez sukcesu ani zmiany domeny. Zamknięcie karty nie zostawia draftów ani rezerwacji. Brak opcjonalnych integracji nie jest błędem tych statycznych stron.

### US3 — Zweryfikować odebranie dostępu (WF3)

Jako administrator wewnętrzny odbieram efektywny dostęp standardowym ACL, aby konto bez uprawnienia nie mogło otworzyć żadnej z siedmiu stron. **Powierzchnia:** istniejące ACL OM oraz próba wejścia na stronę §3.5.

**Sukces:** po zakończonym zapisie bez efektywnego grantu kolejny request strony otrzymuje odmowę, a odświeżone menu nie zawiera grupy. **Happy:** sprawdzenie źródeł ACL → usunięcie właściwego grantu/przypisania → zapis → weryfikacja URL i menu. **Alternate:** inne źródło uprawnienia pozostaje → dostęp poprawnie pozostaje; administrator sprawdza to źródło w istniejącym OM. **Failure:** konflikt/timeout zapisu → rzeczywisty stan wymaga odczytu, nie twierdzimy, że dostęp odebrano; brak prawa administratora → bez zmiany; zamknięcie bez zapisu → poprzedni stan. Nie usuwamy danych użytkownika ani jego innych uprawnień dla uzyskania wyniku tego testu.

### US4 — Zachować właściwy kontekst po zmianie organizacji (WF2, kontrola WF1/WF3)

Jako dyspozytor wewnętrzny zmieniam organizację istniejącym przełącznikiem OM, aby panel respektował aktualny zakres dostępu. **Powierzchnia:** istniejący przełącznik powłoki i strony §3.5.

**Sukces:** w każdym docelowym kontekście wynik odpowiada jego efektywnym uprawnieniom, bez przenoszenia decyzji dostępu z poprzedniego zakresu. **Happy:** organizacja dozwolona i skuteczne ACL → ten sam statyczny panel w nowym kontekście. **Alternate:** dozwolona organizacja bez efektywnego grantu → odmowa Logistyki; jeden dostępny zakres → standardowy stan powłoki, bez nowego przełącznika. **Failure:** niedozwolony zakres → standardowa odmowa OM; timeout/błąd zmiany → wynik ustala standardowy odczyt sesji OM, do tego czasu nie przedstawiamy docelowej organizacji jako skutecznie wybranej; wygaśnięcie sesji → logowanie. Nie wprowadzamy logistycznej implementacji sesji ani cache.

### Cross-story impact matrix

| Historia | Stan zmieniany | Kogo dotyczy / wzorzec konfliktu | Rozstrzygnięcie |
|---|---|---|---|
| US1 | Istniejący ACL roli/użytkownika | US2–4; grant równocześnie z odebraniem US3 | Istniejąca chroniona ścieżka zapisu ACL; odczyt po konflikcie; guardy używają aktualnego efektywnego ACL |
| US2 | Tylko URL i stan prezentacji w przeglądarce | US3/US4; otwarta karta ma stare przesłanki | Kolejny request ponownie autoryzowany; nie ma domenowego zapisu do cofania |
| US3 | Istniejący ACL/przypisanie | US1/US2/US4; utrata dostępu, wildcardy, współdzielona rola | Inwalidacja przez standardowy `auth`; brak obietnicy zdalnego wymazania statycznej karty; inne granty uwzględnione |
| US4 | Aktywny zakres sesji OM | US1–3; decyzja dostępu z poprzedniej organizacji | Następny autoryzowany request używa rzeczywiście aktywnego kontekstu i efektywnego ACL, także po równoczesnej zmianie obu; późna odpowiedź dla poprzedniego zakresu nie potwierdza dostępu w nowym. Brak logistycznego cache |

Brak nowego stanu transportowego, zdarzeń logistycznych, kaskad i osieroconych encji. Nie emitujemy zdarzeń biznesowych za samo wyświetlenie strony. Zmiany ACL zachowują istniejące skutki uboczne i audyt `auth`. Błąd ACL nie wymaga kompensacji transportowej, bo żadna operacja transportowa nie zaszła.

**Default stories skilla:** konta/dane demo N/A. Ten fundament nie potrzebuje seedowania ładunków lub kierowców; tests tworzą i sprzątają własne konta/role/organizacje. Nie dodajemy przykładowych użytkowników z hasłami do produkcyjnego setup.

#### Checklist
- [x] Cztery historie mają personę, powierzchnię, mierzalny sukces, ścieżkę poprawną, alternatywną i błędy ze stanem po niepowodzeniu.
- [x] Macierz pokrywa wszystkie historie; brak niezdefiniowanych zdarzeń i mutacji transportowych.
- [x] Niezależny challenger historii: brak CRITICAL; doprecyzowano nieznany wynik zmiany kontekstu i równoczesność US1/US3 × US4.

## 6. User Story Gap Analysis `Architect`

Drabina: istniejąca funkcja → konfiguracja → sankcjonowane rozszerzenie → workflow/notifications → nowy kod. Zatrzymujemy się na pierwszym pokryciu; strony są nową treścią przez istniejące rozszerzenie modułowe, nie nowym systemem UI.

| Historia | Pierwsze pasujące pokrycie | Konkretny mechanizm | Score / commity |
|---|---|---|---|
| US1 | Funkcja + konfiguracja | `auth` role/ACL, deklaracja nowego `logistics.view`, `defaultRoleFeatures` | 1; C1 + wspólna walidacja C2 |
| US2 | Sankcjonowane rozszerzenie | Backend pages i metadata, i18n, standardowe UI | 2; C1 + C2 |
| US3 | Istniejąca funkcja | ACL `auth`, te same guardy `requireFeatures` | 0 nowej logiki; wspólne C1/C2 |
| US4 | Istniejąca funkcja | Przełącznik organizacji, autoryzacja OM | 0 nowej logiki; wspólna walidacja C2 |

Łącznie nadal **2 commity**, identyczne z §4; nie 2 na historię. Żadna historia nie wymaga ≥3 commitów, nowego workflow, powiadomień ani usługi integracyjnej. Plan: [logistics-commits.md](app-spec-notes/logistics-commits.md). Checkpoint #2: PASS po uzupełnieniu istniejących powierzchni i pełnych uprawnień administratora; [wynik](app-spec-notes/architect-logistics-checkpoints.md).

## 7. Phasing & Rollout `PM`

### Etap 1 — Fundament Logistyki

**Cel:** kompletna nawigacja po siedmiu opisanych sekcjach. Wartość: wspólna, możliwa do obejrzenia struktura dalszej aplikacji. Nie jest to produkcyjny workflow przewozu ani oszczędność operacyjna potwierdzona pomiarem.

**Kryteria biznesowe odbioru PM (do spełnienia przez przyszłą implementację):**

- [ ] Jedna grupa Logistyka, dokładnie siedem pozycji zgodnych z §3.5, bez duplikatów.
- [ ] Każdy URL działa po kliknięciu, wejściu bezpośrednim i odświeżeniu; nazwa strony odpowiada pozycji menu.
- [ ] Pulpit prowadzi do sześciu pozostałych stron; każda ma opis przyszłej funkcji i drogę powrotu.
- [ ] Dostępna funkcja jest odróżniona od planowanej; nie ma fikcyjnych danych ani operacji zapisu.
- [ ] Użytkownik z uprawnieniem odczytu otwiera strony; bez uprawnienia nie widzi grupy i nie omija ochrony przez URL.
- [ ] Uprawnienia wildcard zachowują standardowe zachowanie OM; wygaśnięcie sesji korzysta z istniejącego logowania.
- [ ] Zmiana organizacji zachowuje kontekst i kontrolę uprawnień OM.
- [ ] Obsługa klawiaturą oraz istniejąca mobilna nawigacja umożliwiają dostęp do wszystkich stron.
- [ ] Tłumaczenia, standardowe komponenty i tokeny DS; pozostałe grupy menu działają bez zmiany zachowania.
- [ ] Etap działa bez GPS, modułów operacyjnych i agentów; brak nowych tabel, endpointów i mutacji domenowych.

**Kryteria domenowe — napisane przez niezależnego challengera DDD:**

- [ ] DDD1: jedna grupa, siedem sekcji w ustalonej kolejności; Pojazdy / kierowcy pozostaje jedną sekcją.
- [ ] DDD2: nazwa strony odpowiada menu, opis odpowiada słownikowi; zamówienie handlowe / zlecenie transportowe i trasa / przejazd nie są utożsamiane; stan funkcji jest jawny.
- [ ] DDD3: brak implementacji nie jest przedstawiony jako brak rekordów, zero KPI lub działający monitoring; brak niewdrożonych operacji transportowych.
- [ ] DDD4: wszystkie siedem adresów i menu korzystają z tego samego efektywnego `logistics.view`; wildcardy i odebranie ostatniego źródła działają według OM.
- [ ] DDD5: kolejne autoryzowane wejście po zmianie organizacji odpowiada aktualnemu kontekstowi i ACL, także gdy ACL zmienia się równocześnie.
- [ ] DDD6: nawigacja/odświeżenie/ponowienie/zamknięcie nie tworzą ani nie zmieniają danych transportowych; strony działają bez opcjonalnych integracji.

**PM challenge:** wszystkie sześć kryteriów przyjęto, ponieważ chronią zakres, uczciwość interfejsu i dostęp. DDD2/DDD3 nie oznaczają nakazu budowy modeli lub KPI, a DDD5 nie wymaga nowego mechanizmu sesji ani natychmiastowego usunięcia statycznej treści otwartej karty. Transakcje rezerwacji, zdarzenia transportowe, silnik tras i audyt GPS nie są kryteriami tego wydania. Weryfikacja DDD4/DDD5 wykorzystuje standardowe mechanizmy OM. Uzasadnienie i autorstwo: [przegląd historii i role reversal](app-spec-notes/challenger-logistics-stories.md).

**Atomowe commity:** C1 + C2 = 2, jedno wdrożenie wszystkich trzech przepływów i czterech historii. Mała luka i brak zewnętrznych zależności uzasadniają kolejność przed funkcjami operacyjnymi. To estymacja fundamentu, nie całego systemu transportowego.

**Rollout:** włączyć moduł w środowisku testowym → `yarn generate` → `yarn mercato auth sync-role-acls` dla istniejących instalacji → `yarn mercato configs cache structural --all-tenants` → przetestować izolowane role → udostępnić wybranej roli operatora. To instrukcja przyszłego wdrożenia, nie polecenia wykonane podczas pisania specyfikacji. Nie zmieniać globalnego landing page. Ewentualne wycofanie: standardowo wyłączyć moduł i odświeżyć generowane rejestry/cache; brak danych logistycznych do migracji lub usuwania. Uprawnienia innych modułów pozostają bez zmian.

### Kierunek dalszy — poza zleceniem implementacyjnym

Przyszłe rozszerzenie App Spec powinno opisać kompletny przebieg zlecenie → ręczny plan → przydział → wykonanie, następnie monitoring i statystyki oraz uzasadnione automatyzacje. Są to kierunki, nie oszacowane ani zlecone fazy bieżącego wydania. Dalsze decyzje muszą uwzględnić realne dane floty i potwierdzić zasadność przyjętego celu biznesowego. Widoczność sekcji w menu nie zobowiązuje do wdrażania funkcji w kolejności menu.

## 8. Cross-Spec Conflicts `PM`

| Rozbieżność | Rozstrzygnięcie |
|---|---|
| S1/S2 rozpoczynają rozwój od procesów agentowych, użytkownik chce menu | Bieżący pierwszy etap to fundament nawigacji; procesy pozostają kontekstem przyszłości |
| S1 pokazuje „Pojazdy / kierowcy” razem | Jedna strona i wpis; nie rozszerzamy samodzielnie do ośmiu sekcji |
| Zamówienie Sales mylone ze zleceniem transportowym | Rozdzielone pojęcia w słowniku; teraz nie kopiujemy ani nie tworzymy rekordów |
| Specyfikacje WMS zawierają „logistykę” | Magazyn/zwroty mają inny zakres; ten fundament nie modyfikuje WMS |

## 9. Reference App Quality Gate `Architect`

N/A — nie zamówiono aplikacji referencyjnej. Obowiązują ponowne użycie mechanizmów OM, brak kopiowania powłoki, helperów auth i osobnego runnera testów. Nie usuwamy istniejących modułów demonstracyjnych ani nie porządkujemy repo poza zakresem.

## 10. Open Questions `PM`

Brak pytań blokujących ten zakres. Użytkownik zlecił autonomiczne przyjęcie założeń; poniżej zapis decyzji, a nie fikcyjne odpowiedzi biznesowe użytkownika.

| ID | Rozstrzygnięcie | Wpływ | Właściciel | Status |
|---|---|---|---|---|
| A1 | Klienci płacą własnej firmie za przewóz | Narzędzie wewnętrzne, brak SaaS billing | Autor App Spec na upoważnienie użytkownika | Przyjęte założenie |
| A2 | Mniej pustych km poprawia wynik i zdolność obsługi klientów | Kierunek przyszłego produktu | Autor App Spec | Przyjęte założenie |
| A3 | Cel przyszłego planowania: względny spadek udziału pustych km o 10%, pomiar §1.2 | Nie jest kryterium dostarczenia fundamentu | Autor App Spec | Hipoteza do pomiaru w przyszłym produkcie, nie blocker |
| A4 | Menu i siedem stron bez operacji, GPS i agentów | Minimalny, kompletny fundament | Autor App Spec | Przyjęte zgodnie z poleceniem |
| A5 | Jedna wspólna strona Pojazdy / kierowcy | Siedem wpisów, nie osiem | Autor App Spec | Przyjęte wprost z S1 §4 |

## Production Readiness `PM`

| Obszar | Gotowy do wdrożenia | Blokada | Perspektywa użytkownika |
|---|---|---|---|
| WF1 — nadanie dostępu do Logistyki | Nie | Brak implementacji deklaracji/stron i testów | „Mam gotowy opis sposobu udostępnienia panelu.” |
| WF2 — nawigacja siedmiu stron | Nie | Brak implementacji i testów | „Mam specyfikację struktury, ale jeszcze nie działający panel.” |
| WF3 — odebranie dostępu do Logistyki | Nie | Brak nowych stron do weryfikacji guardów | „Kontrola dostępu jest zaprojektowana, nie przetestowana na tym module.” |
| Realizacja transportu | Nie | Świadomie poza pierwszym etapem | „Nie mogę jeszcze przyjąć i wykonać przewozu w tym panelu.” |

## API Contracts / Migration & Backward Compatibility

Pierwszy etap nie dodaje API, encji, migracji ani zdarzeń transportowych. Nowe adresy stron i ACL są planowanymi dodatkami. Nie zmieniamy istniejących URL, ID uprawnień, punktów rozszerzeń ani zachowania innych modułów. Przejrzano `BACKWARD_COMPATIBILITY.md`: pozostają standardowe konwencje odkrywania, nowe ID i strony są addytywne, brak deprecjacji. Brak edytowalnych encji oznacza brak zastosowania optimistic locking dla Logistyki w tym etapie, nie wyjątek dla późniejszych CRUD ani dla istniejących zapisów ACL.

## Validation / Risks & Impact Review

Plan pokrycia integracyjnego przyszłego etapu: 7/7 stron (menu, URL, odświeżenie), dozwolony i zabroniony dostęp, wildcard ACL, sesja wygasła, zmiana organizacji, nawigacja mobilna/klawiatura, aktywna pozycja menu, i18n, regresja istniejącego menu. Fixtures użytkowników/organizacji tworzone przez setup i sprzątane przez teardown; bez zależności od demo. Brak nowych ścieżek API do objęcia testami.

| ID pokrycia | Historie | Sprawdzany wynik |
|---|---|---|
| LOG-01 | US2 | Każda z siedmiu tras: menu, wejście bezpośrednie, odświeżenie, właściwy tytuł i stan planowanej funkcji |
| LOG-02 | US1/US2 | Grant dokładny i wildcard zapewniają dostęp; brak grantu daje standardową odmowę i brak menu |
| LOG-03 | US3 | Odebranie ostatniego efektywnego grantu blokuje następne żądanie; pozostawiony wildcard zachowuje dostęp |
| LOG-04 | US4 | Zmiana zakresu organizacji sprawdza bieżące skuteczne ACL; niedozwolony zakres nie daje dostępu |
| LOG-05 | US2 | Wygaśnięcie sesji, klawiatura, mobilne menu, powrót, aktywna pozycja, brak martwych linków |
| LOG-06 | US1/US3 | Brak `auth.acl.manage`, konflikt/nieznany wynik zapisu nie są przedstawiane jako sukces; istniejące mechanizmy i fixtures `auth` |
| LOG-07 | US2 | Działanie bez GPS/Enterprise/modułów operacyjnych, i18n i regresja istniejącej nawigacji; brak wywołań nieistniejących API |

Testy dodawane w module `__integration__`, wspólne helpery `@open-mercato/core/helpers/integration/*`, istniejący runner projektu; żadnej kopii konfiguracji Playwright. Dla reuse `auth` można wykorzystać już istniejące testy kontraktów i dołożyć weryfikację nowej funkcji, zamiast przepisywać cały zestaw testów auth.

Przy implementacji: wybrać runner zgodnie z `.ai/docs/agent-instructions.md`; uruchomić generatory po dodaniu stron, właściwe kontrole i18n/typecheck/build i testy UI oraz standardowe odświeżenie cache strukturalnego. Ten dokument nie jest raportem ich wykonania. Dla bieżącej zmiany dokumentacyjnej wystarcza kontrola treści i diffu.

| Ryzyko | Waga / obszar | Ograniczenie | Pozostałe ryzyko |
|---|---|---|---|
| Puste strony uznane za działającą logistykę | Wysoka / produkt | Jawne „Funkcja planowana”, brak fikcyjnych KPI i przycisków zapisu | Fundament nie dostarcza jeszcze wartości operacyjnej |
| Ochrona tylko menu, URL pozostaje otwarty | Wysoka / dostęp | Deklaratywne guardy i test bezpośredniego wejścia | Weryfikacja dopiero po implementacji |
| Podwojenie kartotek floty/personelu przy rozbudowie | Średnia / dane | Właściciele danych i słownik z S1 zachowane | Przyszły model wymaga osobnej analizy |
| Uzależnienie fundamentu od API lub Enterprise | Średnia / dostarczenie | Brak tych zależności w etapie 1 | Dostępność pozostaje pytaniem dla późniejszych funkcji |

## Final Compliance Report / Handoff

- [x] Dokument utworzony w skonfigurowanym `.ai/specs` na podstawie szablonu App Spec i lokalnych źródeł.
- [x] Zakres UI opisany konkretnie; kod, feature specs, migracje i integracje nie powstały.
- [x] Phase 0: jawne założenia zgodnie z późniejszym upoważnieniem użytkownika; niezależny challenger i poprawki.
- [x] Phase 1: trzy przepływy fundamentu, mierzalne kryteria wartości, reality check, challenger i architect checkpoint #1.
- [x] Phase 2–3: cztery historie, macierz wpływu, challenger i architect checkpoint #2; poprawki zastosowane.
- [x] Phase 4: jedno kompletne wydanie, dwa atomowe commity, kryteria DDD napisane przez reviewera i challenge PM.
- [x] Końcowy challenger rollout i spójności dokumentu: brak CRITICAL, poprawiono jeden termin zgodnie ze słownikiem; [wynik](app-spec-notes/challenger-logistics-rollout.md).
- [x] Phase 5: podsumowanie i granica dalszej pracy określone. Na polecenie użytkownika nie oczekujemy na kolejne potwierdzenie i nie rozpoczynamy niezamówionej implementacji.

**Podsumowanie:** 7 nowych stron; 3 przepływy fundamentu (udostępnienie, użycie, odebranie); 4 historie; 1 faza wdrożenia; szacunek 2 atomowych commitów. Nowe encje/API/integracje: 0. Checkpointy architekta #1/#2: PASS po zastosowaniu korekt. Challengery kontekstu, procesów/UI, historii i rollout: zakończone, brak nierozwiązanych CRITICAL/WARNING. Otwarte blokery biznesowe fundamentu: 0; A1–A5 są jawnymi założeniami, nie potwierdzonymi pomiarami rynku.

**Weryfikacja artefaktu:** lokalna kontrola dokumentacji: siedem wpisów menu, trzy przepływy, cztery historie, sześć kryteriów DDD, poprawne lokalne odsyłacze i `git diff --check`. Testów aplikacji, generatorów ani wdrożenia nie wykonywano, ponieważ zmiana zawiera wyłącznie dokumenty. Checkboxy odbioru implementacji pozostają celowo otwarte.

**Handoff do ewentualnej dalszej pracy:** jedna samodzielna capability „Fundament nawigacji Logistyki” obejmująca cały etap 1, wszystkie siedem stron i testy. Nie dzielić na siedem niezależnych feature specs ani dodawać encji transportowych. Dekompozycja przez `om-spec-writing` i kod nie są artefaktami tej specyfikacyjnej pracy. Późniejsza zmiana zakresu wymaga aktualizacji tego App Spec i Changelogu.

## Changelog

### 2026-09-19
- Powiązano rozszerzenie operacyjne po potwierdzeniu modelu własnej floty, celu ograniczenia pustych kilometrów i ręcznego dispatchu; skorygowano status fundamentu zgodnie z zapisanym raportem weryfikacji.
- Utworzono szkic z siedmioma sekcjami S1 i minimalnym pierwszym etapem zgodnym z poleceniem użytkownika.
- Po poleceniu autonomicznego zakończenia zastąpiono oczekiwanie na odpowiedzi jawnymi założeniami A1–A5.
- Uzupełniono przepływy, historie i macierz wpływu, mapowanie do platformy, estymację i kryteria odbioru.
- Przeprowadzono niezależne przeglądy kontekstu, procesów/UI, historii oraz dwa checkpointy architekta; zastosowano poprawki dostępu i stanu po błędach.
- Zakończono niezależny przegląd rollout, ujednolicono termin „zamówienie handlowe” i ukończono specyfikację bez rozszerzania zadania na kod.
