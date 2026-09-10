const MODULE_ID = "gm-cheatsheet-importer";

/* -------------------------------------------- */
/*  Storage                                      */
/* -------------------------------------------- */

function defaultBonuses() {
  return Array.from({ length: 7 }, (_, i) => ({
    id: `bonus-${i + 1}`,
    label: `Bonus ${i + 1}`,
    color: "#8a6d3b",
    texture: "marble",
    value: 0
  }));
}

function getProgress() {
  const data = game.settings.get(MODULE_ID, "progress") ?? { bonuses: defaultBonuses() };
  if (!Array.isArray(data.bonuses) || data.bonuses.length !== 7) data.bonuses = defaultBonuses();
  return data;
}

async function setProgress(data) {
  await game.settings.set(MODULE_ID, "progress", data);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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
      width: 620,
      height: "auto",
      resizable: true,
      classes: ["gm-cheatsheet-progress-app"]
    });
  }

  async _renderInner() {
    const data = getProgress();
    const rowsHtml = data.bonuses.map((b, i) => `
      <div class="gm-cheatsheet-progress-row" data-index="${i}">
        <input type="text" class="gm-cheatsheet-progress-label" value="${b.label}">
        <div class="gm-cheatsheet-progress-bar gm-cheatsheet-progress-bar-${b.texture}"
             style="--gmch-bar-color:${b.color}; --gmch-bar-fill:${b.value}%;">
          <div class="gm-cheatsheet-progress-fill"></div>
          <span class="gm-cheatsheet-progress-value">${b.value}%</span>
        </div>
        <div class="gm-cheatsheet-progress-controls">
          <input type="color" class="gm-cheatsheet-progress-color" value="${b.color}" title="Kolor paska">
          <select class="gm-cheatsheet-progress-texture" title="Tekstura paska">
            <option value="marble" ${b.texture === "marble" ? "selected" : ""}>Marmur</option>
            <option value="flat" ${b.texture === "flat" ? "selected" : ""}>Plaski</option>
          </select>
          <button type="button" class="gm-cheatsheet-progress-safe" title="Bezpieczny postep (+2)">
            <i class="fas fa-shield-halved"></i> +2
          </button>
          <button type="button" class="gm-cheatsheet-progress-risky" title="Ryzykowny postep (rzut -1/0/1/2/3)">
            <i class="fas fa-dice"></i> Rzut
          </button>
        </div>
      </div>
    `).join("");

    const html = `
      <div class="gm-cheatsheet-progress-root">
        <p class="gm-cheatsheet-progress-hint">Bezpieczny postep zawsze daje +2. Ryzykowny postep to rzut 1k5-2 (zakres od -1 do 3), wynik trafia na czat.</p>
        ${rowsHtml}
      </div>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;

    root.querySelectorAll(".gm-cheatsheet-progress-row").forEach(row => {
      const index = Number(row.dataset.index);

      row.querySelector(".gm-cheatsheet-progress-label").addEventListener("change", async (ev) => {
        const data = getProgress();
        data.bonuses[index].label = ev.currentTarget.value;
        await setProgress(data);
      });

      row.querySelector(".gm-cheatsheet-progress-color").addEventListener("input", async (ev) => {
        const data = getProgress();
        data.bonuses[index].color = ev.currentTarget.value;
        await setProgress(data);
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-texture").addEventListener("change", async (ev) => {
        const data = getProgress();
        data.bonuses[index].texture = ev.currentTarget.value;
        await setProgress(data);
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-safe").addEventListener("click", async () => {
        const data = getProgress();
        const b = data.bonuses[index];
        b.value = clamp(b.value + 2, 0, 100);
        await setProgress(data);
        ChatMessage.create({ content: `<strong>Bezpieczny postep:</strong> ${b.label} +2 (obecnie ${b.value}%)` });
        this.render();
      });

      row.querySelector(".gm-cheatsheet-progress-risky").addEventListener("click", async () => {
        const data = getProgress();
        const b = data.bonuses[index];
        const roll = await new Roll("1d5 - 2").evaluate();
        await roll.toMessage({ flavor: `Ryzykowny postep: ${b.label}` });
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
    .gm-cheatsheet-progress-root { display: flex; flex-direction: column; gap: 4px; }
    .gm-cheatsheet-progress-hint { opacity: 0.75; font-size: 12px; margin-bottom: 4px; }
    .gm-cheatsheet-progress-row {
      display: grid; grid-template-columns: 130px 1fr auto;
      align-items: center; gap: 10px; padding: 6px 0;
      border-bottom: 1px solid rgba(0,0,0,0.15);
    }
    .gm-cheatsheet-progress-label { font-weight: bold; }
    .gm-cheatsheet-progress-bar {
      position: relative; height: 22px; border-radius: 11px; overflow: hidden;
      background: rgba(0,0,0,0.35); border: 1px solid rgba(0,0,0,0.4);
    }
    .gm-cheatsheet-progress-fill {
      position: absolute; inset: 0; width: var(--gmch-bar-fill, 0%);
      background: var(--gmch-bar-color, #8a6d3b);
      transition: width 0.3s ease;
    }
    .gm-cheatsheet-progress-bar-marble .gm-cheatsheet-progress-fill {
      background-image:
        linear-gradient(var(--gmch-bar-color), var(--gmch-bar-color)),
        repeating-linear-gradient(115deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0) 2px, rgba(255,255,255,0) 6px, rgba(255,255,255,0.15) 9px, rgba(255,255,255,0) 14px),
        repeating-linear-gradient(25deg, rgba(0,0,0,0.25) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 10px, rgba(0,0,0,0.15) 12px, rgba(0,0,0,0) 18px);
      background-blend-mode: normal, overlay, multiply;
    }
    .gm-cheatsheet-progress-value {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: #fff; text-shadow: 0 0 2px #000; z-index: 2;
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
    default: { bonuses: defaultBonuses() }
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
