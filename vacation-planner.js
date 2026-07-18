class VacationPlannerCard extends HTMLElement {
  constructor() {
    super();
    this._itemsByList = {};   // { "todo.urlaub_packliste": [ {uid,summary,status,description}, ... ] }
    this._unsub = null;
    this._debounce = null;
    this._hass = null;
    this._rendering = false;
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
        // return_response ist ein eigener Parameter von hass.callService
        // (5. Argument), KEIN Feld in den Service-Daten – sonst meldet HA
        // "Die Aktion erfordert Antworten und muss mit return_response=True
        // aufgerufen werden". Response-Form: { response: { <entity_id>:
        // { items: [...] } }, result: ... }.
        const res = await hass.callService("todo", "get_items",
          { entity_id: l.entity }, {}, true);
        const resp = res?.response || res?.result?.response || {};
        const items = (resp[l.entity] && resp[l.entity].items) || [];
        return [l.entity, items];
      } catch (e) {
        console.warn("Vacation Planner: get_items failed for", l.entity, e);
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
    // Nur den Content-Container entfernen, nicht das ganze Shadow-Root —
    // sonst würde der in _ensureShadow()/_injectStyles() einmalig injizierte
    // <style>-Block (HA-CSS-Variablen) bei jedem Re-Render gelöscht.
    const oldContent = root.querySelector(".vp-card");
    if (oldContent) oldContent.remove();
    const wrap = document.createElement("div");
    wrap.className = "vp-card";
    const title = document.createElement("div");
    title.className = "vp-title";
    title.textContent = this.config.title;
    wrap.appendChild(title);

    this.config.lists.forEach(l => {
      const items = this._itemsByList[l.entity] || [];
      wrap.appendChild(this._renderList(l, items));
    });

    root.appendChild(wrap);
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
      .vp-card { font-family: var(--card-primary-font-family, inherit);
        color: var(--primary-text-color); }
      .vp-title { font-size: 1.15rem; font-weight: 600; margin: 0 0 .5rem;
        color: var(--primary-text-color); }
      .vp-list { margin-bottom: 1.25rem;
        border-top: 1px solid var(--divider-color, #eee); padding-top: .5rem; }
      .vp-list-head { display:flex; align-items:center; justify-content:space-between;
        margin: .25rem 0 .5rem; }
      .vp-list-name { display:flex; align-items:center; gap:.4rem; font-weight:600; }
      .vp-progress { font-size: .85rem; color: var(--secondary-text-color); }
      .vp-item { display:flex; align-items:center; gap:.5rem; padding:.45rem 0;
        border-bottom: 1px solid var(--divider-color, #eee); }
      .vp-item:last-child { border-bottom: none; }
      .vp-item input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--primary-color,#41BDF5); }
      .vp-item span { flex: 1; cursor: pointer; }
      .vp-item.done span { text-decoration: line-through; color: var(--secondary-text-color); }
      .vp-del { background: none; border: none; color: var(--secondary-text-color);
        cursor: pointer; font-size: 1.1rem; padding: 0 .25rem; opacity: .5; }
      .vp-del:hover { opacity: 1; color: var(--error-color,#db4437); }
      .vp-add { display:flex; gap:.4rem; margin-top:.5rem; }
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

  _renderList(list, items) {
    const wrap = document.createElement("div");
    wrap.className = "vp-list";
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
    wrap.appendChild(head);

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vp-empty";
      empty.textContent = "Noch keine Einträge.";
      wrap.appendChild(empty);
    }
    items.forEach(it => wrap.appendChild(this._renderItem(list.entity, it)));

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
    wrap.appendChild(addRow);

    // Clear-done
    if (done > 0) {
      const clr = document.createElement("button");
      clr.type = "button"; clr.className = "vp-clear";
      clr.textContent = "Erledigte entfernen (" + done + ")";
      clr.addEventListener("click", () => this._clearDone(list.entity));
      wrap.appendChild(clr);
    }
    return wrap;
  }

  _renderItem(entity, item) {
    const row = document.createElement("div");
    row.className = "vp-item" + (item.status === "completed" ? " done" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = (item.status === "completed");
    cb.addEventListener("change", () => this._toggle(entity, item));
    const span = document.createElement("span");
    span.textContent = item.summary;
    span.addEventListener("click", () => { cb.checked = !cb.checked; this._toggle(entity, item); });
    const del = document.createElement("button");
    del.type = "button"; del.className = "vp-del"; del.textContent = "✕";
    del.title = "Entfernen";
    del.addEventListener("click", () => this._remove(entity, item));
    row.appendChild(cb); row.appendChild(span); row.appendChild(del);
    return row;
  }

  getStubConfig() { return { title: "Urlaub", lists: [
    { entity: "todo.urlaub_packliste", name: "Rucksack", icon: "mdi:bag-suitcase" },
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