# Vacation Planner

A Home Assistant Lovelace custom card for planning and tracking a vacation
inside Home Assistant — realtime checklists via HA's native `todo` platform.

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

Siehe README. Minimales Beispiel:

```yaml
type: custom:vacation-planner
lists:
  - entity: todo.urlaub_packliste
```