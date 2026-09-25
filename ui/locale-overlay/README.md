# Nakładka językowa UI (PL)

Polska wersja interfejsu Paperclipa bez przepisywania komponentów upstreamu.
Wtyczka Vite w czasie builda podmienia angielskie teksty w `ui/src/**/*.tsx` na tłumaczenia
ze słownika `pl.json`, którego kluczem jest angielski oryginał. Kod upstreamu zostaje
nietknięty, więc `git merge upstream/master` nie daje konfliktów z tłumaczeniami.

Jedyna zmiana w pliku upstreamu: rejestracja wtyczki w `ui/vite.config.ts` (import + wpis
w `plugins`). Bez zmiennej `PAPERCLIP_UI_LOCALE` wtyczka jest wyłączona i build jest
identyczny z upstreamem.

## Uruchomienie

```sh
# podgląd na żywo (proxy do serwera na :3100)
cd ui && PAPERCLIP_UI_LOCALE=pl pnpm dev

# build produkcyjny UI po polsku
pnpm --filter @paperclipai/plugin-sdk build
PAPERCLIP_UI_LOCALE=pl pnpm --filter @paperclipai/ui build
```

Serwer serwuje zbudowane UI z `ui/dist` (monorepo) albo `server/ui-dist` (pakiet npm).
Oficjalny `npx paperclipai` ma UI wbudowane, więc wersję PL uruchamia się z tego forka.

## Co jest tłumaczone

Tylko teksty wyświetlane, które mają dokładne dopasowanie w słowniku:

- tekst w JSX (`<button>Save</button>`),
- atrybuty z allowlisty: `placeholder`, `title`, `aria-label`, `alt`, `label`, `description`
  (+ kilka propsów konkretnych komponentów w `ELEMENT_DISPLAY_ATTRIBUTES`),
- stringi renderowane jako dziecko JSX (`{ok ? "Yes" : "No"}`),
- etykiety `setBreadcrumbs([{ label: "..." }])` — nagłówki stron i tytuł karty,
- całe moduły `.ts` z tekstem budowanym w kodzie, przez nadpisania w `modules/pl/`
  (dziś `src/lib/timeAgo.ts` → „5 min temu”).

Nigdy nie są dotykane: `src/api/**`, testy i stories, pliki i poddrzewa, których nazwa wskazuje na
prompty, instrukcje, szablony albo konfigurację adapterów, oraz `<code>`, `<pre>`, `<textarea>`
i `<option>` bez `value`. Zasada maintainera upstreamu: teksty lokalizacji są wyłącznie do
wyświetlania i nie mogą trafić do promptów, instrukcji agentów, wywołań narzędzi, treści zadań,
akceptacji ani konfiguracji adapterów.

## Dodawanie tłumaczeń

1. `node cli/node_modules/tsx/dist/cli.mjs ui/locale-overlay/scan.ts --top 50` — pokrycie,
   najczęstsze nieprzetłumaczone teksty, nieaktualne klucze, rozjazdy nadpisań.
2. Dopisz wpisy do `pl.json` zgodnie z `GLOSSARY.md`.
   - Globalnie: `"Save changes": "Zapisz zmiany"`.
   - Dla jednego pliku (niejednoznaczne słowa, fragmenty obok `{count}`):
     `"src/pages/Issues.tsx::tasks": "zadań"`.
3. `node cli/node_modules/tsx/dist/cli.mjs ui/locale-overlay/validate.ts` — te same reguły co
   `ui/src/i18n/locale-validation.ts` (placeholdery, brak HTML i nowych URL-i, limit długości)
   plus kontrola nadpisań modułów.
4. `pnpm --filter @paperclipai/ui exec vitest run locale-overlay`.

Tłumaczenie maszynowe (Claude API, oficjalne SDK, osobny pakiet spoza workspace'u pnpm):

```sh
cd ui/locale-overlay/translator && npm ci
ANTHROPIC_API_KEY=... npm run translate -- --max 300 [--dry-run]
```

Model domyślny to `claude-opus-5` z serwerowym fallbackiem przy odmowie. Zmienisz go przez
`LOCALE_TRANSLATOR_MODEL`, np. `claude-sonnet-5`, jeśli wolisz niższy koszt.
Wynik przechodzi przez walidator; odrzucone tłumaczenia są wypisywane i nie trafiają do słownika.

## Nadpisania modułów

`modules/pl/src/lib/timeAgo.ts` zastępuje `src/lib/timeAgo.ts`. Pierwsza linia pliku to
`// overlay-upstream-sha256: <hash>` — SHA-256 wersji upstreamu, na podstawie której powstało
nadpisanie. Gdy upstream zmieni plik, hash przestaje się zgadzać: wtyczka serwuje wtedy
oryginał (po angielsku, ale poprawny), a `validate.ts` i `scan.ts` zgłaszają rozjazd.
Po przeniesieniu zmian zaktualizuj hash: `shasum -a 256 ui/src/lib/timeAgo.ts`.

## Synchronizacja z upstreamem

Workflow `.github/workflows/pl-sync.yml` (codziennie i ręcznie):

1. merge `paperclipai/paperclip@master` do gałęzi `pl-sync` wyciętej z `pl`
   (konflikt → issue z etykietą `pl-sync-conflict`, bez forsowania),
2. tłumaczenie nowych tekstów (tylko gdy ustawiony jest sekret `ANTHROPIC_API_KEY`),
3. walidacja, testy nakładki, build UI po polsku,
4. PR `pl-sync` → `pl` do przeglądu.

Na forku trzeba raz włączyć Actions (zakładka Actions) — GitHub domyślnie wyłącza workflowy
i harmonogramy na forkach. PR-y tworzone tokenem `GITHUB_TOKEN` nie uruchamiają innych
workflowów; jeśli chcesz CI upstreamu na PR-ach synchronizacji, użyj tokenu GitHub App albo PAT.

## Ograniczenia

- Teksty w plikach `.ts` (mapy statusów, toasty, etykiety wykresów) — tylko przez nadpisania modułów.
- Teksty sklejane z wartości (`{n} running`) — wyłącznie klucze przypięte do pliku; polska
  odmiana liczebników (`Intl.PluralRules`) nie jest jeszcze obsługiwana.
- Komunikaty błędów z serwera i treści pisane przez agentów zostają w języku źródłowym.
- Język jest wybierany w czasie builda; przełącznika w UI na razie nie ma.
