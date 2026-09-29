# Glosariusz PL — interfejs Paperclipa

Obowiązuje w `pl.json`, w nadpisaniach modułów i w promptach tłumacza (`translator/translate.ts`
wczytuje ten plik). Zmieniasz termin → zmień go tutaj i w istniejących wpisach `pl.json`.

## Zasady ogólne

- Poprawna polszczyzna, zawsze z polskimi znakami.
- Przyciski i akcje w trybie rozkazującym: „Zapisz”, „Utwórz zadanie”, „Wyczyść filtry”.
- Nagłówki, etykiety pól i nazwy sekcji jako rzeczowniki: „Priorytet”, „Ustawienia”, „Ostatnia aktywność”.
- Stany w toku z wielokropkiem jak w oryginale: „Zapisywanie...” / „Zapisywanie…” (zachowaj ten sam znak: `...` albo `…`).
- Wielkie litery tylko na początku (polski nie stosuje Title Case): „Pending Approvals” → „Oczekujące akceptacje”.
- Nie tłumaczymy nazw własnych i produktów: Paperclip, Claude, Codex, Cursor, GitHub, Slack, Stripe, Vercel, OpenClaw, Hermes.
- Nie tłumaczymy identyfikatorów, kodów, poleceń i wartości API (`in_progress`, `COD-12`, `pnpm build`).
- Fragmenty zdań obok dynamicznych wartości (`{count} tasks`) wymagają kluczy przypiętych do pliku
  (`"src/pages/Foo.tsx::tasks"`) — polska odmiana zależy od liczby i szyku zdania.

## Terminy

| English | Polski | Uwagi |
|---|---|---|
| task / issue | zadanie | UI używa „Tasks”; w API i URL-ach nadal `issues` |
| sub-task / sub-issue | podzadanie | |
| agent | agent | l.mn. „agenci” |
| organization / company | organizacja | upstream zastąpił „company” słowem „organization” |
| project | projekt | |
| goal | cel | |
| routine | rutyna | cykliczne zadanie agenta |
| approval | akceptacja | „Approve” → „Zatwierdź”, „Reject” → „Odrzuć” |
| approver | zatwierdzający | |
| reviewer | recenzent | |
| assignee | wykonawca | |
| responsible | odpowiedzialny | |
| board (rola człowieka) | właściciel | w widoku kanban „board view” → „widok tablicy” |
| heartbeat | heartbeat | cykl pracy agenta; nie tłumaczymy |
| run | uruchomienie | „Run now” → „Uruchom teraz” |
| skill | umiejętność | |
| adapter | adapter | |
| connector | konektor | |
| workspace | przestrzeń robocza | |
| inbox | skrzynka | |
| dashboard | pulpit | |
| settings | ustawienia | |
| costs / spend | koszty / wydatki | |
| budget | budżet | |
| activity | aktywność | |
| audit | audyt | |
| org chart | struktura organizacyjna | w menu skrót „Struktura” |
| artifact | artefakt | |
| decision | decyzja | |
| case | sprawa | |
| pipeline | potok | |
| secret | sekret | |
| plugin | wtyczka | |
| watchdog | strażnik | agent pilnujący postępu pracy |
| automation | automatyzacja | |
| usage | zużycie | |
| effort (reasoning) | poziom rozumowania | |
| Loading… | Wczytywanie… | nie „Ładowanie” |
| job (workspace, one-shot) | polecenie jednorazowe | obok „usługi” (services); nie „zadanie” |
| job (plugin, scheduled) | zadanie w tle | |
| checkout (git) | kopia robocza | |
| harness | silnik | Claude Code / Codex / Cursor jako środowisko agenta |

## Statusy zadań

| English | Polski |
|---|---|
| Backlog | Backlog |
| Todo / To Do | Do zrobienia |
| In Progress | W toku |
| In Review | W przeglądzie |
| Blocked | Zablokowane |
| Done | Gotowe |
| Cancelled | Anulowane |

## Czas względny (nadpisanie `src/lib/timeAgo.ts`)

„przed chwilą”, „5 min temu”, „3 godz. temu”, „1 dzień temu” / „4 dni temu”, „2 tyg. temu”,
„3 mies. temu”. Skróty jednostek omijają polskie formy liczby mnogiej.
