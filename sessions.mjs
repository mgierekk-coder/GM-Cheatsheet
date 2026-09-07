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
 * Parse a single "### Name ... " entity sub-block.
 * Leading ALL-CAPS "FIELD: value" lines (before the first non-matching,
 * non-blank line) become structured fields; IMAGE: is pulled out separately;
 * everything after that is free-text description (markdown-lite).
 */
function parseEntityBody(name, body) {
  const lines = body.split(/\r?\n/);
  const fields = {};
  let image = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "") { i++; continue; }
    const fieldMatch = line.match(/^([A-ZĄĆĘŁŃÓŚŹŻ0-9][A-ZĄĆĘŁŃÓŚŹŻ0-9 ]{1,30}):\s*(.+)$/);
    if (fieldMatch) {
      const key = fieldMatch[1].trim();
      const value = fieldMatch[2].trim();
      if (key.toUpperCase() === "IMAGE") image = value;
      else fields[key] = value;
      i++;
    } else {
      break;
    }
  }

  const description = lines.slice(i).join("\n").trim();
  return { name, fields, image, description };
}

/**
 * Split a category's raw content into:
 * - preamble: any free text before the first "### Name" sub-header (or all of
 *   it, if there are no sub-headers at all)
 * - entries: parsed entity sub-blocks, if any
 */
function parseCategoryContent(content) {
  const parts = content.split(/^###\s+(.+)$/gm);
  const preamble = (parts[0] ?? "").trim();
  const entries = [];
  for (let i = 1; i < parts.length; i += 2) {
    const name = (parts[i] ?? "").trim();
    const body = (parts[i + 1] ?? "").trim();
    if (!name) continue;
    entries.push(parseEntityBody(name, body));
  }
  return { preamble, entries };
}

/**
 * @param {string} raw
 * @returns {Array<{title:string, categories:Array, raw:string}>}
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

    const headerRe = /^##(?!#)\s*(.+)$/gm;
    const headers = [];
    let m;
    while ((m = headerRe.exec(rest)) !== null) {
      headers.push({ name: m[1].trim(), lineStart: m.index, contentStart: m.index + m[0].length });
    }

    const categories = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].contentStart;
      const end = i + 1 < headers.length ? headers[i + 1].lineStart : rest.length;
      const rawContent = rest.slice(start, end).trim();
      if (!rawContent) continue;
      const { preamble, entries } = parseCategoryContent(rawContent);
      categories.push({ name: headers[i].name, content: rawContent, preamble, entries });
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
  const seen = new Map();
  for (const s of sessions) {
    for (const c of s.categories) {
      const slug = slugify(c.name);
      if (!seen.has(slug)) seen.set(slug, c.name);
    }
  }
  return seen;
}

/**
 * For one category slug, gather:
 * - entities: merged, alphabetically-sorted list of "### Name" records
 *   (later sessions, in stored/import order, overwrite earlier ones with the
 *   same name)
 * - notes: freeform per-session snippets (preamble text, or the whole
 *   category content when it has no ### sub-headers at all)
 */
function collectCategoryData(sessions, slug) {
  const entityMap = new Map();
  const notes = [];

  for (const s of sessions) {
    for (const c of s.categories) {
      if (slugify(c.name) !== slug) continue;

      for (const e of c.entries ?? []) {
        entityMap.set(e.name, e);
      }

      if (c.entries?.length) {
        if (c.preamble) notes.push({ session: s.title, content: c.preamble });
      } else if (c.content) {
        notes.push({ session: s.title, content: c.content });
      }
    }
  }

  const entities = Array.from(entityMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));

  return { entities, notes };
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
          <p>Format: <code>### SESJA: Tytul</code>, sekcje <code>## Kategoria</code>, opcjonalnie w kategorii podnaglowki <code>### Imie</code> z polami (np. WIEK:, RASA:, IMAGE:) i opisem, na koncu <code>### END</code>.</p>
          <button type="button" class="gm-cheatsheet-sessions-browse-btn">
            <i class="fas fa-image"></i> Wybierz obrazek (wstawi IMAGE: w miejscu kursora)
          </button>
          <textarea name="raw" rows="18" style="width:100%; font-family: monospace;" placeholder="### SESJA: 2026-09-21 - Poscig za Grumem&#10;## NPC&#10;### Wodz Grum&#10;WIEK: 45&#10;RASA: Orkowie&#10;Przywodca najezdzcow...&#10;### END">${escapeHtml(prefill)}</textarea>
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
      default: "import",
      render: (html) => {
        const root = html[0] ?? html;
        const textarea = root.querySelector("textarea[name=raw]");
        root.querySelector(".gm-cheatsheet-sessions-browse-btn")?.addEventListener("click", () => {
          new FilePicker({
            type: "image",
            callback: (path) => {
              const insertText = `IMAGE: ${path}\n`;
              const start = textarea.selectionStart ?? textarea.value.length;
              const end = textarea.selectionEnd ?? textarea.value.length;
              textarea.value = textarea.value.slice(0, start) + insertText + textarea.value.slice(end);
              textarea.focus();
              const caret = start + insertText.length;
              textarea.selectionStart = textarea.selectionEnd = caret;
            }
          }).render(true);
        });
      }
    }, { width: 640, id: "gm-cheatsheet-sessions-import-dialog" });
  }
}

/* -------------------------------------------- */
/*  Entity detail popup                          */
/* -------------------------------------------- */

function openEntityDetail(entity) {
  const fieldsHtml = Object.entries(entity.fields ?? {})
    .map(([k, v]) => `<div class="gm-cheatsheet-entity-field"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</div>`)
    .join("");

  const imageHtml = entity.image
    ? `<img class="gm-cheatsheet-entity-image" src="${escapeHtml(entity.image)}" alt="${escapeHtml(entity.name)}">`
    : "";

  const shareButtonHtml = (entity.image && game.user.isGM)
    ? `<button type="button" class="gm-cheatsheet-entity-share"><i class="fas fa-share-square"></i> Otworz obrazek (mozesz go stamtad udostepnic graczom)</button>`
    : "";

  const dialog = new Dialog({
    title: entity.name,
    content: `
      <div class="gm-cheatsheet-entity-detail">
        ${imageHtml}
        <div class="gm-cheatsheet-entity-fields">${fieldsHtml}</div>
        <div class="gm-cheatsheet-entity-description">${mdLite(entity.description ?? "")}</div>
        ${shareButtonHtml}
      </div>
    `,
    buttons: {
      close: { icon: '<i class="fas fa-times"></i>', label: "Zamknij" }
    },
    default: "close",
    render: (html) => {
      const root = html[0] ?? html;
      root.querySelector(".gm-cheatsheet-entity-share")?.addEventListener("click", () => {
        try {
          new ImagePopout(entity.image, { title: entity.name, shareable: true }).render(true);
        } catch (err) {
          console.error(`${MODULE_ID} |`, err);
          window.open(entity.image, "_blank");
        }
      });
    }
  }, { width: 480, id: `gm-cheatsheet-entity-detail-${slugify(entity.name)}` });

  dialog.render(true);
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
      width: 780,
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
            ${c.entries?.length ? c.entries.map(e => `
              <div class="gm-cheatsheet-sessions-entity-mini">
                <strong>${escapeHtml(e.name)}</strong>
                ${mdLite(e.description)}
              </div>
            `).join("") : ""}
            ${c.preamble ? mdLite(c.preamble) : (!c.entries?.length ? mdLite(c.content) : "")}
          </div>
        `).join("")}
      </div>
    `).join("");
  }

  _renderCategoryTab(sessions, slug, displayName) {
    const { entities, notes } = collectCategoryData(sessions, slug);

    let html = "";

    if (entities.length) {
      html += `<div class="gm-cheatsheet-entity-grid">`;
      html += entities.map(e => `
        <button type="button" class="gm-cheatsheet-entity-btn" data-name="${escapeHtml(e.name)}" data-searchtext="${escapeHtml((e.name + " " + Object.values(e.fields ?? {}).join(" ") + " " + e.description).toLowerCase())}">
          ${escapeHtml(e.name)}
        </button>
      `).join("");
      html += `</div>`;
    }

    if (notes.length) {
      html += `<h4 class="gm-cheatsheet-notes-heading">Notatki z sesji</h4>`;
      html += notes.map(n => `
        <div class="gm-cheatsheet-sessions-card" data-searchtext="${escapeHtml((n.session + " " + n.content).toLowerCase())}">
          <div class="gm-cheatsheet-sessions-card-header"><h4>${escapeHtml(n.session)}</h4></div>
          ${mdLite(n.content)}
        </div>
      `).join("");
    }

    if (!entities.length && !notes.length) {
      html = `<p class="gm-cheatsheet-sessions-empty">Brak wpisow w kategorii "${escapeHtml(displayName)}".</p>`;
    }

    return html;
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

    root.querySelectorAll(".gm-cheatsheet-entity-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const { entities } = collectCategoryData(getSessions(), this._activeTab);
        const entity = entities.find(e => e.name === btn.dataset.name);
        if (entity) openEntityDetail(entity);
      });
    });

    const searchInput = root.querySelector(".gm-cheatsheet-sessions-search-input");
    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      root.querySelectorAll(".gm-cheatsheet-sessions-card, .gm-cheatsheet-entity-btn").forEach(el => {
        const text = el.dataset.searchtext ?? "";
        const show = !q || text.includes(q);
        el.style.display = show ? "" : "none";
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
    .gm-cheatsheet-sessions-entity-mini { margin: 4px 0; padding-left: 8px; border-left: 2px solid rgba(0,0,0,0.15); }
    .gm-cheatsheet-sessions-empty { opacity: 0.7; font-style: italic; }
    .gm-cheatsheet-notes-heading { margin-top: 10px; opacity: 0.7; }
    .gm-cheatsheet-entity-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; margin-bottom: 8px; }
    .gm-cheatsheet-entity-btn { padding: 8px; border-radius: 6px; cursor: pointer; text-align: center; background: rgba(0,0,0,0.08); border: 1px solid rgba(0,0,0,0.2); }
    .gm-cheatsheet-entity-btn:hover { background: rgba(0,0,0,0.18); }
    .gm-cheatsheet-entity-detail { display: flex; flex-direction: column; gap: 8px; }
    .gm-cheatsheet-entity-image { max-width: 100%; border-radius: 6px; }
    .gm-cheatsheet-entity-fields { display: flex; flex-direction: column; gap: 2px; opacity: 0.9; }
    .gm-cheatsheet-entity-share { margin-top: 4px; }
    .gm-cheatsheet-sessions-browse-btn { margin-bottom: 6px; }
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
