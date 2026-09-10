const MODULE_ID = "gm-cheatsheet-importer";

/* -------------------------------------------- */
/*  Bonus catalogue                              */
/*  kind "info": no bar, just a static line      */
/*  kind "tiered": progress bar with N tiers,    */
/*    each tier has its own cap + multiplier     */
/*    (so a later tier can use a different       */
/*    multiplier than an earlier one)            */
/*  shared: true -> one value for ALL player      */
/*    tabs instead of one per tab                */
/* -------------------------------------------- */

const BONUS_DEFS = [
  { id: "exp", label: "Bonus doswiadczenia", icon: "fa-star", kind: "info", infoText: "+5%" },
  {
    id: "wyznawcy", label: "Wyznawcy / kongregacja", icon: "fa-place-of-worship", kind: "tiered", shared: true,
    tiers: [{ cap: 10, mult: 3 }, { cap: 100, mult: 3 }, { cap: 1000, mult: 3 }]
  },
  {
    id: "profesja", label: "Rozwoj profesji", icon: "fa-briefcase", kind: "tiered",
    tiers: [{ cap: 10, mult: 1 }, { cap: 15, mult: 1 }, { cap: 20, mult: 1 }],
    completedLabel: "Tier 4"
  },
  {
    id: "umiejetnosc", label: "Umiejetnosc spoza klasy", icon: "fa-graduation-cap", kind: "tiered",
    tiers: [{ cap: 20, mult: 1 }]
  },
  {
    id: "poczytalnosc", label: "Odzyskiwanie Poczytalnosci", icon: "fa-brain", kind: "tiered",
    tiers: [{ cap: 20, mult: 1 }]
  },
  {
    id: "npc", label: "Relacje z NPC", icon: "fa-handshake", kind: "tiered",
    tiers: [{ cap: 20, mult: 2 }, { cap: 20, mult: 2 }, { cap: 20, mult: 2 }, { cap: 20, mult: 2 }, { cap: 20, mult: 2 }]
  }
];

const SAFE_BASE = 2;

function baseFromRoll(n) {
  if (n === 1) return { label: "Krytyczna porazka", points: -1 };
  if (n <= 5) return { label: "Duza porazka", points: 0 };
  if (n <= 10) return { label: "Porazka", points: 1 };
  if (n <= 15) return { label: "Sukces", points: 3 };
  if (n <= 19) return { label: "Duzy sukces", points: 4 };
  return { label: "Krytyczny sukces", points: 5 };
}

/* -------------------------------------------- */
/*  Storage                                      */
/* -------------------------------------------- */

function initialBonusState() {
  return { tierIndex: 0, value: 0, completed: false, color: "#8a6d3b" };
}

function makeTab(name) {
  const bonuses = {};
  for (const def of BONUS_DEFS) {
    if (def.kind !== "tiered" || def.shared) continue;
    bonuses[def.id] = initialBonusState();
  }
  return { id: foundry.utils.randomID(), name, bonuses };
}

function getProgress() {
  const data = game.settings.get(MODULE_ID, "progress") ?? { tabs: [], shared: {} };
  if (!Array.isArray(data.tabs)) data.tabs = [];
  if (!data.shared || typeof data.shared !== "object") data.shared = {};

  for (const def of BONUS_DEFS) {
    if (def.kind !== "tiered" || !def.shared) continue;
    if (!data.shared[def.id]) data.shared[def.id] = initialBonusState();
  }
  for (const tab of data.tabs) {
    if (!tab.bonuses) tab.bonuses = {};
    for (const def of BONUS_DEFS) {
      if (def.kind !== "tiered" || def.shared) continue;
      if (!tab.bonuses[def.id]) tab.bonuses[def.id] = initialBonusState();
    }
  }
  return data;
}

async function setProgress(data) {
  await game.settings.set(MODULE_ID, "progress", data);
}

/** Points already earned toward the CURRENT tier get +points applied.
 *  Reaching/exceeding the tier cap completes that tier: excess is
 *  discarded (does not carry into the next tier) and either the next
 *  tier starts at 0, or — if this was the last tier — the bonus is
 *  marked fully completed and further points have no effect. */
function applyPoints(state, def, points) {
  if (state.completed) return state;
  const tier = def.tiers[state.tierIndex];
  const val = Math.max(0, state.value + points);
  if (val >= tier.cap) {
    if (state.tierIndex >= def.tiers.length - 1) {
      state.value = tier.cap;
      state.completed = true;
    } else {
      state.tierIndex += 1;
      state.value = 0;
    }
  } else {
    state.value = val;
  }
  return state;
}

/** Manual override: sets the CURRENT tier's raw value directly (not a
 *  delta). Works even on an already-completed bonus, so the GM can
 *  correct mistakes; setting a value below the tier cap un-completes it. */
function setAbsolute(state, def, rawValue) {
  const tier = def.tiers[state.tierIndex];
  const v = Math.max(0, Math.floor(Number(rawValue) || 0));
  if (v >= tier.cap) {
    if (state.tierIndex >= def.tiers.length - 1) {
      state.value = tier.cap;
      state.completed = true;
    } else {
      state.tierIndex += 1;
      state.value = 0;
    }
  } else {
    state.value = v;
    state.completed = false;
  }
  return state;
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

class ProgressApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gm-cheatsheet-progress-app",
      title: "Progres graczy",
      width: 700,
      height: "auto",
      resizable: true,
      classes: ["gm-cheatsheet-progress-app"]
    });
  }

  constructor(options = {}) {
    super(options);
    this._activeTabId = null;
  }

  async _renderInner() {
    const data = getProgress();
    if (!data.tabs.length) {
      data.tabs.push(makeTab("Gracz 1"));
      await setProgress(data);
    }
    if (!this._activeTabId || !data.tabs.some(t => t.id === this._activeTabId)) {
      this._activeTabId = data.tabs[0].id;
    }

    const tabsHtml = data.tabs.map(t => `
      <a class="item ${t.id === this._activeTabId ? "active" : ""}" data-tab="${t.id}">${t.name}</a>
    `).join("");

    const activeTab = data.tabs.find(t => t.id === this._activeTabId);
    const rowsHtml = BONUS_DEFS.map(def => this._renderRow(def, activeTab, data)).join("");

    const html = `
      <div class="gm-cheatsheet-progress-root">
        <nav class="tabs gm-cheatsheet-progress-tabs">
          ${tabsHtml}
          <a class="item gm-cheatsheet-progress-add-tab" title="Dodaj karte gracza"><i class="fas fa-plus"></i></a>
        </nav>
        <div class="gm-cheatsheet-progress-tab-actions">
          <a class="gm-cheatsheet-progress-rename-tab"><i class="fas fa-pen"></i> Zmien nazwe</a>
          <a class="gm-cheatsheet-progress-delete-tab"><i class="fas fa-trash"></i> Usun karte</a>
        </div>
        ${rowsHtml}
      </div>
    `;
    return $(html);
  }

  _renderRow(def, activeTab, data) {
    if (def.kind === "info") {
      return `
        <div class="gm-cheatsheet-progress-row gm-cheatsheet-progress-row-info">
          <div class="gm-cheatsheet-progress-icon"><i class="fas ${def.icon}"></i></div>
          <div class="gm-cheatsheet-progress-label">${def.label}</div>
          <div class="gm-cheatsheet-progress-info-text">${def.infoText}</div>
        </div>`;
    }

    const state = def.shared ? data.shared[def.id] : activeTab.bonuses[def.id];
    const tier = def.tiers[state.tierIndex];
    const pct = Math.min(100, (state.value / tier.cap) * 100);
    const tierBadges = Array.from({ length: state.tierIndex }).map((_, i) =>
      `<i class="fas fa-check-circle gm-cheatsheet-progress-tier-badge" title="Tier ${i + 1} ukonczony"></i>`
    ).join("");
    const tierLabel = state.completed
      ? (def.completedLabel ?? "Ukonczono")
      : `Tier ${state.tierIndex + 1}/${def.tiers.length}`;

    return `
      <div class="gm-cheatsheet-progress-row" data-bonus="${def.id}">
        <div class="gm-cheatsheet-progress-icon ${state.completed ? "completed" : ""}"><i class="fas ${def.icon}"></i></div>
        <div class="gm-cheatsheet-progress-label">
          ${def.label}
          <div class="gm-cheatsheet-progress-tier-line">
            <span class="gm-cheatsheet-progress-tier-text">${tierLabel}</span>
            ${tierBadges}
            ${def.shared ? '<span class="gm-cheatsheet-progress-shared-tag">wspolny</span>' : ""}
          </div>
        </div>
        <div class="gm-cheatsheet-progress-bar-wrap"
             style="--gmch-color:${state.color}; --gmch-fill:${pct}%;">
          <div class="gm-cheatsheet-progress-ribbon-main"></div>
          <div class="gm-cheatsheet-progress-ribbon-accent"></div>
          <span class="gm-cheatsheet-progress-value">${state.value}/${tier.cap}</span>
        </div>
        <div class="gm-cheatsheet-progress-controls">
          <input type="color" class="gm-cheatsheet-progress-color" value="${state.color}" title="Kolor paska">
          <input type="number" class="gm-cheatsheet-progress-manual" value="${state.value}" min="0" title="Recznie ustaw wartosc biezacego tieru">
          <button type="button" class="gm-cheatsheet-progress-safe" ${state.completed ? "disabled" : ""} title="Bezpieczny postep (+${SAFE_BASE} x ${tier.mult})">
            <i class="fas fa-shield-halved"></i> +${SAFE_BASE * tier.mult}
          </button>
          <button type="button" class="gm-cheatsheet-progress-risky" ${state.completed ? "disabled" : ""} title="Ryzykowny postep (k20, mnoznik x${tier.mult})">
            <i class="fas fa-dice"></i> Rzut
          </button>
        </div>
      </div>`;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;

    root.querySelectorAll(".gm-cheatsheet-progress-tabs .item[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        this._activeTabId = tab.dataset.tab;
        this.render();
      });
    });

    root.querySelector(".gm-cheatsheet-progress-add-tab").addEventListener("click", async () => {
      const name = await promptText("Nowa karta gracza", `Gracz ${getProgress().tabs.length + 1}`);
      if (!name) return;
      const data = getProgress();
      const tab = makeTab(name);
      data.tabs.push(tab);
      await setProgress(data);
      this._activeTabId = tab.id;
      this.render();
    });

    root.querySelector(".gm-cheatsheet-progress-rename-tab").addEventListener("click", async () => {
      const data = getProgress();
      const tab = data.tabs.find(t => t.id === this._activeTabId);
      const name = await promptText("Zmien nazwe karty", tab.name);
      if (!name) return;
      tab.name = name;
      await setProgress(data);
      this.render();
    });

    root.querySelector(".gm-cheatsheet-progress-delete-tab").addEventListener("click", async () => {
      const data = getProgress();
      if (data.tabs.length <= 1) {
        ui.notifications.warn("Musi zostac przynajmniej jedna karta.");
        return;
      }
      const tab = data.tabs.find(t => t.id === this._activeTabId);
      const confirmed = await Dialog.confirm({
        title: "Usun karte",
        content: `<p>Na pewno usunac karte "${tab.name}"? Wspolne paski (np. Wyznawcy) nie zostana ruszone.</p>`
      });
      if (!confirmed) return;
      data.tabs = data.tabs.filter(t => t.id !== tab.id);
      await setProgress(data);
      this._activeTabId = data.tabs[0].id;
      this.render();
    });

    root.querySelectorAll(".gm-cheatsheet-progress-row[data-bonus]").forEach(row => {
      const bonusId = row.dataset.bonus;
      const def = BONUS_DEFS.find(d => d.id === bonusId);

      const getState = (data) => def.shared ? data.shared[bonusId] : data.tabs.find(t => t.id === this._activeTabId).bonuses[bonusId];

      row.querySelector(".gm-cheatsheet-progress-color").addEventListener("input", async (ev) => {
        const data = getProgress();
        getState(data).color = ev.currentTarget.value;
        await setProgress(data);
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-manual").addEventListener("change", async (ev) => {
        const data = getProgress();
        setAbsolute(getState(data), def, ev.currentTarget.value);
        await setProgress(data);
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-safe")?.addEventListener("click", async () => {
        const data = getProgress();
        const state = getState(data);
        const tier = def.tiers[state.tierIndex];
        const points = Math.floor(SAFE_BASE * tier.mult);
        applyPoints(state, def, points);
        await setProgress(data);
        ChatMessage.create({ content: `<strong>${def.label}${def.shared ? " (wspolny)" : ""} — bezpieczny postep:</strong> +${points}` });
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-risky")?.addEventListener("click", async () => {
        const data = getProgress();
        const state = getState(data);
        const tier = def.tiers[state.tierIndex];
        const roll = await new Roll("1d20").evaluate();
        const outcome = baseFromRoll(roll.total);
        const points = Math.floor(outcome.points * tier.mult);
        await roll.toMessage({ flavor: `${def.label}${def.shared ? " (wspolny)" : ""} — ryzykowny postep: ${outcome.label} (${points >= 0 ? "+" : ""}${points})` });
        applyPoints(state, def, points);
        await setProgress(data);
        this.render();
      });
    });
  }
}

function openProgress() {
  if (!game.user.isGM) {
    ui.notifications.warn("Tylko Mistrz Gry moze otworzyc progres graczy.");
    return;
  }
  if (!appInstance) appInstance = new ProgressApp();
  appInstance.render(true, { focus: true });
}

/* -------------------------------------------- */
/*  Styling                                      */
/* -------------------------------------------- */

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .gm-cheatsheet-progress-btn { display: inline-flex; align-items: center; gap: 4px; margin: 2px 4px; }
    .gm-cheatsheet-progress-root { display: flex; flex-direction: column; gap: 2px; }
    .gm-cheatsheet-progress-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid rgba(0,0,0,0.3); margin-bottom: 4px; }
    .gm-cheatsheet-progress-tabs .item { padding: 4px 10px; cursor: pointer; border-radius: 4px 4px 0 0; }
    .gm-cheatsheet-progress-tabs .item.active { background: rgba(0,0,0,0.15); font-weight: bold; }
    .gm-cheatsheet-progress-add-tab { font-weight: bold; }
    .gm-cheatsheet-progress-tab-actions { display: flex; gap: 14px; margin-bottom: 8px; font-size: 12px; }
    .gm-cheatsheet-progress-tab-actions a { cursor: pointer; opacity: 0.8; }
    .gm-cheatsheet-progress-tab-actions a:hover { opacity: 1; }

    .gm-cheatsheet-progress-row {
      display: grid; grid-template-columns: 26px 170px 1fr auto;
      align-items: center; gap: 10px; padding: 8px 0;
      border-bottom: 1px solid rgba(0,0,0,0.15);
    }
    .gm-cheatsheet-progress-row-info { opacity: 0.85; }
    .gm-cheatsheet-progress-info-text { grid-column: 3 / span 2; font-weight: bold; }
    .gm-cheatsheet-progress-icon { text-align: center; opacity: 0.85; font-size: 15px; }
    .gm-cheatsheet-progress-icon.completed i { color: #3ba55d; text-shadow: 0 0 4px rgba(59,165,93,0.6); }
    .gm-cheatsheet-progress-label { font-weight: bold; font-size: 12px; }
    .gm-cheatsheet-progress-tier-line { display: flex; align-items: center; gap: 4px; font-weight: normal; opacity: 0.75; font-size: 10px; margin-top: 2px; }
    .gm-cheatsheet-progress-tier-badge { color: #3ba55d; font-size: 10px; }
    .gm-cheatsheet-progress-shared-tag { background: rgba(0,0,0,0.15); border-radius: 3px; padding: 0 4px; }

    .gm-cheatsheet-progress-bar-wrap { position: relative; height: 30px; }
    .gm-cheatsheet-progress-ribbon-main, .gm-cheatsheet-progress-ribbon-accent {
      position: absolute; left: 0; width: var(--gmch-fill, 0%);
      clip-path: polygon(0 0, 92% 0, 100% 50%, 92% 100%, 0 100%);
      transition: width 0.3s ease;
    }
    .gm-cheatsheet-progress-ribbon-main {
      top: 0; height: 20px;
      background-color: var(--gmch-color, #8a6d3b);
      background-image:
        repeating-linear-gradient(65deg, rgba(255,255,255,0.28) 0 7px, rgba(255,255,255,0) 7px 14px),
        repeating-linear-gradient(-65deg, rgba(0,0,0,0.22) 0 7px, rgba(0,0,0,0) 7px 14px);
      background-blend-mode: overlay, multiply;
      border: 1px solid rgba(0,0,0,0.5);
    }
    .gm-cheatsheet-progress-ribbon-accent {
      top: 22px; height: 6px;
      background-color: var(--gmch-color, #8a6d3b);
      filter: hue-rotate(150deg) brightness(1.05);
      opacity: 0.9;
    }
    .gm-cheatsheet-progress-value {
      position: absolute; left: 0; top: 0; height: 20px; width: 100%;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: #fff; text-shadow: 0 0 2px #000; z-index: 2; pointer-events: none;
    }
    .gm-cheatsheet-progress-controls { display: flex; align-items: center; gap: 4px; }
    .gm-cheatsheet-progress-color { width: 26px; height: 24px; padding: 0; border: none; background: none; }
    .gm-cheatsheet-progress-manual { width: 54px; }
    .gm-cheatsheet-progress-safe:disabled, .gm-cheatsheet-progress-risky:disabled { opacity: 0.4; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "progress", {
    scope: "world",
    config: false,
    type: Object,
    default: { tabs: [], shared: {} }
  });

  const mod = game.modules.get(MODULE_ID);
  mod.api = Object.assign(mod.api ?? {}, { openProgress });

  injectStyles();
});

Hooks.on("renderJournalDirectory", (app, htmlOrElement) => {
  if (!game.user.isGM) return;

  const root = htmlOrElement instanceof HTMLElement ? htmlOrElement : htmlOrElement[0];
  if (!root || root.querySelector(".gm-cheatsheet-progress-btn")) return;

  const header = root.querySelector(".directory-header .action-buttons")
    ?? root.querySelector(".directory-header")
    ?? root.querySelector(".header-actions");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gm-cheatsheet-progress-btn";
  button.innerHTML = '<i class="fas fa-chart-simple"></i> Progres graczy';
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    openProgress();
  });

  if (header) header.appendChild(button);
  else root.prepend(button);
});
