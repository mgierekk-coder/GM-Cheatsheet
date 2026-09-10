const MODULE_ID = "gm-cheatsheet-importer";

/* -------------------------------------------- */
/*  Storage                                      */
/* -------------------------------------------- */

function getTree() {
  return game.settings.get(MODULE_ID, "skilltree") ?? { nodes: [], edges: [] };
}

async function setTree(data) {
  await game.settings.set(MODULE_ID, "skilltree", data);
}

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

/* -------------------------------------------- */
/*  Auto-layout: layered by graph depth          */
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
/*  Main window                                  */
/* -------------------------------------------- */

let appInstance = null;

class SkillTreeApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gm-cheatsheet-skilltree-app",
      title: "Drzewka postepu",
      width: 900,
      height: 650,
      resizable: true,
      classes: ["gm-cheatsheet-skilltree-app"]
    });
  }

  constructor(options = {}) {
    super(options);
    this._selected = null;
    this._linkMode = false;
    this._linkFrom = null;
    this._dragCleanup = [];
  }

  get isGM() { return game.user.isGM; }

  _visibleNodes(data) {
    if (this.isGM) return data.nodes;
    return data.nodes.filter(n => (n.visibleTo ?? []).includes(game.user.id));
  }

  async _renderInner() {
    const toolbarHtml = this.isGM ? `
      <div class="gm-cheatsheet-skilltree-toolbar">
        <button type="button" class="gm-cheatsheet-skilltree-add"><i class="fas fa-plus"></i> Nowy wezel</button>
        <button type="button" class="gm-cheatsheet-skilltree-link"><i class="fas fa-link"></i> Polacz wezly</button>
        <button type="button" class="gm-cheatsheet-skilltree-layout"><i class="fas fa-sitemap"></i> Auto-uklad</button>
      </div>` : "";

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

    if (this.isGM) {
      root.querySelector(".gm-cheatsheet-skilltree-add").addEventListener("click", () => this._addNode());
      root.querySelector(".gm-cheatsheet-skilltree-link").addEventListener("click", (ev) => {
        this._linkMode = !this._linkMode;
        this._linkFrom = null;
        ev.currentTarget.classList.toggle("active", this._linkMode);
      });
      root.querySelector(".gm-cheatsheet-skilltree-layout").addEventListener("click", () => this._runAutoLayout());
    }

    this._draw();
  }

  close(options) {
    this._dragCleanup.forEach(fn => fn());
    this._dragCleanup = [];
    return super.close(options);
  }

  _draw() {
    const data = getTree();
    const nodes = this._visibleNodes(data);
    const visibleIds = new Set(nodes.map(n => n.id));
    const edges = data.edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));

    const nodesWrap = this._root.querySelector(".gm-cheatsheet-skilltree-nodes");
    const svg = this._root.querySelector(".gm-cheatsheet-skilltree-edges");
    nodesWrap.innerHTML = "";
    svg.innerHTML = "";

    const maxX = Math.max(400, ...nodes.map(n => n.x + 160), 0);
    const maxY = Math.max(400, ...nodes.map(n => n.y + 100), 0);
    svg.setAttribute("width", maxX);
    svg.setAttribute("height", maxY);
    nodesWrap.style.width = `${maxX}px`;
    nodesWrap.style.height = `${maxY}px`;

    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const e of edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.x + 20);
      line.setAttribute("y1", a.y + 20);
      line.setAttribute("x2", b.x + 20);
      line.setAttribute("y2", b.y + 20);
      line.setAttribute("class", "gm-cheatsheet-skilltree-edge");
      svg.appendChild(line);
    }

    this._dragCleanup.forEach(fn => fn());
    this._dragCleanup = [];

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
        if (this.isGM && this._linkMode) {
          if (!this._linkFrom) {
            this._linkFrom = n.id;
            div.classList.add("link-source");
            return;
          }
          if (this._linkFrom !== n.id) this._addEdge(this._linkFrom, n.id);
          this._linkFrom = null;
          this._linkMode = false;
          this._root.querySelector(".gm-cheatsheet-skilltree-link")?.classList.remove("active");
          return;
        }
        if (this.isGM) {
          this._selected = n.id;
          this._draw();
          this._renderInspector(n);
        }
      });

      if (this.isGM) this._makeDraggable(div, n);
      nodesWrap.appendChild(div);
    }
  }

  _makeDraggable(div, node) {
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;

    const onDown = (ev) => {
      if (this._linkMode) return;
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
      this._draw();
    };
    const onUp = async () => {
      if (!dragging) return;
      dragging = false;
      const data = getTree();
      const target = data.nodes.find(n => n.id === node.id);
      if (target) { target.x = node.x; target.y = node.y; }
      await setTree(data);
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

  async _addNode() {
    const data = getTree();
    const node = {
      id: foundry.utils.randomID(),
      label: "Nowy wezel",
      size: "small",
      state: "locked",
      x: 40,
      y: 40,
      visibleTo: []
    };
    data.nodes.push(node);
    await setTree(data);
    this._selected = node.id;
    this._draw();
    this._renderInspector(node);
  }

  async _addEdge(from, to) {
    const data = getTree();
    if (!data.edges.some(e => e.from === from && e.to === to)) data.edges.push({ from, to });
    await setTree(data);
    this._draw();
  }

  async _runAutoLayout() {
    const data = getTree();
    autoLayout(data.nodes, data.edges);
    await setTree(data);
    this._draw();
  }

  _renderInspector(node) {
    const panel = this._root.querySelector(".gm-cheatsheet-skilltree-inspector");
    if (!panel) return;
    const players = game.users.filter(u => !u.isGM);

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
          `).join("")}
        </div>
      </div>
      <button type="button" class="gm-cheatsheet-skilltree-i-delete"><i class="fas fa-trash"></i> Usun wezel</button>
    `;

    const commit = async (patch) => {
      const data = getTree();
      const target = data.nodes.find(n => n.id === node.id);
      Object.assign(target, patch);
      await setTree(data);
      this._draw();
    };

    panel.querySelector(".gm-cheatsheet-skilltree-i-label").addEventListener("change", (ev) => commit({ label: ev.currentTarget.value }));
    panel.querySelector(".gm-cheatsheet-skilltree-i-size").addEventListener("change", (ev) => commit({ size: ev.currentTarget.value }));
    panel.querySelector(".gm-cheatsheet-skilltree-i-state").addEventListener("change", (ev) => commit({ state: ev.currentTarget.value }));

    panel.querySelectorAll(".gm-cheatsheet-skilltree-i-visible input").forEach(cb => {
      cb.addEventListener("change", async () => {
        const data = getTree();
        const target = data.nodes.find(n => n.id === node.id);
        const set = new Set(target.visibleTo ?? []);
        if (cb.checked) set.add(cb.dataset.uid); else set.delete(cb.dataset.uid);
        target.visibleTo = [...set];
        await setTree(data);
      });
    });

    panel.querySelector(".gm-cheatsheet-skilltree-i-delete").addEventListener("click", async () => {
      const data = getTree();
      data.nodes = data.nodes.filter(n => n.id !== node.id);
      data.edges = data.edges.filter(e => e.from !== node.id && e.to !== node.id);
      this._selected = null;
      await setTree(data);
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
    .gm-cheatsheet-skilltree-toolbar { display: flex; gap: 6px; margin-bottom: 6px; }
    .gm-cheatsheet-skilltree-toolbar button.active { background: rgba(138,109,59,0.4); }
    .gm-cheatsheet-skilltree-canvas-wrap {
      position: relative; flex: 1; overflow: auto;
      border: 1px solid rgba(0,0,0,0.3);
      background: repeating-linear-gradient(45deg, rgba(0,0,0,0.03) 0 10px, transparent 10px 20px);
    }
    .gm-cheatsheet-skilltree-edges { position: absolute; top: 0; left: 0; pointer-events: none; }
    .gm-cheatsheet-skilltree-edge { stroke: rgba(0,0,0,0.5); stroke-width: 2; }
    .gm-cheatsheet-skilltree-nodes { position: relative; }
    .gm-cheatsheet-skilltree-node {
      position: absolute; display: flex; align-items: center; justify-content: center;
      border-radius: 50%; border: 3px solid var(--gmch-node-color, #555);
      background: rgba(20,20,20,0.85); color: #fff; cursor: pointer; text-align: center;
      padding: 4px; user-select: none;
    }
    .gm-cheatsheet-skilltree-node-small { width: 40px; height: 40px; font-size: 9px; }
    .gm-cheatsheet-skilltree-node-large { width: 64px; height: 64px; font-size: 11px; }
    .gm-cheatsheet-skilltree-node.selected { outline: 2px solid #fff; }
    .gm-cheatsheet-skilltree-node.link-source { outline: 2px dashed #ffd166; }
    .gm-cheatsheet-skilltree-inspector {
      border-top: 1px solid rgba(0,0,0,0.3); margin-top: 6px; padding-top: 6px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .gm-cheatsheet-skilltree-inspector-row { display: flex; align-items: center; gap: 8px; }
    .gm-cheatsheet-skilltree-inspector-row label { min-width: 90px; }
    .gm-cheatsheet-skilltree-i-visible { display: flex; flex-wrap: wrap; gap: 8px; }
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
    default: { nodes: [], edges: [] }
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
