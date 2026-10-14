import { clipboard, shell } from 'electron'
import { spawn } from 'child_process'
import {
  ActionRegistry,
  TemplateResolver,
  createBuiltinProviders,
  extractPromptFields,
  type Action,
  type ActionResult,
  type AppLaunchPayload,
  type InsertionMode,
  type ResolvedTemplatePart,
  type TextInsertPayload,
  type UrlOpenPayload,
  type TextProPlugin,
  PluginHost,
} from '@textpro/core'
import {
  createElectronClipboard,
  createTextInsertionService,
} from '@textpro/platform-win'
import { createWindowsKeySender, deleteLastChars, moveCaretLeft } from './keys'
import type { Store } from './store'

export interface ExecutorDeps {
  store: Store
  /** Called when prompts are needed; returns prompt values or null if cancelled */
  collectPrompts: (fields: Array<{ key: string; label: string }>) => Promise<Record<string, string> | null>
  /** Puts the user's original window back in front before keys are injected */
  restoreTargetWindow: () => Promise<boolean>
}

export class ActionExecutorService {
  readonly registry = new ActionRegistry()
  readonly resolver = new TemplateResolver()
  readonly plugins = new PluginHost()
  private insertion
  private clipboardSvc
  private keys = createWindowsKeySender()

  constructor(private deps: ExecutorDeps) {
    this.clipboardSvc = createElectronClipboard(clipboard)
    this.insertion = createTextInsertionService(this.clipboardSvc, this.keys)

    for (const p of createBuiltinProviders()) {
      this.resolver.register(p)
    }

    this.registerBuiltinHandlers()
    this.registerBuiltinPlugins()
  }

  private registerBuiltinHandlers(): void {
    this.registry.register({
      kind: 'text.insert',
      execute: async (action, _payload, context) => {
        const parts = context.resolvedParts
        if (!parts || parts.length === 0) {
          // Fallback: plain resolved text with no keystrokes
          const text = context.resolvedText
          if (text === undefined) {
            return { ok: false, error: 'No resolved text for insertion' }
          }
          const payload = action.payload as TextInsertPayload
          const settings = this.deps.store.getSettings()
          const mode: InsertionMode = payload.insertionMode ?? settings.defaultInsertionMode
          await this.insertion.insert(text, mode === 'auto' ? 'paste' : mode)
          return { ok: true, message: 'Inserted text' }
        }

        const payload = action.payload as TextInsertPayload
        const settings = this.deps.store.getSettings()
        const mode: InsertionMode = payload.insertionMode ?? settings.defaultInsertionMode
        const insertMode = mode === 'auto' ? 'paste' : mode

        let buffer = ''
        let cursorSet = false
        let charsAfterCursor = 0

        const flushText = async () => {
          if (!buffer && !cursorSet) return
          if (buffer) {
            await this.insertion.insert(buffer, insertMode)
          }
          if (cursorSet && charsAfterCursor > 0) {
            await sleep(16)
            await moveCaretLeft(charsAfterCursor)
          }
          buffer = ''
          cursorSet = false
          charsAfterCursor = 0
        }

        for (const part of parts) {
          if (part.type === 'text') {
            buffer += part.text
            if (cursorSet) charsAfterCursor += part.text.length
          } else if (part.type === 'cursor') {
            if (!cursorSet) {
              cursorSet = true
              charsAfterCursor = 0
            }
          } else if (part.type === 'wait') {
            await flushText()
            await sleep(part.ms)
          } else {
            await flushText()
            await this.keys.pressKey(part.key)
            await sleep(10)
          }
        }
        await flushText()
        return { ok: true, message: 'Inserted text' }
      },
    })

    this.registry.register({
      kind: 'url.open',
      execute: async (_action, payload) => {
        const { url } = payload as UrlOpenPayload
        if (!url) return { ok: false, error: 'Missing URL' }
        await shell.openExternal(url)
        return { ok: true, message: `Opened ${url}` }
      },
    })

    this.registry.register({
      kind: 'app.launch',
      execute: async (_action, payload) => {
        const { path, args } = payload as AppLaunchPayload
        if (!path) return { ok: false, error: 'Missing application path' }
        await new Promise<void>((resolve, reject) => {
          const child = spawn(path, args ?? [], {
            detached: true,
            stdio: 'ignore',
            shell: true,
          })
          child.on('error', reject)
          child.unref()
          resolve()
        })
        return { ok: true, message: `Launched ${path}` }
      },
    })
  }

  private registerBuiltinPlugins(): void {
    const builtins: TextProPlugin = {
      id: 'textpro.builtins',
      name: 'Built-in Actions',
      version: '0.1.0',
      handlers: [],
    }
    this.plugins.register(builtins)
  }

  async runAction(
    actionId: string,
    options?: { eraseChars?: number; restoreFocus?: boolean },
  ): Promise<ActionResult> {
    const action = this.deps.store.getAction(actionId)
    if (!action) return { ok: false, error: 'Action not found' }
    if (!action.enabled) return { ok: false, error: 'Action is disabled' }
    if (action.categoryId) {
      const cat = this.deps.store.listCategories().find((c) => c.id === action.categoryId)
      if (cat && !cat.enabled) return { ok: false, error: `Group “${cat.name}” is disabled` }
    }

    try {
      if (action.kind === 'text.insert') {
        const result = await this.runTextInsert(action, options)
        this.deps.store.touchActionUsed(action.id)
        this.deps.store.recordRun(action.id, result.ok, result.ok ? result.message : result.error)
        return result
      }

      const result = await this.registry.execute(action, {})
      this.deps.store.touchActionUsed(action.id)
      this.deps.store.recordRun(action.id, result.ok, result.ok ? result.message : result.error)
      return result
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.deps.store.recordRun(action.id, false, error)
      return { ok: false, error }
    }
  }

  private async runTextInsert(
    action: Action,
    options?: { eraseChars?: number; restoreFocus?: boolean },
  ): Promise<ActionResult> {
    const payload = action.payload as TextInsertPayload
    const body = payload.body ?? ''

    // Read clipboard BEFORE any mutation (paste mode / erase)
    const clipboardText = await this.clipboardSvc.readText()
    const variables = this.deps.store.getVariablesMap()

    const fields = extractPromptFields(body)
    let prompts: Record<string, string> = {}
    if (fields.length > 0) {
      const collected = await this.deps.collectPrompts(fields)
      if (!collected) {
        await this.deps.restoreTargetWindow()
        return { ok: false, error: 'Cancelled' }
      }
      prompts = collected
      await this.deps.restoreTargetWindow()
    }

    const resolvedParts = await this.resolver.resolveParts(body, {
      clipboard: clipboardText,
      prompts,
      variables,
      now: new Date(),
    })
    const resolvedText = resolvedParts
      .map((p: ResolvedTemplatePart) => {
        if (p.type === 'text') return p.text
        if (p.type === 'cursor') return '|'
        if (p.type === 'wait') return `[${p.ms}ms]`
        return `[${p.key}]`
      })
      .join('')

    // Must happen after any prompt window closes, otherwise focus is stolen again.
    if (options?.restoreFocus) {
      const restored = await this.deps.restoreTargetWindow()
      if (!restored) {
        return { ok: false, error: 'Could not focus the target window' }
      }
    }

    const eraseChars = options?.eraseChars
    if (eraseChars && eraseChars > 0) {
      // +1 for the delimiter that triggered the abbreviation
      await deleteLastChars(eraseChars + 1)
    }

    return this.registry.execute(action, {
      resolvedText,
      resolvedParts,
      prompts,
      clipboard: clipboardText,
      variables,
    })
  }

  /** Preview resolved text without inserting (prompts must be provided). */
  async preview(action: Action, prompts: Record<string, string> = {}): Promise<string> {
    if (action.kind !== 'text.insert') {
      return `[${action.kind}] ${JSON.stringify(action.payload)}`
    }
    const payload = action.payload as TextInsertPayload
    const clipboardText = await this.clipboardSvc.readText()
    const variables = this.deps.store.getVariablesMap()
    return this.resolver.resolve(payload.body ?? '', {
      clipboard: clipboardText,
      prompts,
      variables,
      now: new Date(),
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
