# D01–D04 — cięcie zakresu do szkieletu panelu spedytora

- Date, owner: 2026-09-19, Julia Jakubowska (odpowiedzi w sesji om-discover, pytania zadane przez agenta)
- Context and the options weighed:
  - D01 stare 7 stron modułu `logistics`: (a) skasować strony, zostawić lib/api/agentów [rekomendacja agenta]; (b) zostawić obok 2 nowych zakładek; (c) skasować cały moduł i zacząć od zera.
  - D02 Order 2: (a) pola na tym samym zamówieniu [rekomendacja agenta]; (b) osobny rekord zamówienia powiązany z Order 1; (c) ustalenie zespołu.
  - D03 zakładka „AI Inbox / Offers”: (a) placeholder [rekomendacja agenta]; (b) tabela ofert; (c) link do wbudowanego `inbox_ops`.
  - D04 zakres = menu 2 pozycje + tabela przewozów + ekran szczegółów (z wiadomości Julii i szkicu tablicy).
- Decision and why: D01 = (c), D02 = (b), D03 = (c), D04 jak wyżej. Julia odrzuciła wszystkie trzy rekomendacje agenta; powody zapisane w tabeli Decisions briefu.
- Consequences, and what would make us revisit it: kasacja fundamentu Łukasza Wacławka wymaga potwierdzenia zespołu (Q01); powiązanie dwóch zamówień polem dodatkowym do sprawdzenia pierwszego dnia (A02).
- Status: active
