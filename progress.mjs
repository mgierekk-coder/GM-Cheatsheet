const MODULE_ID = "gm-cheatsheet-importer";

/* -------------------------------------------- */
/*  Fixed bonus catalogue (from the session      */
/*  bonus system design — names/icons are not    */
/*  user-editable, only color + value per tab)   */
/* -------------------------------------------- */

const FIXED_BONUSES = [
  { id: "exp", label: "Bonus doswiadczenia", icon: "fa-star" },
  { id: "wyznawcy", label: "Wyznawcy / kongregacja", icon: "fa-place-of-worship" },
  { id: "profesja", label: "Rozwoj profesji", icon: "fa-briefcase" },
  { id: "umiejetnosc", label: "Umiejetnosc spoza klasy", icon: "fa-graduation-cap" },
  { id: "poczytalnosc", label: "Odzyskiwanie Poczytalnosci", icon: "fa-brain" },
  { id: "crafting", label: "Tworzenie przedmiotu", icon: "fa-hammer" },
  { id: "npc", label: "Relacje z NPC", icon: "fa-handshake" }
];

/* -------------------------------------------- */
/*  Storage                                      */
/* -------------------------------------------- */

function makeTab(name) {
  return {
    id: foundry.utils.randomID(),
    name,
    bonuses: FIXED_BONUSES.map(b => ({ id: b.id, value: 0, color: "#8a6d3b" }))
  };
}

function getProgress() {
  const data = game.settings.get(MODULE_ID, "progress") ?? { tabs: [] };
  if (!Array.isArray(data.tabs)) data.tabs = [];
  // migrate any tab missing a bonus row (e.g. after adding a new fixed bonus)
  for (const tab of data.tabs) {
    for (const b of FIXED_BONUSES) {
      if (!tab.bonuses.some(x => x.id === b.id)) tab.bonuses.push({ id: b.id, value: 0, color: "#8a6d3b" });
    }
  }
  return data;
}

async function setProgress(data) {
  await game.settings.set(MODULE_ID, "progress", data);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/* -------------------------------------------- */
/*  Tiny text-prompt dialog (no assumption about */
/*  Dialog.prompt existing across versions)      */
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
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Anuluj",
          callback: () => resolve(null)
        }
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
      width: 640,
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
      <a class="item ${t.id === this._activeTabId ? "active" : ""}" data-tab="${t.id}">
        ${t.name}
      </a>
    `).join("");

    const activeTab = data.tabs.find(t => t.id === this._activeTabId);
    const rowsHtml = activeTab.bonuses.map((b) => {
      const meta = FIXED_BONUSES.find(f => f.id === b.id);
      return `
      <div class="gm-cheatsheet-progress-row" data-bonus="${b.id}">
        <div class="gm-cheatsheet-progress-icon"><i class="fas ${meta.icon}"></i></div>
        <div class="gm-cheatsheet-progress-label">${meta.label}</div>
        <div class="gm-cheatsheet-progress-bar-wrap"
             style="--gmch-color:${b.color}; --gmch-fill:${b.value}%;">
          <div class="gm-cheatsheet-progress-ribbon-main"></div>
          <div class="gm-cheatsheet-progress-ribbon-accent"></div>
          <span class="gm-cheatsheet-progress-value">${b.value}%</span>
        </div>
        <div class="gm-cheatsheet-progress-controls">
          <input type="color" class="gm-cheatsheet-progress-color" value="${b.color}" title="Kolor paska">
          <button type="button" class="gm-cheatsheet-progress-safe" title="Bezpieczny postep (+2)">
            <i class="fas fa-shield-halved"></i> +2
          </button>
          <button type="button" class="gm-cheatsheet-progress-risky" title="Ryzykowny postep (rzut -1/0/1/2/3)">
            <i class="fas fa-dice"></i> Rzut
          </button>
        </div>
      </div>`;
    }).join("");

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
      if (!tab) return;
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
      if (!tab) return;
      const confirmed = await Dialog.confirm({
        title: "Usun karte",
        content: `<p>Na pewno usunac karte "${tab.name}"?</p>`
      });
      if (!confirmed) return;
      data.tabs = data.tabs.filter(t => t.id !== tab.id);
      await setProgress(data);
      this._activeTabId = data.tabs[0].id;
      this.render();
    });

    root.querySelectorAll(".gm-cheatsheet-progress-row").forEach(row => {
      const bonusId = row.dataset.bonus;

      row.querySelector(".gm-cheatsheet-progress-color").addEventListener("input", async (ev) => {
        const data = getProgress();
        const tab = data.tabs.find(t => t.id === this._activeTabId);
        tab.bonuses.find(b => b.id === bonusId).color = ev.currentTarget.value;
        await setProgress(data);
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-safe").addEventListener("click", async () => {
        const data = getProgress();
        const tab = data.tabs.find(t => t.id === this._activeTabId);
        const b = tab.bonuses.find(b => b.id === bonusId);
        b.value = clamp(b.value + 2, 0, 100);
        await setProgress(data);
        const meta = FIXED_BONUSES.find(f => f.id === bonusId);
        ChatMessage.create({ content: `<strong>${tab.name} — bezpieczny postep:</strong> ${meta.label} +2 (obecnie ${b.value}%)` });
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-risky").addEventListener("click", async () => {
        const data = getProgress();
        const tab = data.tabs.find(t => t.id === this._activeTabId);
        const b = tab.bonuses.find(b => b.id === bonusId);
        const meta = FIXED_BONUSES.find(f => f.id === bonusId);
        const roll = await new Roll("1d5 - 2").evaluate();
        await roll.toMessage({ flavor: `${tab.name} — ryzykowny postep: ${meta.label}` });
        b.value = clamp(b.value + roll.total, 0, 100);
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
      display: grid; grid-template-columns: 26px 150px 1fr auto;
      align-items: center; gap: 10px; padding: 8px 0;
      border-bottom: 1px solid rgba(0,0,0,0.15);
    }
    .gm-cheatsheet-progress-icon { text-align: center; opacity: 0.85; }
    .gm-cheatsheet-progress-label { font-weight: bold; font-size: 12px; }

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
    .gm-cheatsheet-progress-color { width: 28px; height: 24px; padding: 0; border: none; background: none; }
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
    default: { tabs: [] }
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
