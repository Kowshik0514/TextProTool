# TextPro

Personal productivity & text automation platform for Windows.

## Features

- **Command palette** — `Ctrl+Shift+Space` to search and run actions
- **Text snippets** — reusable templates with tags, categories, favorites, recents
- **Dynamic templates** — `{{clipboard}}`, `{{date}}`, `{{time}}`, `{{datetime}}`, `{{prompt:Label}}`, `{{var:Name}}`
- **Abbreviations** — type `;email` + space to expand (toggle in Settings)
- **Insertion modes** — paste, simulate typing, or auto
- **Extensible actions** — `text.insert`, `url.open`, `app.launch` via ActionRegistry / PluginHost
- **Import / export** — JSON backup of snippets, variables, settings
- **Local API** — `http://127.0.0.1:47821` for scripting hooks

## Quick start (development)

```bash
npm install
npm run dev
```

## Run without the terminal (daily use)

### Option A — Desktop shortcut (recommended for now)

```bash
npm run build
npm run shortcut
```

That puts a **TextPro** icon on your Desktop. Double-click it anytime — no terminal needed. The app stays in the system tray.

You can also double-click `StartTextPro.vbs` in the project folder.

### Start with Windows

```bash
npm run startup
```

TextPro then launches in the tray each time you sign in. Turn it off with `npm run startup:off`.

### Option B — Installable / portable `.exe`

```bash
npm run dist
```

Find the installer and portable build under `apps/desktop/release/`. The NSIS installer can add Start Menu + Desktop shortcuts for you.

---

The app runs in the system tray. On first launch the Manage window opens with sample snippets.

### Daily usage

1. Press `Ctrl+Shift+Space` to open the palette
2. Type to search, Enter to run
3. Tray → **Manage Snippets** to create/edit actions
4. Shift+Tab from the palette also opens Manage

### Template syntax

| Placeholder | Meaning |
|---|---|
| `{{clipboard}}` | Current clipboard text (read before paste) |
| `{{date}}` / `{{time}}` / `{{datetime}}` | Current date/time |
| `{{prompt:Ticket}}` | Ask for a value before insert (one form for all prompts) |
| `{{var:Name}}` | User-defined variable from Manage → Variables |
| `{{key:enter}}` / `{{enter}}` | Press Enter after (or between) inserted text |
| `{{key:tab}}` / `{{tab}}` | Press Tab (useful for filling forms field-by-field) |
| `{{cursor}}` / `{{pointer}}` | After insert, move the caret to this spot |

### Local API

```bash
curl http://127.0.0.1:47821/health
curl http://127.0.0.1:47821/actions
curl -X POST http://127.0.0.1:47821/actions/<id>/run
```

## Architecture

```
apps/desktop/          Electron main + React UI (palette, manager, prompt)
packages/core/         Action model, template engine, registry, plugins (no Electron)
packages/platform-win/ Clipboard, insertion helpers, abbreviation watcher
```

**Stack:** Electron + TypeScript + React + Vite + sql.js (WASM SQLite) + koffi (Win32 key sampling)

Persistence lives under the Electron userData folder (`textpro.db`).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run desktop app with hot reload |
| `npm run build` | Build core, platform, and desktop |
| `npm run typecheck` | Typecheck all workspaces |

## Extending

1. Register a new `ActionHandler` on `ActionRegistry` for a new `kind`
2. Register a `VariableProvider` on `TemplateResolver` for new `{{placeholders}}`
3. Optionally wrap both in a `TextProPlugin` via `PluginHost`
