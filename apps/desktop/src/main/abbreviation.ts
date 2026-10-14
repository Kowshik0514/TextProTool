import { app, BrowserWindow } from 'electron'
import { AbbreviationWatcher } from '@textpro/platform-win'
import {
  installKeyboardHook,
  sendBackspaces,
  sendNamedKey,
  sendUnicodeText,
  type KeyboardHookEvent,
} from './win32'
import type { Store } from './store'
import type { ActionExecutorService } from './executor'

/**
 * Keys arrive in press order. The trigger is deleted inside the key event, before
 * the snippet is pasted, so fast typing does not land ahead of the expansion.
 */
export class AbbreviationService {
  private watcher: AbbreviationWatcher
  private uninstallHook: (() => void) | null = null
  private enabled = false
  private busy = false
  private swallowDelimiter = false
  private pending: string[] = []
  private textProFocused = false

  constructor(
    private store: Store,
    private executor: ActionExecutorService,
  ) {
    this.watcher = new AbbreviationWatcher({
      delimiters: [' ', 'Enter', 'Tab'],
      hasAbbreviation: (abbrev) => !!this.store.getActionByAbbreviation(abbrev),
      onMatch: (abbrev) => this.expandMatched(abbrev, true),
    })

    const refresh = () => {
      this.textProFocused = BrowserWindow.getAllWindows().some(
        (win) => !win.isDestroyed() && win.isVisible() && win.isFocused(),
      )
    }
    app.on('browser-window-created', (_event, win) => {
      win.on('focus', refresh)
      win.on('blur', () => {
        this.textProFocused = false
      })
      win.on('hide', () => {
        this.textProFocused = false
      })
      win.on('show', refresh)
    })
    refresh()
  }

  start(): void {
    this.refreshFromSettings()
  }

  stop(): void {
    this.enabled = false
    this.watcher.setEnabled(false)
    this.releaseHook()
    this.busy = false
  }

  refreshFromSettings(): void {
    const settings = this.store.getSettings()
    this.enabled = settings.abbreviationEnabled
    this.watcher.setEnabled(this.enabled)
    if (this.enabled) this.ensureHook()
    else this.releaseHook()
  }

  async feedKey(key: string): Promise<void> {
    await this.watcher.handleKey(key)
  }

  private ensureHook(): void {
    if (this.uninstallHook) return
    try {
      this.uninstallHook = installKeyboardHook((event) => this.onKey(event))
      console.log('TextPro abbreviation hook installed')
    } catch (err) {
      console.error('TextPro abbreviation hook failed:', err)
    }
  }

  private releaseHook(): void {
    this.uninstallHook?.()
    this.uninstallHook = null
  }

  private onKey(event: KeyboardHookEvent): boolean {
    if (!this.enabled || event.kind === 'ignore') return false

    if (this.textProFocused) {
      if (!this.busy) this.watcher.reset()
      return false
    }

    if (this.busy) {
      if (event.kind === 'char') {
        this.pending.push(event.text)
        return true
      }
      return false
    }

    if (event.kind === 'shortcut' || event.kind === 'nav') {
      this.watcher.reset()
      return false
    }

    this.swallowDelimiter = false
    void this.watcher.handleKey(event.text).catch((err) => {
      console.error('TextPro abbreviation failed:', err)
    })
    return this.swallowDelimiter
  }

  private async expandMatched(abbrev: string, erase: boolean): Promise<void> {
    if (this.busy) return
    const action = this.store.getActionByAbbreviation(abbrev)
    if (!action) return

    // The delimiter has not reached the target yet. Swallow it and delete the
    // abbreviation that is already on screen, before any await can let more
    // keystrokes through.
    this.busy = true
    this.pending = []
    this.swallowDelimiter = true
    this.watcher.reset()
    if (erase && abbrev.length > 0) sendBackspaces(abbrev.length)

    let inserted = false
    try {
      const result = await this.executor.runAction(action.id)
      inserted = result.ok
    } catch (err) {
      console.error('TextPro abbreviation failed:', err)
    } finally {
      const extra = this.pending
      this.pending = []
      this.busy = false
      this.swallowDelimiter = false
      if (!inserted) {
        this.replay([...abbrev, ...extra])
      } else if (extra.length > 0) {
        this.replay(extra)
      }
    }
  }

  /** Type keys that arrived while the snippet was being inserted. */
  private replay(keys: string[]): void {
    let chunk = ''
    let buffer = ''
    const flush = () => {
      if (!chunk) return
      sendUnicodeText(chunk)
      buffer += chunk
      chunk = ''
    }

    for (const key of keys) {
      if (key === 'Backspace') {
        flush()
        if (buffer.length > 0) buffer = buffer.slice(0, -1)
        sendBackspaces(1)
        continue
      }
      if (key === ' ' || key === 'Enter' || key === 'Tab') {
        flush()
        if (key === 'Enter') sendNamedKey('enter')
        else if (key === 'Tab') sendNamedKey('tab')
        else sendUnicodeText(' ')
        buffer = ''
        continue
      }
      if (key.length === 1) chunk += key
    }
    flush()
    this.watcher.setBuffer(buffer)
  }
}
