const MODULE_ID = "gm-cheatsheet-importer";

/* -------------------------------------------- */
/*  Parser                                       */
/* -------------------------------------------- */

function parseCheatsheet(raw) {
  const entries = [];
  const blocks = raw.split(/^###\s*ENTRY:/im).slice(1);

  for (const block of blocks) {
    const endIdx = block.search(/^###\s*END\s*$/im);
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;

    const lines = body.split(/\r?\n/);
    const name = (lines.shift() ?? "").trim();
    if (!name) continue;

    const rest = lines.join("\n");

    const typeMatch = rest.match(/^TYPE:\s*(.+)$/im);
    const type = typeMatch ? typeMatch[1].trim() : "inne";

    const imageMatch = rest.match(/^IMAGE:\s*(.+)$/im);
    const image = imageMatch ? imageMatch[1].trim() : null;

    const graczeIdx = rest.search(/^---\s*GRACZE\s*---\s*$/im);
    const mgIdx = rest.search(/^---\s*MG\s*---\s*$/im);

    let gmText = "";
    let playerText = null;

    if (mgIdx >= 0) {
      const mgStart = rest.indexOf("\n", mgIdx) + 1;
      const mgEnd = graczeIdx >= 0 ? graczeIdx : rest.length;
      gmText = rest.slice(mgStart, mgEnd).trim();
    }

    if (graczeIdx >= 0) {
      const pStart = rest.indexOf("\n", graczeIdx) + 1;
      playerText = rest.slice(pStart).trim();
      if (!playerText) playerText = null;
    }

    entries.push({ name, type, image, gmText, playerText });
  }

  return entries;
}

/* -------------------------------------------- */
/*  Import logic                                 */
/* -------------------------------------------- */

async function getOrCreateFolder(typeName) {
  let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === typeName);
  if (!folder) {
    folder = await Folder.create({ name: typeName, type: "JournalEntry", parent: null });
  }
  return folder;
}

async function importEntries(entries) {
  const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const MARKDOWN = CONST.JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN ?? 2;

  let created = 0;
  let updated = 0;

  for (const entry of entries) {
    const folder = await getOrCreateFolder(entry.type);

    const pages = [];

    pages.push({
      name: "Notatki MG",
      type: "text",
      text: { content: entry.gmText, format: MARKDOWN },
      ownership: { default: NONE }
    });

    if (entry.playerText) {
      pages.push({
        name: "Karta gracza",
        type: "text",
        text: { content: entry.playerText, format: MARKDOWN },
        ownership: { default: OBSERVER }
      });
    }

    if (entry.image) {
      pages.push({
        name: "Portret",
        type: "image",
        src: entry.image,
        ownership: { default: NONE }
      });
    }

    const existing = game.journal.find(j => j.name === entry.name && j.folder?.id === folder.id);

    if (existing) {
      const oldPageIds = existing.pages.map(p => p.id);
      if (oldPageIds.length) await existing.deleteEmbeddedDocuments("JournalEntryPage", oldPageIds);
      await existing.createEmbeddedDocuments("JournalEntryPage", pages);
      updated++;
    } else {
      await JournalEntry.create({
        name: entry.name,
        folder: folder.id,
        pages
      });
      created++;
    }
  }

  return { created, updated };
}

/* -------------------------------------------- */
/*  UI: import dialog                            */
/* -------------------------------------------- */

class ImporterDialog extends Dialog {
  constructor() {
    super({
      title: "Import sciagi MG",
      content: `
        <form class="gm-cheatsheet-importer-form">
          <p>Wklej tekst w formacie <code>### ENTRY: ... ### END</code>. Mozesz wkleic wiele wpisow naraz.</p>
          <textarea name="raw" rows="18" style="width:100%; font-family: monospace;" placeholder="### ENTRY: Nazwa wpisu&#10;TYPE: npc&#10;IMAGE: sciezka/do/pliku.webp&#10;--- MG ---&#10;Notatki widoczne wylacznie dla MG.&#10;--- GRACZE ---&#10;Opcjonalna sekcja widoczna dla graczy.&#10;### END"></textarea>
        </form>
      `,
      buttons: {
        import: {
          icon: '<i class="fas fa-file-import"></i>',
          label: "Importuj",
          callback: async (html) => {
            const el = html[0]?.querySelector?.("textarea") ?? html.querySelector?.("textarea");
            const raw = el?.value ?? "";
            const entries = parseCheatsheet(raw);
            if (!entries.length) {
              ui.notifications.warn("Nie znaleziono zadnych wpisow ### ENTRY ... ### END w wklejonym tekscie.");
              return;
            }
            try {
              const { created, updated } = await importEntries(entries);
              ui.notifications.info(`Sciaga MG: zaimportowano ${created} nowych i zaktualizowano ${updated} istniejacych wpisow.`);
            } catch (err) {
              console.error(`${MODULE_ID} |`, err);
              ui.notifications.error("Import nie powiodl sie - szczegoly w konsoli (F12).");
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Anuluj"
        }
      },
      default: "import"
    }, {
      width: 640,
      id: "gm-cheatsheet-importer-dialog"
    });
  }
}

function openImporter() {
  if (!game.user.isGM) {
    ui.notifications.warn("Tylko Mistrz Gry moze importowac sciagi.");
    return;
  }
  new ImporterDialog().render(true);
}

/* -------------------------------------------- */
/*  Injected styling (no separate CSS file)      */
/* -------------------------------------------- */

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .gm-cheatsheet-importer-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 2px 4px;
    }
    .gm-cheatsheet-importer-form textarea {
      resize: vertical;
    }
  `;
  document.head.appendChild(style);
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = { openImporter };
  injectStyles();
});

Hooks.on("renderJournalDirectory", (app, htmlOrElement) => {
  if (!game.user.isGM) return;

  const root = htmlOrElement instanceof HTMLElement ? htmlOrElement : htmlOrElement[0];
  if (!root || root.querySelector(".gm-cheatsheet-importer-btn")) return;

  const header = root.querySelector(".directory-header .action-buttons")
    ?? root.querySelector(".directory-header")
    ?? root.querySelector(".header-actions");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gm-cheatsheet-importer-btn";
  button.innerHTML = '<i class="fas fa-file-import"></i> Import sciagi MG';
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    openImporter();
  });

  if (header) header.appendChild(button);
  else root.prepend(button);
});
