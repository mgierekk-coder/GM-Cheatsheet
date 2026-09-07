const MODULE_ID = "gm-cheatsheet-importer";

/* -------------------------------------------- */
/*  Helpers: tiny markdown-lite + escaping       */
/* -------------------------------------------- */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function mdLite(text) {
  const lines = escapeHtml(text).split(/\r?\n/);
  let html = "";
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineMd(line.slice(2))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += line === "" ? "" : `<p>${inlineMd(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "kategoria";
}

/* -------------------------------------------- */
/*  Parser                                       */
/* -------------------------------------------- */

/**
 * @param {string} raw
 * @returns {Array<{title:string, categories:Array<{name:string,content:string}>, raw:string}>}
 */
function parseSessions(raw) {
  const sessions = [];
  const blocks = raw.split(/^###\s*SESJA:/im).slice(1);

  for (const block of blocks) {
    const endIdx = block.search(/^###\s*END\s*$/im);
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;

    const lines = body.split(/\r?\n/);
    const title = (lines.shift() ?? "").trim();
    if (!title) continue;

    const rest = lines.join("\n");

    // Find every "## Category" header line: where the header line itself starts
    // (lineStart) and where its content begins, right after the header (contentStart).
    const headerRe = /^##\s*(.+)$/gm;
    const headers = [];
    let m;
    while ((m = headerRe.exec(rest)) !== null) {
      headers.push({ name: m[1].trim(), lineStart: m.index, contentStart: m.index + m[0].length });
    }

    const categories = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].contentStart;
      const end = i + 1 < headers.length ? headers[i + 1].lineStart : rest.length;
      const content = rest.slice(start, end).trim();
      if (content) categories.push({ name: headers[i].name, content });
    }

    sessions.push({
      title,
      categories,
      raw: `### SESJA: ${title}\n${rest.trim()}\n### END`
    });
  }

  return sessions;
}

/* -------------------------------------------- */
/*  Storage                                      */
/* -------------------------------------------- */

function getSessions() {
  return game.settings.get(MODULE_ID, "sessions") ?? [];
}

async function setSessions(sessions) {
  await game.settings.set(MODULE_ID, "sessions", sessions);
}

async function importSessions(parsed) {
  const current = getSessions();
  let created = 0;
  let updated = 0;

  for (const session of parsed) {
    const idx = current.findIndex(s => s.title === session.title);
    if (idx >= 0) {
      current[idx] = session;
      updated++;
    } else {
      current.push(session);
      created++;
    }
  }

  await setSessions(current);
  return { created, updated };
}

async function deleteSession(title) {
  const current = getSessions().filter(s => s.title !== title);
  await setSessions(current);
}

function collectCategoryNames(sessions) {
  const seen = new Map(); // slug -> display name (first-seen casing)
  for (const s of sessions) {
    for (const c of s.categories) {
      const slug = slugify(c.name);
      if (!seen.has(slug)) seen.set(slug, c.name);
    }
  }
  return seen; // Map<slug, displayName>
}

/* -------------------------------------------- */
/*  Import dialog                                */
/* -------------------------------------------- */

class SessionImportDialog extends Dialog {
  constructor(prefill = "", onDone = null) {
    super({
      title: "Import sesji MG",
      content: `
        <form class="gm-cheatsheet-sessions-form">
          <p>Format: <code>### SESJA: Tytul</code>, potem dowolne sekcje <code>## Kategoria</code>, na koncu <code>### END</code>. Mozna wkleic wiele sesji naraz.</p>
          <textarea name="raw" rows="18" style="width:100%; font-family: monospace;" placeholder="### SESJA: 2026-09-14 - Najazd na wioske&#10;## NPC&#10;**Wodz Grum** - przywodca najezdzcow...&#10;## SCENY&#10;1. Przybycie do wioski...&#10;### END">${escapeHtml(prefill)}</textarea>
        </form>
      `,
      buttons: {
        import: {
          icon: '<i class="fas fa-file-import"></i>',
          label: "Importuj",
          callback: async (html) => {
            const el = html[0]?.querySelector?.("textarea") ?? html.querySelector?.("textarea");
            const raw = el?.value ?? "";
            const parsed = parseSessions(raw);
            if (!parsed.length) {
              ui.notifications.warn("Nie znaleziono zadnych sesji ### SESJA ... ### END w wklejonym tekscie.");
              return;
            }
            const { created, updated } = await importSessions(parsed);
            ui.notifications.info(`Sesje MG: zaimportowano ${created} nowych i zaktualizowano ${updated} istniejacych.`);
            if (onDone) onDone();
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Anuluj" }
      },
      default: "import"
    }, { width: 640, id: "gm-cheatsheet-sessions-import-dialog" });
  }
}

/* -------------------------------------------- */
/*  Main window                                  */
/* -------------------------------------------- */

let appInstance = null;

class SessionsApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gm-cheatsheet-sessions-app",
      title: "Sesje MG",
      width: 760,
      height: 640,
      resizable: true,
      classes: ["gm-cheatsheet-sessions-app"]
    });
  }

  constructor(options = {}) {
    super(options);
    this._activeTab = "sesje";
  }

  async _renderInner() {
    const sessions = getSessions().slice().sort((a, b) => b.title.localeCompare(a.title));
    const categories = collectCategoryNames(sessions);

    const tabsHtml = [
      `<a class="item ${this._activeTab === "sesje" ? "active" : ""}" data-tab="sesje">Sesje</a>`,
      ...Array.from(categories.entries()).map(([slug, name]) =>
        `<a class="item ${this._activeTab === slug ? "active" : ""}" data-tab="${slug}">${escapeHtml(name)}</a>`
      )
    ].join("");

    let bodyHtml;
    if (this._activeTab === "sesje") {
      bodyHtml = this._renderSesjeTab(sessions);
    } else {
      const displayName = categories.get(this._activeTab) ?? this._activeTab;
      bodyHtml = this._renderCategoryTab(sessions, this._activeTab, displayName);
    }

    const html = `
      <div class="gm-cheatsheet-sessions-root">
        <div class="gm-cheatsheet-sessions-toolbar">
          <button type="button" class="gm-cheatsheet-sessions-import-btn">
            <i class="fas fa-file-import"></i> Importuj sesje
          </button>
        </div>
        <nav class="tabs gm-cheatsheet-sessions-tabs">${tabsHtml}</nav>
        <div class="gm-cheatsheet-sessions-search">
          <input type="text" class="gm-cheatsheet-sessions-search-input" placeholder="Szukaj...">
        </div>
        <div class="gm-cheatsheet-sessions-body">${bodyHtml}</div>
      </div>
    `;
    return $(html);
  }

  _renderSesjeTab(sessions) {
    if (!sessions.length) return `<p class="gm-cheatsheet-sessions-empty">Brak zapisanych sesji. Kliknij "Importuj sesje", zeby dodac pierwsza.</p>`;

    return sessions.map(s => `
      <div class="gm-cheatsheet-sessions-card" data-searchtext="${escapeHtml((s.title + " " + s.categories.map(c => c.name + " " + c.content).join(" ")).toLowerCase())}">
        <div class="gm-cheatsheet-sessions-card-header">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="gm-cheatsheet-sessions-card-actions">
            <a class="gm-cheatsheet-sessions-edit" data-title="${escapeHtml(s.title)}" title="Edytuj"><i class="fas fa-edit"></i></a>
            <a class="gm-cheatsheet-sessions-delete" data-title="${escapeHtml(s.title)}" title="Usun"><i class="fas fa-trash"></i></a>
          </div>
        </div>
        ${s.categories.map(c => `
          <div class="gm-cheatsheet-sessions-category-block">
            <h4>${escapeHtml(c.name)}</h4>
            ${mdLite(c.content)}
          </div>
        `).join("")}
      </div>
    `).join("");
  }

  _renderCategoryTab(sessions, slug, displayName) {
    const items = [];
    for (const s of sessions) {
      for (const c of s.categories) {
        if (slugify(c.name) === slug) items.push({ session: s.title, content: c.content });
      }
    }
    if (!items.length) return `<p class="gm-cheatsheet-sessions-empty">Brak wpisow w kategorii "${escapeHtml(displayName)}".</p>`;

    return items.map(it => `
      <div class="gm-cheatsheet-sessions-card" data-searchtext="${escapeHtml((it.session + " " + it.content).toLowerCase())}">
        <div class="gm-cheatsheet-sessions-card-header">
          <h4>${escapeHtml(it.session)}</h4>
        </div>
        ${mdLite(it.content)}
      </div>
    `).join("");
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;

    root.querySelector(".gm-cheatsheet-sessions-import-btn")?.addEventListener("click", () => {
      new SessionImportDialog("", () => this.render()).render(true);
    });

    root.querySelectorAll(".gm-cheatsheet-sessions-tabs .item").forEach(tab => {
      tab.addEventListener("click", () => {
        this._activeTab = tab.dataset.tab;
        this.render();
      });
    });

    root.querySelectorAll(".gm-cheatsheet-sessions-delete").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const title = btn.dataset.title;
        const confirmed = await Dialog.confirm({
          title: "Usun sesje",
          content: `<p>Na pewno usunac sesje "${escapeHtml(title)}"?</p>`
        });
        if (confirmed) {
          await deleteSession(title);
          this.render();
        }
      });
    });

    root.querySelectorAll(".gm-cheatsheet-sessions-edit").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const title = btn.dataset.title;
        const session = getSessions().find(s => s.title === title);
        new SessionImportDialog(session?.raw ?? "", () => this.render()).render(true);
      });
    });

    const searchInput = root.querySelector(".gm-cheatsheet-sessions-search-input");
    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      root.querySelectorAll(".gm-cheatsheet-sessions-card").forEach(card => {
        const text = card.dataset.searchtext ?? "";
        card.style.display = !q || text.includes(q) ? "" : "none";
      });
    });
  }
}

function openSessions() {
  if (!game.user.isGM) {
    ui.notifications.warn("Tylko Mistrz Gry moze otworzyc sesje MG.");
    return;
  }
  if (!appInstance) appInstance = new SessionsApp();
  appInstance.render(true, { focus: true });
}

/* -------------------------------------------- */
/*  Styling                                      */
/* -------------------------------------------- */

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .gm-cheatsheet-sessions-btn { display: inline-flex; align-items: center; gap: 4px; margin: 2px 4px; }
    .gm-cheatsheet-sessions-root { display: flex; flex-direction: column; height: 100%; }
    .gm-cheatsheet-sessions-toolbar { display: flex; justify-content: flex-end; padding: 4px 0; }
    .gm-cheatsheet-sessions-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--color-border-light-2, #782e22); margin-bottom: 6px; }
    .gm-cheatsheet-sessions-tabs .item { padding: 4px 8px; cursor: pointer; border-radius: 4px 4px 0 0; }
    .gm-cheatsheet-sessions-tabs .item.active { background: rgba(0,0,0,0.15); font-weight: bold; }
    .gm-cheatsheet-sessions-search { margin-bottom: 6px; }
    .gm-cheatsheet-sessions-search-input { width: 100%; box-sizing: border-box; }
    .gm-cheatsheet-sessions-body { flex: 1; overflow-y: auto; }
    .gm-cheatsheet-sessions-card { border: 1px solid rgba(0,0,0,0.2); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
    .gm-cheatsheet-sessions-card-header { display: flex; justify-content: space-between; align-items: center; }
    .gm-cheatsheet-sessions-card-actions a { margin-left: 6px; cursor: pointer; }
    .gm-cheatsheet-sessions-category-block { margin-top: 4px; }
    .gm-cheatsheet-sessions-category-block h4 { margin-bottom: 2px; opacity: 0.8; }
    .gm-cheatsheet-sessions-empty { opacity: 0.7; font-style: italic; }
  `;
  document.head.appendChild(style);
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "sessions", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  const mod = game.modules.get(MODULE_ID);
  mod.api = Object.assign(mod.api ?? {}, { openSessions });

  injectStyles();
});

Hooks.on("renderJournalDirectory", (app, htmlOrElement) => {
  if (!game.user.isGM) return;

  const root = htmlOrElement instanceof HTMLElement ? htmlOrElement : htmlOrElement[0];
  if (!root || root.querySelector(".gm-cheatsheet-sessions-btn")) return;

  const header = root.querySelector(".directory-header .action-buttons")
    ?? root.querySelector(".directory-header")
    ?? root.querySelector(".header-actions");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gm-cheatsheet-sessions-btn";
  button.innerHTML = '<i class="fas fa-calendar-alt"></i> Sesje MG';
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    openSessions();
  });

  if (header) header.appendChild(button);
  else root.prepend(button);
});
