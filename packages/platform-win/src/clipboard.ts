import type { InsertionMode } from '@textpro/core'

export interface ClipboardService {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

export interface TextInsertionService {
  insert(text: string, mode: InsertionMode): Promise<void>
}

/**
 * Electron-backed clipboard using the main-process clipboard module.
 * Pass Electron's clipboard object from the main process.
 */
export function createElectronClipboard(clipboard: {
  readText: () => string
  writeText: (text: string) => void
}): ClipboardService {
  return {
    async readText() {
      return clipboard.readText()
    },
    async writeText(text: string) {
      clipboard.writeText(text)
    },
  }
}

export interface KeySender {
  /** Send Ctrl+V (or Cmd+V) paste shortcut */
  paste(): Promise<void>
  /** Type text character-by-character (or via OS text input) */
  typeText(text: string): Promise<void>
  /** Press a named key such as enter / tab */
  pressKey(name: string): Promise<void>
}

/**
 * Paste-first insertion: write clipboard, send paste, optionally restore.
 * Type mode uses the key sender directly.
 */
export function createTextInsertionService(
  clipboard: ClipboardService,
  keys: KeySender,
): TextInsertionService {
  return {
    async insert(text: string, mode: InsertionMode) {
      if (mode === 'type') {
        await keys.typeText(text)
        return
      }

      // Paste immediately. Restoring the previous clipboard is deferred so the
      // target app can read the snippet, without making the insert itself wait.
      const previous = await clipboard.readText()
      await clipboard.writeText(text)
      await keys.paste()
      setTimeout(() => {
        void clipboard.writeText(previous)
      }, 100)
    },
  }
}
