# Vacation Planner

A Home Assistant Lovelace custom card for planning and tracking a vacation
inside Home Assistant — realtime checklists via HA's native `todo` platform.
Universell einsetzbar für jeden Urlaub; eine Packliste ist der Hauptanwendungsfall
(Todos weichen pro Urlaub ab und können optional als weitere Liste angehängt werden).

## Installation

### HACS

1. Open HACS → Frontend → Custom repositories
2. Add the repository (siehe Release) → Category Lovelace
3. Search for "Vacation Planner" and install
4. Add the resource to your dashboard

### Manual

1. Copy `vacation-planner.js` to `/config/www/`
2. Add to Lovelace resources:
   ```yaml
   url: /local/vacation-planner.js
   type: module
   ```

## License

MIT

## Configuration

Siehe README. Minimales Beispiel (eine Packliste):

```yaml
type: custom:vacation-planner
entity: todo.reise_packliste
name: Packliste
```

Mehrere Listen (z.B. Packliste + Todos) über `lists`:

```yaml
type: custom:vacation-planner
lists:
  - entity: todo.reise_packliste
    name: Packliste
    icon: noto:backpack
  - entity: todo.reise_todos
    name: Todos
    icon: noto:clipboard
```

### Kategorie-Icons

Items tragen den Prefix `[Kategorie] Text` (z.B. `[Kleidung] T-Shirts`).
Die Card wählt automatisch ein buntes **noto**-Icon pro Kategorie. Es gibt
universelle Defaults (Dokumente, Kleidung, Hygiene, Gesundheit, Technik,
Transport, Kinder, Tickets, Aktivitäten, Versicherung, Organisieren,
Abfahrt, Abreise, Sonstiges) mit enthält-basiertem Matching
(`[Transport buchen]` → Key `transport`).

Für urlaubsspezifische Kategorien kann man ein eigenes Mapping hinterlegen
(mergt über die Defaults) sowie das Fallback-Icon überschreiben:

```yaml
type: custom:vacation-planner
entity: todo.reise_packliste
category_icons:
  "reise-spezifisch – skandinavien-roadtrip": noto:sport-utility-vehicle
  "transport buchen": noto:ferry
  "mit kindern (5 & 6 j.)": noto:child
default_icon: noto:memo
```