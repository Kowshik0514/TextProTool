import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  ipcMain,
  dialog,
  screen,
  shell,
} from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { Store } from './store'
import { ActionExecutorService } from './executor'
import { AbbreviationService } from './abbreviation'
import { startLocalApi } from './api'
import { focusWindow, getForegroundWindow, type WindowHandle } from './win32'
import { createExportBundle, parseExportBundle, rankActions } from '@textpro/core'
import type { AppSettings } from '@textpro/core'

let store: Store
let executor: ActionExecutorService
let abbrev: AbbreviationService
let tray: Tray | null = null
let paletteWin: BrowserWindow | null = null
let managerWin: BrowserWindow | null = null
let promptWin: BrowserWindow | null = null
let promptResolver: ((value: Record<string, string> | null) => void) | null = null
let isQuitting = false
let targetWindow: WindowHandle | null = null

const isDev = !app.isPackaged

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function rendererPage(name: 'palette' | 'manager' | 'prompt'): string {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/${name}.html`
  }
  return join(__dirname, `../renderer/${name}.html`)
}

function loadPage(win: BrowserWindow, name: 'palette' | 'manager' | 'prompt'): void {
  const url = rendererPage(name)
  if (url.startsWith('http')) win.loadURL(url)
  else win.loadFile(url)
}

function createPaletteWindow(): BrowserWindow {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: 640,
    height: 420,
    x: Math.round(width / 2 - 320),
    y: 120,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#1a1d23',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  loadPage(win, 'palette')

  win.on('blur', () => {
    if (win.isVisible()) hidePalette()
  })

  return win
}

function createManagerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: 'TextPro — Manage',
    backgroundColor: '#12141a',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  loadPage(win, 'manager')
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })
  return win
}

/**
 * Remember where the user actually was, so text lands there and not in one of
 * our own windows. Captured before the palette takes focus.
 */
function captureTargetWindow(): void {
  const foreground = getForegroundWindow()
  if (!foreground) return
  if (foreground.pid === process.pid) return
  targetWindow = foreground.handle
}

async function restoreTargetWindow(): Promise<boolean> {
  if (!targetWindow) return false
  const ok = focusWindow(targetWindow)
  if (ok) {
    // Give the target a moment to actually accept input focus.
    await delay(90)
  }
  return ok
}

function showPalette(): void {
  if (!paletteWin || paletteWin.isDestroyed()) {
    paletteWin = createPaletteWindow()
  }
  if (!paletteWin.isVisible()) {
    captureTargetWindow()
  }
  paletteWin.center()
  paletteWin.show()
  paletteWin.focus()
  paletteWin.webContents.send('palette:focus')
}

function hidePalette(): void {
  if (paletteWin && !paletteWin.isDestroyed()) {
    paletteWin.hide()
  }
}

function showManager(): void {
  if (!managerWin || managerWin.isDestroyed()) {
    managerWin = createManagerWindow()
  }
  managerWin.show()
  managerWin.focus()
}

async function collectPrompts(
  fields: Array<{ key: string; label: string }>,
): Promise<Record<string, string> | null> {
  captureTargetWindow()
  return new Promise((resolve) => {
    promptResolver = resolve

    if (promptWin && !promptWin.isDestroyed()) {
      promptWin.close()
    }

    promptWin = new BrowserWindow({
      width: 420,
      height: 120 + fields.length * 72,
      show: false,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      parent: undefined,
      backgroundColor: '#1a1d23',
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    loadPage(promptWin, 'prompt')

    promptWin.once('ready-to-show', () => {
      promptWin?.show()
      promptWin?.focus()
      promptWin?.webContents.send('prompt:fields', fields)
    })

    promptWin.on('closed', () => {
      if (promptResolver) {
        promptResolver(null)
        promptResolver = null
      }
      promptWin = null
    })
  })
}

function createTray(): void {
  // Simple 16x16 template icon (gray square) as PNG data URL → nativeImage
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4T2NkYGD4z0ABYBzVMKoBFPknGo0GDAAAG0UBAcVjQ7cAAAAASUVORK5CYII=',
  )
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('TextPro')
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Palette',
      accelerator: 'CommandOrControl+Shift+Space',
      click: () => showPalette(),
    },
    { label: 'Manage Snippets', click: () => showManager() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showPalette())
}

function registerHotkey(accelerator: string): void {
  globalShortcut.unregisterAll()
  const ok = globalShortcut.register(accelerator, () => {
    if (paletteWin?.isVisible()) hidePalette()
    else showPalette()
  })
  if (!ok) {
    console.warn(
      `Failed to register hotkey ${accelerator}. Another app (or another copy of TextPro) already owns it.`,
    )
    tray?.setToolTip(`TextPro — hotkey ${accelerator} unavailable`)
  }
}

function registerIpc(): void {
  ipcMain.handle('actions:search', (_e, query: string) => {
    const results = store.searchActions(query ?? '')
    return rankActions(results, query ?? '')
  })

  ipcMain.handle('actions:list', () => store.listActions())
  ipcMain.handle('actions:get', (_e, id: string) => store.getAction(id))

  ipcMain.handle('actions:create', (_e, input) => store.createAction(input))
  ipcMain.handle('actions:update', (_e, id: string, input) => store.updateAction(id, input))
  ipcMain.handle('actions:delete', (_e, id: string) => {
    store.deleteAction(id)
    return true
  })

  ipcMain.handle('actions:run', async (_e, id: string) => {
    hidePalette()
    await delay(60)
    return executor.runAction(id, { restoreFocus: true })
  })

  ipcMain.handle('actions:preview', async (_e, id: string, prompts: Record<string, string>) => {
    const action = store.getAction(id)
    if (!action) throw new Error('Not found')
    return executor.preview(action, prompts ?? {})
  })

  ipcMain.handle('categories:list', () => store.listCategories())
  ipcMain.handle('categories:create', (_e, name: string) => store.createCategory(name))
  ipcMain.handle('categories:update', (_e, id: string, input) => store.updateCategory(id, input))
  ipcMain.handle('categories:delete', (_e, id: string) => {
    store.deleteCategory(id)
    return true
  })

  ipcMain.handle('variables:list', () => store.listVariables())
  ipcMain.handle('variables:set', (_e, name: string, value: string) => store.setVariable(name, value))
  ipcMain.handle('variables:delete', (_e, name: string) => {
    store.deleteVariable(name)
    return true
  })

  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:update', (_e, partial: Partial<AppSettings>) => {
    const next = store.updateSettings(partial)
    if (partial.paletteHotkey) registerHotkey(next.paletteHotkey)
    if (partial.abbreviationEnabled !== undefined) abbrev.refreshFromSettings()
    return next
  })

  ipcMain.handle('prompt:submit', (_e, values: Record<string, string>) => {
    if (promptResolver) {
      promptResolver(values)
      promptResolver = null
    }
    if (promptWin && !promptWin.isDestroyed()) {
      promptWin.destroy()
    }
    return true
  })

  ipcMain.handle('prompt:cancel', () => {
    if (promptResolver) {
      promptResolver(null)
      promptResolver = null
    }
    if (promptWin && !promptWin.isDestroyed()) {
      promptWin.destroy()
    }
    return true
  })

  ipcMain.handle('palette:hide', () => {
    hidePalette()
    return true
  })

  ipcMain.handle('manager:show', () => {
    showManager()
    return true
  })

  ipcMain.handle('export:save', async () => {
    const bundle = createExportBundle({
      categories: store.listCategories(),
      actions: store.listActions(),
      variables: store.listVariables(),
      settings: store.getSettings(),
    })
    const result = await dialog.showSaveDialog({
      title: 'Export TextPro data',
      defaultPath: 'textpro-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false }
    writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf8')
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle('import:load', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import TextPro data',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false }
    const raw = JSON.parse(readFileSync(result.filePaths[0], 'utf8'))
    const bundle = parseExportBundle(raw)
    store.replaceFromExport(bundle)
    abbrev.refreshFromSettings()
    registerHotkey(store.getSettings().paletteHotkey)
    return { ok: true, count: bundle.actions.length }
  })

  ipcMain.handle('plugins:list', () =>
    executor.plugins.list().map((p) => ({ id: p.id, name: p.name, version: p.version })),
  )

  ipcMain.handle('history:list', () => store.listRecentRuns(30))

  ipcMain.handle('shell:openPath', async (_e, path: string) => shell.openPath(path))
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// A second copy cannot own the hotkey, the API port, or the database file,
// so it would come up silently broken. Hand off to the running instance instead.
const hasInstanceLock = app.requestSingleInstanceLock()

if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showPalette()
  })

  app.whenReady().then(async () => {
    store = await Store.create()
    executor = new ActionExecutorService({
      store,
      collectPrompts,
      restoreTargetWindow,
    })
    abbrev = new AbbreviationService(store, executor)

    registerIpc()
    createTray()
    paletteWin = createPaletteWindow()
    managerWin = createManagerWindow()

    const settings = store.getSettings()
    registerHotkey(settings.paletteHotkey)
    abbrev.start()
    startLocalApi({ store, executor })

    if (settings.showManagerOnStartup) {
      showManager()
    }
  })
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  abbrev?.stop()
  store?.close()
})

app.on('window-all-closed', () => {
  // Stay alive in the tray on Windows/Linux
})
