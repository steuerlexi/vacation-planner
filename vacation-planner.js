class VacationPlannerCard extends HTMLElement {
  constructor() {
    super();
    this._itemsByList = {};   // { "todo.urlaub_packliste": [ {uid,summary,status,description}, ... ] }
    this._unsub = null;
    this._debounce = null;
    this._hass = null;
    this._rendering = false;
  }

  // Kategorie -> buntes Unicode-Emoji. Die Items tragen aus der Migration
  // den Prefix "[Kategorie] Text"; das Emoji macht die Kategorie sichtbar,
  // ohne dass der Prefix als Text gezeigt werden muss.
  // Lookup-Keys sind normalisiert (lowercase, getrimmt, Whitespace kollabiert).
  static CATEGORY_EMOJI = {
    "dokumente & geld": "💳",
    "kleidung": "👕",
    "hygiene & gesundheit": "🧴",
    "technik": "🔌",
    "reise-spezifisch – skandinavien-roadtrip": "🚗",
    "mit kindern (5 & 6 j.)": "🧒",
    "sonstiges": "🎒",
    "transport buchen": "⛴️",
    "tickets / aktivitäten vorab buchen": "🎟️",
    "versicherung & formalia": "🛡️",
    "organisieren": "📋",
    "vor abfahrt (19.07.)": "🚦",
  };
  static CATEGORY_EMOJI_FALLBACK = "📝";

  // Trennt "[Kategorie] Text" -> { emoji, text }. Items ohne Prefix
  // bekommen das Fallback-Emoji und werden unverändert ausgegeben.
  _categoryEmoji(summary) {
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(summary || "");
    if (!m) return { emoji: VacationPlannerCard.CATEGORY_EMOJI_FALLBACK, text: summary || "" };
    const key = m[1].trim().toLowerCase().replace(/\s+/g, " ");
    const emoji = VacationPlannerCard.CATEGORY_EMOJI[key]
      || VacationPlannerCard.CATEGORY_EMOJI_FALLBACK;
    return { emoji, text: m[2] };
  }

  // --- Config --------------------------------------------------------------
  setConfig(config) {
    if (!config || (!config.entity && !Array.isArray(config.lists))) {
      throw new Error('Vacation Planner: "lists" (Array) oder "entity" erforderlich.');
    }
    const lists = config.entity
      ? [{ entity: config.entity, name: config.name || config.entity,
           icon: config.icon || "mdi:clipboard-check" }]
      : config.lists.map(l => ({
          entity: l.entity,
          name: l.name || l.entity,
          icon: l.icon || "mdi:clipboard-check",
        }));
    // Validierung: jede Liste braucht ein entity
    for (const l of lists) {
      if (!l.entity || typeof l.entity !== "string" || !l.entity.startsWith("todo.")) {
        throw new Error('Vacation Planner: jeder Listeneintrag braucht ein "entity" (todo.*).');
      }
    }
    this.config = { title: config.title || "Urlaub", lists };
    if (this._hass) this._fetchAndRender();
  }

  // --- HA-Anbindung --------------------------------------------------------
  set hass(hass) {
    if (!this.config || !hass || !hass.states) return;
    const oldHass = this._hass;
    this._hass = hass;
    if (!oldHass) this._subscribe();
    if (!oldHass || this._shouldRender(oldHass, hass)) this._fetchAndRender();
  }

  _shouldRender(oldHass, newHass) {
    for (const l of this.config.lists) {
      const o = oldHass.states[l.entity], n = newHass.states[l.entity];
      if (!o || !n) return true;
      if (o.last_changed !== n.last_changed) return true;
      if (o.last_updated !== n.last_updated) return true;
    }
    return false;
  }

  _call(domain, service, data) {
    if (!this._hass) return Promise.resolve();
    return this._hass.callService(domain, service, data)
      .catch(e => console.warn("Vacation Planner: service call failed", domain, service, e));
  }

  async _fetchItems(hass) {
    const results = await Promise.all(this.config.lists.map(async (l) => {
      try {
        // Kanonischer Weg für Custom-Cards: die WebSocket-Command
        // "todo/item/list" (so macht es das offizielle HA-Todo-Card und
        // jede funktionierende Community-Todo-Card). Liefert direkt
        // { items: [{uid, summary, status, ...}] }.
        // NICHT den Service todo.get_items via callService nutzen – der
        // hat has_response=true und braucht return_response, das der
        // Frontend-Helper nicht zuverlässig als 5. Parameter durchreicht.
        // Symptom: HA-Toast "Die Aktion erfordert Antworten und muss mit
        // return_response=True aufgerufen werden" + leere Card.
        const result = await hass.callWS(
          { type: "todo/item/list", entity_id: l.entity });
        const items = (result && result.items) || [];
        return [l.entity, items];
      } catch (e) {
        console.warn("Vacation Planner: todo/item/list failed for", l.entity, e);
        return [l.entity, []];
      }
    }));
    this._itemsByList = Object.fromEntries(results);
  }

  _fetchAndRender() {
    if (this._debounce) clearTimeout(this._debounce);
    // Fetch-Generation: Token verhindert, dass ein langsamer älterer fetch
    // nach einem neueren fetch mit veralteten Items rendert.
    this._fetchGen = (this._fetchGen || 0) + 1;
    const gen = this._fetchGen;
    this._debounce = setTimeout(async () => {
      this._debounce = null;
      await this._fetchItems(this._hass);
      if (gen === this._fetchGen) this._render();
    }, 0);
  }

  _subscribe() {
    if (this._unsub || !this._hass || !this.isConnected) return;
    const ids = this.config.lists.map(l => l.entity);
    // _unsub hält das Promise aus subscribeMessage/subscribeEvents; so geht
    // kein Unsub verloren, falls disconnectedCallback() vor dem Resolve feuert.
    this._unsub = this._hass.connection.subscribeMessage(
      () => this._fetchAndRender(),
      { type: "subscribe_entities", entity_ids: ids }
    ).catch(() => {
      // Fallback: state_changed-Events (ältere HA-Versionen / Kompatibilität)
      return this._hass.connection.subscribeEvents(ev => {
        if (ids.includes(ev?.data?.entity_id)) this._fetchAndRender();
      }, "state_changed").catch(e => console.warn("Vacation Planner: state_changed fallback failed", e));
    });
  }

  connectedCallback() { if (this._hass) this._subscribe(); }
  disconnectedCallback() {
    if (this._unsub) {
      Promise.resolve(this._unsub).then(fn => { if (typeof fn === "function") fn(); });
      this._unsub = null;
    }
  }

  // --- Aktionen -------------------------------------------------------------
  _addItem(entity, text) {
    const val = (text || "").trim();
    if (!val || !this._hass) return;
    this._call("todo", "add_item", { entity_id: entity, item: val });
  }
  _toggle(entity, item) {
    if (!this._hass) return;
    const status = item.status === "completed" ? "needs_action" : "completed";
    // Bevorzugt uid (stabil, HA 2024.7+), Fallback summary für ältere Versionen
    const id = item.uid || item.summary;
    this._call("todo", "update_item", { entity_id: entity, item: id, status });
  }
  _remove(entity, item) {
    if (!this._hass) return;
    const id = item.uid || item.summary;
    this._call("todo", "remove_item", { entity_id: entity, item: id });
  }
  _clearDone(entity) {
    if (!this._hass) return;
    this._call("todo", "remove_completed_items", { entity_id: entity });
  }

  // --- Render ---------------------------------------------------------------
  _render() {
    if (this._rendering) return;
    this._rendering = true;
    const root = this.attachShadow ? this._shadowRoot || this._ensureShadow()
                                    : this;
    // Wir verwenden ein Shadow-DOM für sauberes Styling mit HA-Variablen.
    // Nur den Root-Container entfernen, nicht das ganze Shadow-Root —
    // sonst würde der in _ensureShadow()/_injectStyles() einmalig injizierte
    // <style>-Block (HA-CSS-Variablen) bei jedem Re-Render gelöscht.
    const oldRoot = root.querySelector(".vp-root");
    if (oldRoot) oldRoot.remove();
    const rootDiv = document.createElement("div");
    rootDiv.className = "vp-root";
    // Jede Liste wird als EIGENE ha-card gerendert → separate Karten.
    this.config.lists.forEach(l => {
      const items = this._itemsByList[l.entity] || [];
      rootDiv.appendChild(this._renderListCard(l, items));
    });
    root.appendChild(rootDiv);
    this._rendering = false;
  }

  _ensureShadow() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._shadowRoot = this.shadowRoot;
    this._injectStyles();
    return this.shadowRoot;
  }

  _injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      .vp-root { display:flex; flex-direction:column; gap:1rem;
        font-family: var(--card-primary-font-family, inherit);
        color: var(--primary-text-color); }
      .vp-list-card { padding: 0; overflow: hidden; }
      .vp-list-head { display:flex; align-items:center; justify-content:space-between;
        padding:.8rem 1rem .5rem; }
      .vp-list-name { display:flex; align-items:center; gap:.4rem; font-weight:600;
        font-size:1.05rem; }
      .vp-progress { font-size: .85rem; color: var(--secondary-text-color); }
      .vp-card-content { padding: 0 1rem 1rem; }
      .vp-items { display:grid; grid-template-columns: repeat(auto-fill, minmax(108px,1fr));
        gap:.5rem; }
      .vp-tile { position:relative; aspect-ratio: 1 / 1; display:flex;
        flex-direction:column; align-items:center; justify-content:center;
        gap:.3rem; padding:.6rem .4rem; border-radius:12px;
        cursor:pointer; text-align:center; background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #eee);
        color: var(--primary-text-color); font-size:.8rem; line-height:1.15;
        box-sizing: border-box;
        transition: border-color .15s, transform .05s; }
      .vp-tile:hover { border-color: var(--primary-color,#41BDF5); }
      .vp-tile:active { transform: scale(.97); }
      .vp-tile-emoji { font-size: 2rem; line-height:1; }
      .vp-tile-label { overflow:hidden; display:-webkit-box; -webkit-line-clamp:3;
        -webkit-box-orient:vertical; word-break: break-word; }
      .vp-tile.done { opacity:.45; }
      .vp-tile.done .vp-tile-label { text-decoration: line-through; }
      .vp-tile.done .vp-tile-emoji { filter: grayscale(1); }
      .vp-tile-del { position:absolute; top:.15rem; right:.25rem; background:none;
        border:none; color: var(--secondary-text-color); font-size:.7rem;
        opacity:0; cursor:pointer; padding:.1rem; line-height:1; }
      .vp-tile:hover .vp-tile-del { opacity:.55; }
      .vp-tile-del:hover { opacity:1; color: var(--error-color,#db4437); }
      .vp-add { display:flex; gap:.4rem; margin-top:.6rem; }
      .vp-add input { flex:1; padding:.5rem; border-radius:8px;
        border: 1px solid var(--divider-color,#ccc);
        background: var(--input-background-color, #fff);
        color: var(--primary-text-color); }
      .vp-add button { padding:.5rem .8rem; border:none; border-radius:8px;
        background: var(--primary-color,#41BDF5); color:#fff; cursor:pointer; }
      .vp-clear { margin-top:.4rem; font-size:.8rem; background:none; border:none;
        color: var(--secondary-text-color); cursor:pointer; text-decoration:underline; }
      .vp-empty { color: var(--secondary-text-color); font-size:.9rem;
        padding:.25rem 0; }
      ha-icon { --mdc-icon-size: 20px; vertical-align: middle; }
    `;
    this.shadowRoot.appendChild(style);
  }

  _renderListCard(list, items) {
    const card = document.createElement("ha-card");
    card.className = "vp-list-card";

    // Kopf: Icon + Listenname + Fortschritt
    const head = document.createElement("div");
    head.className = "vp-list-head";
    const name = document.createElement("div");
    name.className = "vp-list-name";
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", list.icon);
    name.appendChild(icon);
    name.appendChild(document.createTextNode(" " + list.name));
    const done = items.filter(i => i.status === "completed").length;
    const prog = document.createElement("div");
    prog.className = "vp-progress";
    prog.textContent = done + "/" + items.length;
    head.appendChild(name); head.appendChild(prog);
    card.appendChild(head);

    // Content
    const content = document.createElement("div");
    content.className = "vp-card-content";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vp-empty";
      empty.textContent = "Noch keine Einträge.";
      content.appendChild(empty);
    } else {
      const grid = document.createElement("div");
      grid.className = "vp-items";
      items.forEach(it => grid.appendChild(this._renderTile(list.entity, it)));
      content.appendChild(grid);
    }

    // Add-Row
    const addRow = document.createElement("div");
    addRow.className = "vp-add";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Hinzufügen …";
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "+";
    const submit = () => { if (input.value.trim()) { this._addItem(list.entity, input.value); input.value = ""; } };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    addRow.appendChild(input); addRow.appendChild(btn);
    content.appendChild(addRow);

    // Clear-done
    if (done > 0) {
      const clr = document.createElement("button");
      clr.type = "button"; clr.className = "vp-clear";
      clr.textContent = "Erledigte entfernen (" + done + ")";
      clr.addEventListener("click", () => this._clearDone(list.entity));
      content.appendChild(clr);
    }
    card.appendChild(content);
    return card;
  }

  _renderTile(entity, item) {
    // Quadratische Kachel: buntes Kategorie-Emoji + bereinigter Text
    // (ohne [Kategorie]-Prefix). Klick toggelt erledigt; ✕ entfernt.
    const { emoji, text } = this._categoryEmoji(item.summary);
    const done = item.status === "completed";
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "vp-tile" + (done ? " done" : "");
    tile.title = item.summary; // vollständiger Originaltext im Tooltip
    tile.addEventListener("click", () => this._toggle(entity, item));
    const emojiEl = document.createElement("span");
    emojiEl.className = "vp-tile-emoji";
    emojiEl.textContent = emoji;
    const label = document.createElement("span");
    label.className = "vp-tile-label";
    label.textContent = text;
    const del = document.createElement("button");
    del.type = "button"; del.className = "vp-tile-del"; del.textContent = "✕";
    del.title = "Entfernen";
    del.addEventListener("click", (e) => { e.stopPropagation(); this._remove(entity, item); });
    tile.appendChild(emojiEl); tile.appendChild(label); tile.appendChild(del);
    return tile;
  }

  getStubConfig() { return { title: "Urlaub", lists: [
    { entity: "todo.urlaub_packliste", name: "Packliste", icon: "mdi:bag-suitcase" },
    { entity: "todo.urlaub_reise_todos", name: "Todos", icon: "mdi:clipboard-check" },
  ]}; }

  static getConfigElement() { return null; }
}
customElements.define("vacation-planner", VacationPlannerCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "vacation-planner",
  name: "Vacation Planner",
  description: "Urlaubs-Checklisten (Packliste + Todos) als realtime, mehrgeräte-fähige Card via HA todo.",
});