const MODULE_ID = "gm-cheatsheet-importer";

const STATE_COLORS = {
  locked: "#555555",
  unlocked: "#3b6ea5",
  completed: "#3ba55d"
};

const STATE_LABELS = {
  locked: "Zablokowany",
  unlocked: "Odblokowany",
  completed: "Ukonczony"
};

function nodeRadius(node) {
  return node.size === "large" ? 32 : 20;
}

/* -------------------------------------------- */
/*  Storage                                      */
/* -------------------------------------------- */

function makeTree(name) {
  return { id: foundry.utils.randomID(), name, nodes: [], edges: [] };
}

function getData() {
  const data = game.settings.get(MODULE_ID, "skilltree") ?? { trees: [] };
  if (!Array.isArray(data.trees)) data.trees = [];
  return data;
}

async function setData(data) {
  await game.settings.set(MODULE_ID, "skilltree", data);
}

/* -------------------------------------------- */
/*  Auto-layout: layered by graph depth          */
/*  (used once, when a node is created, so the   */
/*  user's manual dragging afterwards is never   */
/*  overwritten automatically)                   */
/* -------------------------------------------- */

function autoLayout(nodes, edges) {
  const incoming = new Map(nodes.map(n => [n.id, 0]));
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) || 0) + 1);

  const depth = new Map();
  const roots = nodes.filter(n => (incoming.get(n.id) || 0) === 0).map(n => n.id);
  const queue = roots.map(id => ({ id, d: 0 }));

  while (queue.length) {
    const { id, d } = queue.shift();
    if (depth.has(id) && depth.get(id) >= d) continue;
    depth.set(id, d);
    for (const e of edges.filter(e => e.from === id)) queue.push({ id: e.to, d: d + 1 });
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  const byDepth = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(n);
  }
  for (const arr of byDepth.values()) {
    arr.forEach((n, i) => {
      n.x = 60 + depth.get(n.id) * 170;
      n.y = 50 + i * 100;
    });
  }
  return nodes;
}

/* -------------------------------------------- */
/*  Tiny text-prompt dialog                      */
/* -------------------------------------------- */

function promptText(title, initial = "") {
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<form><input type="text" name="value" value="${initial}" style="width:100%;"></form>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "OK",
          callback: (html) => {
            const el = html[0]?.querySelector?.("input") ?? html.querySelector?.("input");
            resolve((el?.value ?? "").trim());
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Anuluj", callback: () => resolve(null) }
      },
      default: "ok"
    }, { width: 360 }).render(true);
  });
}

/* -------------------------------------------- */
/*  Main window                                  */
/* -------------------------------------------- */

let appInstance = null;

class SkillTreeApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gm-cheatsheet-skilltree-app",
      title: "Drzewka postepu",
      width: 940,
      height: 680,
      resizable: true,
      classes: ["gm-cheatsheet-skilltree-app"]
    });
  }

  constructor(options = {}) {
    super(options);
    this._activeTreeId = null;
    this._selected = null;
    this._dragCleanup = [];
    // live node list for the currently rendered tree, kept in sync during drag
    // so we never need a full re-render (and therefore never lose listeners)
    this._liveNodes = [];
  }

  get isGM() { return game.user.isGM; }

  _currentTree(data) {
    if (!data.trees.length) {
      const t = makeTree("Drzewko 1");
      data.trees.push(t);
    }
    if (!this._activeTreeId || !data.trees.some(t => t.id === this._activeTreeId)) {
      this._activeTreeId = data.trees[0].id;
    }
    return data.trees.find(t => t.id === this._activeTreeId);
  }

  _visibleNodes(tree) {
    if (this.isGM) return tree.nodes;
    return tree.nodes.filter(n => (n.visibleTo ?? []).includes(game.user.id));
  }

  async _renderInner() {
    const data = getData();
    const tree = this._currentTree(data);
    await setData(data);

    const tabsHtml = data.trees.map(t => `
      <a class="item ${t.id === this._activeTreeId ? "active" : ""}" data-tree="${t.id}">${t.name}</a>
    `).join("");

    const toolbarHtml = this.isGM ? `
      <nav class="tabs gm-cheatsheet-skilltree-tabs">
        ${tabsHtml}
        <a class="item gm-cheatsheet-skilltree-add-tree" title="Nowe drzewko"><i class="fas fa-plus"></i></a>
      </nav>
      <div class="gm-cheatsheet-skilltree-tree-actions">
        <a class="gm-cheatsheet-skilltree-rename-tree"><i class="fas fa-pen"></i> Zmien nazwe drzewka</a>
        <a class="gm-cheatsheet-skilltree-delete-tree"><i class="fas fa-trash"></i> Usun drzewko</a>
      </div>
      <div class="gm-cheatsheet-skilltree-toolbar">
        <button type="button" class="gm-cheatsheet-skilltree-add"><i class="fas fa-plus"></i> Nowy wezel</button>
        <button type="button" class="gm-cheatsheet-skilltree-layout"><i class="fas fa-sitemap"></i> Auto-uklad</button>
      </div>` : `
      <nav class="tabs gm-cheatsheet-skilltree-tabs">${tabsHtml}</nav>`;

    const inspectorHtml = this.isGM
      ? `<div class="gm-cheatsheet-skilltree-inspector"><p class="gm-cheatsheet-sessions-empty">Kliknij wezel, aby edytowac.</p></div>`
      : "";

    const html = `
      <div class="gm-cheatsheet-skilltree-root">
        ${toolbarHtml}
        <div class="gm-cheatsheet-skilltree-canvas-wrap">
          <svg class="gm-cheatsheet-skilltree-edges"></svg>
          <div class="gm-cheatsheet-skilltree-nodes"></div>
        </div>
        ${inspectorHtml}
      </div>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    this._root = root;

    root.querySelectorAll(".gm-cheatsheet-skilltree-tabs .item[data-tree]").forEach(tab => {
      tab.addEventListener("click", () => {
        this._activeTreeId = tab.dataset.tree;
        this._selected = null;
        this.render();
      });
    });

    if (this.isGM) {
      root.querySelector(".gm-cheatsheet-skilltree-add-tree").addEventListener("click", async () => {
        const name = await promptText("Nowe drzewko", `Drzewko ${getData().trees.length + 1}`);
        if (!name) return;
        const data = getData();
        const t = makeTree(name);
        data.trees.push(t);
        await setData(data);
        this._activeTreeId = t.id;
        this.render();
      });

      root.querySelector(".gm-cheatsheet-skilltree-rename-tree").addEventListener("click", async () => {
        const data = getData();
        const tree = data.trees.find(t => t.id === this._activeTreeId);
        const name = await promptText("Zmien nazwe drzewka", tree.name);
        if (!name) return;
        tree.name = name;
        await setData(data);
        this.render();
      });

      root.querySelector(".gm-cheatsheet-skilltree-delete-tree").addEventListener("click", async () => {
        const data = getData();
        if (data.trees.length <= 1) {
          ui.notifications.warn("Musi zostac przynajmniej jedno drzewko.");
          return;
        }
        const tree = data.trees.find(t => t.id === this._activeTreeId);
        const confirmed = await Dialog.confirm({
          title: "Usun drzewko",
          content: `<p>Na pewno usunac drzewko "${tree.name}" wraz z wezlami i polaczeniami?</p>`
        });
        if (!confirmed) return;
        data.trees = data.trees.filter(t => t.id !== tree.id);
        await setData(data);
        this._activeTreeId = data.trees[0].id;
        this.render();
      });

      root.querySelector(".gm-cheatsheet-skilltree-add").addEventListener("click", () => this._addNode());
      root.querySelector(".gm-cheatsheet-skilltree-layout").addEventListener("click", () => this._runAutoLayout());
    }

    this._draw();
  }

  close(options) {
    this._dragCleanup.forEach(fn => fn());
    this._dragCleanup = [];
    return super.close(options);
  }

  /* ---------- rendering ---------- */

  _draw() {
    const data = getData();
    const tree = this._currentTree(data);
    const nodes = this._visibleNodes(tree);
    this._liveNodes = nodes;

    const nodesWrap = this._root.querySelector(".gm-cheatsheet-skilltree-nodes");
    nodesWrap.innerHTML = "";

    this._dragCleanup.forEach(fn => fn());
    this._dragCleanup = [];
    this._nodeDivs = new Map();

    const maxX = Math.max(400, ...nodes.map(n => n.x + 160), 0);
    const maxY = Math.max(400, ...nodes.map(n => n.y + 100), 0);
    nodesWrap.style.width = `${maxX}px`;
    nodesWrap.style.height = `${maxY}px`;

    for (const n of nodes) {
      const div = document.createElement("div");
      div.className = `gm-cheatsheet-skilltree-node gm-cheatsheet-skilltree-node-${n.size} ${this._selected === n.id ? "selected" : ""}`;
      div.style.left = `${n.x}px`;
      div.style.top = `${n.y}px`;
      div.style.setProperty("--gmch-node-color", STATE_COLORS[n.state] ?? STATE_COLORS.locked);
      div.title = `${n.label} (${STATE_LABELS[n.state] ?? n.state})`;
      div.innerHTML = `<span>${n.label}</span>`;

      div.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (this.isGM) {
          this._selected = n.id;
          this._highlightSelection();
          this._renderInspector(n);
        }
      });

      if (this.isGM) this._makeDraggable(div, n);
      this._nodeDivs.set(n.id, div);
      nodesWrap.appendChild(div);
    }

    this._redrawEdges();
  }

  _highlightSelection() {
    this._nodeDivs?.forEach((div, id) => div.classList.toggle("selected", id === this._selected));
  }

  /** Lightweight edge redraw — reads live in-memory node positions only,
   *  never touches node divs/listeners, safe to call on every drag frame. */
  _redrawEdges() {
    const data = getData();
    const tree = this._currentTree(data);
    const visibleIds = new Set(this._liveNodes.map(n => n.id));
    const edges = tree.edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));
    const byId = new Map(this._liveNodes.map(n => [n.id, n]));

    const svg = this._root.querySelector(".gm-cheatsheet-skilltree-edges");
    const maxX = Math.max(400, ...this._liveNodes.map(n => n.x + 160), 0);
    const maxY = Math.max(400, ...this._liveNodes.map(n => n.y + 100), 0);
    svg.setAttribute("width", maxX);
    svg.setAttribute("height", maxY);
    svg.innerHTML = `
      <defs>
        <marker id="gmch-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#000"></path>
        </marker>
      </defs>
    `;
    for (const e of edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      const ra = nodeRadius(a), rb = nodeRadius(b);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.x + ra);
      line.setAttribute("y1", a.y + ra);
      line.setAttribute("x2", b.x + rb);
      line.setAttribute("y2", b.y + rb);
      line.setAttribute("class", "gm-cheatsheet-skilltree-edge");
      line.setAttribute("marker-end", "url(#gmch-arrow)");
      svg.appendChild(line);
    }
  }

  _makeDraggable(div, node) {
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;

    const onDown = (ev) => {
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      origX = node.x;
      origY = node.y;
      ev.preventDefault();
    };
    const onMove = (ev) => {
      if (!dragging) return;
      node.x = Math.max(0, origX + (ev.clientX - startX));
      node.y = Math.max(0, origY + (ev.clientY - startY));
      div.style.left = `${node.x}px`;
      div.style.top = `${node.y}px`;
      // only reposition edges + this div — never rebuild the node list/listeners
      this._redrawEdges();
    };
    const onUp = async () => {
      if (!dragging) return;
      dragging = false;
      const data = getData();
      const tree = this._currentTree(data);
      const target = tree.nodes.find(n => n.id === node.id);
      if (target) { target.x = node.x; target.y = node.y; }
      await setData(data);
    };

    div.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    this._dragCleanup.push(() => {
      div.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    });
  }

  /* ---------- node CRUD ---------- */

  async _addNode() {
    const data = getData();
    const tree = this._currentTree(data);
    const node = {
      id: foundry.utils.randomID(),
      label: "Nowy wezel",
      size: "small",
      state: "locked",
      x: 40,
      y: 40,
      visibleTo: []
    };
    tree.nodes.push(node);
    await setData(data);
    this._selected = node.id;
    this._draw();
    this._renderInspector(node);
  }

  async _runAutoLayout() {
    const data = getData();
    const tree = this._currentTree(data);
    autoLayout(tree.nodes, tree.edges);
    await setData(data);
    this._draw();
  }

  /* ---------- inspector: edit fields + explicit, directional connections ---------- */

  _renderInspector(node) {
    const panel = this._root.querySelector(".gm-cheatsheet-skilltree-inspector");
    if (!panel) return;
    const data = getData();
    const tree = this._currentTree(data);
    const others = tree.nodes.filter(n => n.id !== node.id);
    const players = game.users.filter(u => !u.isGM);

    const outgoing = new Set(tree.edges.filter(e => e.from === node.id).map(e => e.to));
    const incoming = new Set(tree.edges.filter(e => e.to === node.id).map(e => e.from));

    panel.innerHTML = `
      <div class="gm-cheatsheet-skilltree-inspector-row">
        <label>Nazwa</label>
        <input type="text" class="gm-cheatsheet-skilltree-i-label" value="${node.label}">
      </div>
      <div class="gm-cheatsheet-skilltree-inspector-row">
        <label>Rozmiar</label>
        <select class="gm-cheatsheet-skilltree-i-size">
          <option value="small" ${node.size === "small" ? "selected" : ""}>Maly</option>
          <option value="large" ${node.size === "large" ? "selected" : ""}>Duzy</option>
        </select>
      </div>
      <div class="gm-cheatsheet-skilltree-inspector-row">
        <label>Stan</label>
        <select class="gm-cheatsheet-skilltree-i-state">
          <option value="locked" ${node.state === "locked" ? "selected" : ""}>Zablokowany</option>
          <option value="unlocked" ${node.state === "unlocked" ? "selected" : ""}>Odblokowany</option>
          <option value="completed" ${node.state === "completed" ? "selected" : ""}>Ukonczony</option>
        </select>
      </div>
      <div class="gm-cheatsheet-skilltree-inspector-row gm-cheatsheet-skilltree-i-visible-row">
        <label>Widoczny dla</label>
        <div class="gm-cheatsheet-skilltree-i-visible">
          ${players.map(u => `
            <label><input type="checkbox" data-uid="${u.id}" ${(node.visibleTo ?? []).includes(u.id) ? "checked" : ""}> ${u.name}</label>
          `).join("") || "<em>Brak graczy (nie-GM) w tej grze.</em>"}
        </div>
      </div>
      <div class="gm-cheatsheet-skilltree-inspector-row gm-cheatsheet-skilltree-i-edges-row">
        <label>Prowadzi do &rarr;</label>
        <div class="gm-cheatsheet-skilltree-i-edges">
          ${others.map(n => `
            <label><input type="checkbox" data-dir="out" data-target="${n.id}" ${outgoing.has(n.id) ? "checked" : ""}> ${n.label}</label>
          `).join("") || "<em>Brak innych wezlow.</em>"}
        </div>
      </div>
      <div class="gm-cheatsheet-skilltree-inspector-row gm-cheatsheet-skilltree-i-edges-row">
        <label>&larr; Wymaga</label>
        <div class="gm-cheatsheet-skilltree-i-edges">
          ${others.map(n => `
            <label><input type="checkbox" data-dir="in" data-target="${n.id}" ${incoming.has(n.id) ? "checked" : ""}> ${n.label}</label>
          `).join("") || "<em>Brak innych wezlow.</em>"}
        </div>
      </div>
      <button type="button" class="gm-cheatsheet-skilltree-i-delete"><i class="fas fa-trash"></i> Usun wezel</button>
    `;

    const commit = async (patch) => {
      const data = getData();
      const tree = this._currentTree(data);
      const target = tree.nodes.find(n => n.id === node.id);
      Object.assign(target, patch);
      await setData(data);
      this._draw();
    };

    panel.querySelector(".gm-cheatsheet-skilltree-i-label").addEventListener("change", (ev) => commit({ label: ev.currentTarget.value }));
    panel.querySelector(".gm-cheatsheet-skilltree-i-size").addEventListener("change", (ev) => commit({ size: ev.currentTarget.value }));
    panel.querySelector(".gm-cheatsheet-skilltree-i-state").addEventListener("change", (ev) => commit({ state: ev.currentTarget.value }));

    panel.querySelectorAll(".gm-cheatsheet-skilltree-i-visible input").forEach(cb => {
      cb.addEventListener("change", async () => {
        const data = getData();
        const tree = this._currentTree(data);
        const target = tree.nodes.find(n => n.id === node.id);
        const set = new Set(target.visibleTo ?? []);
        if (cb.checked) set.add(cb.dataset.uid); else set.delete(cb.dataset.uid);
        target.visibleTo = [...set];
        await setData(data);
      });
    });

    panel.querySelectorAll(".gm-cheatsheet-skilltree-i-edges input").forEach(cb => {
      cb.addEventListener("change", async () => {
        const data = getData();
        const tree = this._currentTree(data);
        const targetId = cb.dataset.target;
        const from = cb.dataset.dir === "out" ? node.id : targetId;
        const to = cb.dataset.dir === "out" ? targetId : node.id;
        if (cb.checked) {
          if (!tree.edges.some(e => e.from === from && e.to === to)) tree.edges.push({ from, to });
        } else {
          tree.edges = tree.edges.filter(e => !(e.from === from && e.to === to));
        }
        await setData(data);
        this._draw();
        this._renderInspector(node);
      });
    });

    panel.querySelector(".gm-cheatsheet-skilltree-i-delete").addEventListener("click", async () => {
      const data = getData();
      const tree = this._currentTree(data);
      tree.nodes = tree.nodes.filter(n => n.id !== node.id);
      tree.edges = tree.edges.filter(e => e.from !== node.id && e.to !== node.id);
      this._selected = null;
      await setData(data);
      this._draw();
      panel.innerHTML = `<p class="gm-cheatsheet-sessions-empty">Kliknij wezel, aby edytowac.</p>`;
    });
  }
}

function openSkillTree() {
  if (!appInstance) appInstance = new SkillTreeApp();
  appInstance.render(true, { focus: true });
}

/* -------------------------------------------- */
/*  Styling                                      */
/* -------------------------------------------- */

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .gm-cheatsheet-skilltree-btn { display: inline-flex; align-items: center; gap: 4px; margin: 2px 4px; }
    .gm-cheatsheet-skilltree-root { display: flex; flex-direction: column; height: 100%; }
    .gm-cheatsheet-skilltree-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid rgba(0,0,0,0.3); margin-bottom: 4px; }
    .gm-cheatsheet-skilltree-tabs .item { padding: 4px 10px; cursor: pointer; border-radius: 4px 4px 0 0; }
    .gm-cheatsheet-skilltree-tabs .item.active { background: rgba(0,0,0,0.15); font-weight: bold; }
    .gm-cheatsheet-skilltree-tree-actions { display: flex; gap: 14px; margin-bottom: 6px; font-size: 12px; }
    .gm-cheatsheet-skilltree-tree-actions a { cursor: pointer; opacity: 0.8; }
    .gm-cheatsheet-skilltree-tree-actions a:hover { opacity: 1; }
    .gm-cheatsheet-skilltree-toolbar { display: flex; gap: 6px; margin-bottom: 6px; }
    .gm-cheatsheet-skilltree-canvas-wrap {
      position: relative; flex: 1; overflow: auto;
      border: 1px solid rgba(0,0,0,0.3);
      background: repeating-linear-gradient(45deg, rgba(0,0,0,0.03) 0 10px, transparent 10px 20px);
    }
    .gm-cheatsheet-skilltree-edges { position: absolute; top: 0; left: 0; pointer-events: none; }
    .gm-cheatsheet-skilltree-edge { stroke: #000; stroke-width: 2; }
    .gm-cheatsheet-skilltree-nodes { position: relative; }
    .gm-cheatsheet-skilltree-node {
      position: absolute; display: flex; align-items: center; justify-content: center;
      border-radius: 50%; border: 2px solid rgba(0,0,0,0.6);
      background: var(--gmch-node-color, #555);
      color: #fff; cursor: pointer; text-align: center;
      padding: 4px; user-select: none;
      box-shadow: inset 0 0 8px rgba(0,0,0,0.35);
    }
    .gm-cheatsheet-skilltree-node-small { width: 40px; height: 40px; font-size: 9px; }
    .gm-cheatsheet-skilltree-node-large { width: 64px; height: 64px; font-size: 11px; }
    .gm-cheatsheet-skilltree-node.selected { outline: 3px solid #fff; }
    .gm-cheatsheet-skilltree-inspector {
      border-top: 1px solid rgba(0,0,0,0.3); margin-top: 6px; padding-top: 6px;
      display: flex; flex-direction: column; gap: 6px;
      max-height: 220px; overflow-y: auto;
    }
    .gm-cheatsheet-skilltree-inspector-row { display: flex; align-items: flex-start; gap: 8px; }
    .gm-cheatsheet-skilltree-inspector-row label { min-width: 90px; padding-top: 2px; }
    .gm-cheatsheet-skilltree-i-visible, .gm-cheatsheet-skilltree-i-edges { display: flex; flex-wrap: wrap; gap: 8px; }
  `;
  document.head.appendChild(style);
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "skilltree", {
    scope: "world",
    config: false,
    type: Object,
    default: { trees: [] }
  });

  const mod = game.modules.get(MODULE_ID);
  mod.api = Object.assign(mod.api ?? {}, { openSkillTree });

  injectStyles();
});

// GM gets the editor; players get a read-only view scoped to nodes shared with them,
// so unlike the other buttons this one is not GM-gated.
Hooks.on("renderJournalDirectory", (app, htmlOrElement) => {
  const root = htmlOrElement instanceof HTMLElement ? htmlOrElement : htmlOrElement[0];
  if (!root || root.querySelector(".gm-cheatsheet-skilltree-btn")) return;

  const header = root.querySelector(".directory-header .action-buttons")
    ?? root.querySelector(".directory-header")
    ?? root.querySelector(".header-actions");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gm-cheatsheet-skilltree-btn";
  button.innerHTML = '<i class="fas fa-diagram-project"></i> Drzewka postepu';
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    openSkillTree();
  });

  if (header) header.appendChild(button);
  else root.prepend(button);
});
