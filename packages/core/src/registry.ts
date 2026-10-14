import type { Action, ActionKind } from './types.js'
import type { ResolvedTemplatePart } from './template.js'

/**
 * Handler that executes a specific action kind.
 * Plugins register new handlers for new kinds.
 */
export interface ActionHandler<TPayload = unknown> {
  kind: ActionKind
  execute(action: Action, payload: TPayload, context: ActionExecutionContext): Promise<ActionResult>
}

export interface ActionExecutionContext {
  /** Pre-resolved text for text.insert (after template resolution) — preview / legacy */
  resolvedText?: string
  /** Ordered text + keystroke parts for execution */
  resolvedParts?: ResolvedTemplatePart[]
  /** Prompt answers collected from the UI */
  prompts?: Record<string, string>
  clipboard?: string
  variables?: Record<string, string>
}

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string }

export class ActionRegistry {
  private handlers = new Map<string, ActionHandler>()

  register(handler: ActionHandler): void {
    this.handlers.set(handler.kind, handler)
  }

  unregister(kind: string): void {
    this.handlers.delete(kind)
  }

  has(kind: string): boolean {
    return this.handlers.has(kind)
  }

  get(kind: string): ActionHandler | undefined {
    return this.handlers.get(kind)
  }

  listKinds(): string[] {
    return [...this.handlers.keys()]
  }

  async execute(action: Action, context: ActionExecutionContext = {}): Promise<ActionResult> {
    const handler = this.handlers.get(action.kind)
    if (!handler) {
      return { ok: false, error: `No handler registered for action kind: ${action.kind}` }
    }
    try {
      return await handler.execute(action, action.payload, context)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  }
}
