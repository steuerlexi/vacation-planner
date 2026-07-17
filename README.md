# Vacation Planner

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)

A Home Assistant Lovelace custom card for planning and tracking a vacation
natively inside Home Assistant — built on HA's native `todo` platform for
realtime, multi-device checklist sync.

> Status: **Implementiert** – die Card ist einsatzbereit, als inline-Ressource in Home Assistant registriert und das Repo ist HACS-konform für die Verteilung via GitHub vorbereitet.

## Installation

### HACS

1. Open HACS → **Frontend** → **Custom repositories**
2. Add repository (siehe Veröffentlichung) → Category: **Lovelace**
3. Click **Download** on the Vacation Planner entry
4. Refresh your browser cache (Ctrl+Shift+R)

### Manual

1. Copy `vacation-planner.js` to `/config/www/`
2. Add to Lovelace resources:
   ```yaml
   url: /local/vacation-planner.js
   type: module
   ```

## Configuration

Die Card zeigt eine oder mehrere `todo.*`-Listen als Echtzeit-Checkliste.

```yaml
type: custom:vacation-planner
title: Urlaub 2026
lists:
  - entity: todo.urlaub_packliste
    name: Rucksack
    icon: mdi:bag-suitcase
  - entity: todo.urlaub_reise_todos
    name: Todos
    icon: mdi:clipboard-check
```

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `title` | string | Kartenüberschrift (optional, Default „Urlaub") |
| `lists` | list | Eine oder mehrere Listen; alternativ einzelnes `entity` |
| `lists[].entity` | string | `todo.*`-Entität (erforderlich) |
| `lists[].name` | string | Anzeigename (optional) |
| `lists[].icon` | string | MDI-Icon (optional) |

Einträge werden über HAs native `todo`-Services angelegt/geändert/gelöscht
und per WebSocket (`subscribe_entities`) echtzeit auf alle Clients synchronisiert.

## License

MIT