/**
 * Variable providers supply values for {{placeholders}} in templates.
 * New providers can be registered without changing the resolver.
 */
export interface VariableContext {
  clipboard?: string
  prompts?: Record<string, string>
  variables?: Record<string, string>
  now?: Date
}

export interface VariableProvider {
  /** Unique id, e.g. "clipboard", "date", "prompt", "var" */
  id: string
  /**
   * Resolve a placeholder.
   * @param key Full token inside {{ }}, e.g. "clipboard", "prompt:Ticket", "var:Email"
   * @param ctx Shared execution context
   */
  resolve(key: string, ctx: VariableContext): string | undefined | Promise<string | undefined>
}

export interface PromptField {
  /** Label shown to the user (from prompt:Label) */
  label: string
  /** Full key used in template, e.g. prompt:Ticket */
  key: string
}

/** A keystroke to inject after / between text segments. */
export type TemplateKeyName =
  | 'enter'
  | 'tab'
  | 'escape'
  | 'backspace'
  | 'space'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'delete'

export type ResolvedTemplatePart =
  | { type: 'text'; text: string }
  | { type: 'key'; key: TemplateKeyName }
  | { type: 'wait'; ms: number }
  | { type: 'cursor' }

const PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g

const KEY_ALIASES: Record<string, TemplateKeyName> = {
  enter: 'enter',
  return: 'enter',
  tab: 'tab',
  escape: 'escape',
  esc: 'escape',
  backspace: 'backspace',
  space: 'space',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  delete: 'delete',
  del: 'delete',
}

const CURSOR_TOKENS = new Set(['cursor', 'pointer', 'caret'])

export function parseKeyPlaceholder(token: string): TemplateKeyName | null {
  const raw = token.trim().toLowerCase()
  if (CURSOR_TOKENS.has(raw)) return null
  if (raw.startsWith('key:')) {
    const name = raw.slice(4).trim()
    return KEY_ALIASES[name] ?? null
  }
  return KEY_ALIASES[raw] ?? null
}

export function isKeyPlaceholder(token: string): boolean {
  return parseKeyPlaceholder(token) !== null
}

export function isCursorPlaceholder(token: string): boolean {
  return CURSOR_TOKENS.has(token.trim().toLowerCase())
}

const MAX_WAIT_MS = 15_000

/** `{{wait:2s}}` or `{{wait:2000}}` (milliseconds when no unit is given). */
export function parseWaitPlaceholder(token: string): number | null {
  const match = /^(?:wait|delay)\s*:\s*(\d+(?:\.\d+)?)\s*(ms|s)?$/.exec(token.trim().toLowerCase())
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount < 0) return null
  const ms = match[2] === 's' ? amount * 1000 : amount
  return Math.min(MAX_WAIT_MS, Math.round(ms))
}

export function extractPlaceholders(template: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const key = match[1].trim()
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

export function extractPromptFields(template: string): PromptField[] {
  return extractPlaceholders(template)
    .filter((k) => k.startsWith('prompt:'))
    .map((key) => ({
      key,
      label: key.slice('prompt:'.length).trim() || 'Value',
    }))
}

type RawTemplatePart =
  | { kind: 'text'; value: string }
  | { kind: 'key'; key: TemplateKeyName }
  | { kind: 'wait'; ms: number }
  | { kind: 'cursor' }

/**
 * Split a template into ordered text / keystroke / cursor parts.
 * Example: `Hi {{cursor}},\n{{clipboard}}` → text + cursor + text
 */
export function splitTemplateParts(template: string): RawTemplatePart[] {
  const parts: RawTemplatePart[] = []
  let last = 0
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const index = match.index ?? 0
    if (index > last) {
      parts.push({ kind: 'text', value: template.slice(last, index) })
    }
    const token = match[1].trim()
    if (isCursorPlaceholder(token)) {
      parts.push({ kind: 'cursor' })
    } else {
      const waitMs = parseWaitPlaceholder(token)
      const key = waitMs === null ? parseKeyPlaceholder(token) : null
      if (waitMs !== null) {
        parts.push({ kind: 'wait', ms: waitMs })
      } else if (key) {
        parts.push({ kind: 'key', key })
      } else {
        parts.push({ kind: 'text', value: match[0] })
      }
    }
    last = index + match[0].length
  }
  if (last < template.length) {
    parts.push({ kind: 'text', value: template.slice(last) })
  }

  const merged: RawTemplatePart[] = []
  for (const part of parts) {
    const prev = merged[merged.length - 1]
    if (part.kind === 'text' && prev?.kind === 'text') {
      prev.value += part.value
    } else {
      merged.push(part)
    }
  }
  return merged.filter((p) => p.kind !== 'text' || p.value.length > 0)
}

export class TemplateResolver {
  private providers = new Map<string, VariableProvider>()

  register(provider: VariableProvider): void {
    this.providers.set(provider.id, provider)
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  listProviders(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Resolve all placeholders into a single string.
   * Keystroke placeholders become [Enter]-style markers; cursor becomes |.
   */
  async resolve(template: string, ctx: VariableContext = {}): Promise<string> {
    const parts = await this.resolveParts(template, ctx)
    return parts
      .map((p) => {
        if (p.type === 'text') return p.text
        if (p.type === 'cursor') return '|'
        if (p.type === 'wait') return `[${p.ms}ms]`
        return `[${capitalize(p.key)}]`
      })
      .join('')
  }

  /**
   * Resolve into an executable sequence of text inserts, keystrokes, and cursor marks.
   */
  async resolveParts(template: string, ctx: VariableContext = {}): Promise<ResolvedTemplatePart[]> {
    const rawParts = splitTemplateParts(template)
    const out: ResolvedTemplatePart[] = []
    let sawCursor = false

    for (const part of rawParts) {
      if (part.kind === 'cursor') {
        if (!sawCursor) {
          out.push({ type: 'cursor' })
          sawCursor = true
        }
        continue
      }
      if (part.kind === 'key') {
        out.push({ type: 'key', key: part.key })
        continue
      }
      if (part.kind === 'wait') {
        out.push({ type: 'wait', ms: part.ms })
        continue
      }
      const text = await this.resolveTextSegment(part.value, ctx)
      if (text.length > 0) out.push({ type: 'text', text })
    }
    return out
  }

  private async resolveTextSegment(template: string, ctx: VariableContext): Promise<string> {
    const keys = extractPlaceholders(template).filter(
      (k) => !isKeyPlaceholder(k) && !isCursorPlaceholder(k),
    )
    const resolved = new Map<string, string>()

    for (const key of keys) {
      const value = await this.resolveKey(key, ctx)
      if (value === undefined) {
        throw new Error(`Unknown or unresolved template variable: {{${key}}}`)
      }
      resolved.set(key, value)
    }

    return template.replace(PLACEHOLDER_RE, (match, raw: string) => {
      const key = raw.trim()
      if (isKeyPlaceholder(key) || isCursorPlaceholder(key)) return match
      return resolved.get(key) ?? ''
    })
  }

  private async resolveKey(key: string, ctx: VariableContext): Promise<string | undefined> {
    const exact = this.providers.get(key)
    if (exact) {
      return exact.resolve(key, ctx)
    }

    const colon = key.indexOf(':')
    if (colon > 0) {
      const prefix = key.slice(0, colon)
      const prefixed = this.providers.get(prefix)
      if (prefixed) {
        return prefixed.resolve(key, ctx)
      }
    }

    return undefined
  }
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

export function createBuiltinProviders(): VariableProvider[] {
  return [
    {
      id: 'clipboard',
      resolve(_key, ctx) {
        return ctx.clipboard ?? ''
      },
    },
    {
      id: 'date',
      resolve(_key, ctx) {
        const d = ctx.now ?? new Date()
        return d.toLocaleDateString()
      },
    },
    {
      id: 'time',
      resolve(_key, ctx) {
        const d = ctx.now ?? new Date()
        return d.toLocaleTimeString()
      },
    },
    {
      id: 'datetime',
      resolve(_key, ctx) {
        const d = ctx.now ?? new Date()
        return d.toLocaleString()
      },
    },
    {
      id: 'prompt',
      resolve(key, ctx) {
        return ctx.prompts?.[key]
      },
    },
    {
      id: 'var',
      resolve(key, ctx) {
        const name = key.slice('var:'.length).trim()
        return ctx.variables?.[name] ?? ctx.variables?.[key]
      },
    },
  ]
}
