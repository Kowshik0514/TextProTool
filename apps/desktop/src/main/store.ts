import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type {
  Action,
  AppSettings,
  Category,
  TextInsertPayload,
  UrlOpenPayload,
  AppLaunchPayload,
  UserVariable,
} from '@textpro/core'
import { DEFAULT_SETTINGS as defaults } from '@textpro/core'

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,
  abbreviation TEXT,
  hotkey TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  category_id TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  search_blob TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_actions_kind ON actions(kind);
CREATE INDEX IF NOT EXISTS idx_actions_favorite ON actions(favorite);
CREATE INDEX IF NOT EXISTS idx_actions_abbrev ON actions(abbreviation);
CREATE INDEX IF NOT EXISTS idx_actions_last_used ON actions(last_used_at);
CREATE INDEX IF NOT EXISTS idx_actions_search ON actions(search_blob);

CREATE TABLE IF NOT EXISTS variables (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_history (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  ran_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_history_ran_at ON run_history(ran_at);
`

type ActionRow = {
  id: string
  name: string
  description: string | null
  kind: string
  abbreviation: string | null
  hotkey: string | null
  tags: string
  category_id: string | null
  favorite: number
  enabled?: number
  payload: string
  created_at: string
  updated_at: string
  last_used_at: string | null
  search_blob?: string
}

type CategoryRow = {
  id: string
  name: string
  sort_order: number
  enabled?: number
}

function rowToAction(row: ActionRow): Action {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    kind: row.kind,
    trigger: {
      abbreviation: row.abbreviation ?? undefined,
      hotkey: row.hotkey ?? undefined,
    },
    tags: JSON.parse(row.tags || '[]') as string[],
    categoryId: row.category_id,
    favorite: !!row.favorite,
    enabled: row.enabled === undefined ? true : !!row.enabled,
    payload: JSON.parse(row.payload) as TextInsertPayload | UrlOpenPayload | AppLaunchPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  }
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    enabled: row.enabled === undefined ? true : !!row.enabled,
  }
}

function payloadSearchText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>
  return String(p.body ?? p.url ?? p.path ?? '')
}

function buildSearchBlob(input: {
  name: string
  description?: string | null
  tags: string[]
  abbreviation?: string | null
  payload: unknown
}): string {
  return [
    input.name,
    input.description ?? '',
    input.tags.join(' '),
    input.abbreviation ?? '',
    payloadSearchText(input.payload),
  ]
    .join(' ')
    .toLowerCase()
}

export class Store {
  private db!: SqlJsDatabase
  private dbPath: string
  private persistTimer: NodeJS.Timeout | null = null

  private constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  static async create(dbPath?: string): Promise<Store> {
    const path = dbPath ?? join(app.getPath('userData'), 'textpro.db')
    const dir = join(path, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const SQL = await initSqlJs({
      locateFile: (file) => {
        const candidates = [
          // Packaged app resources
          join(process.resourcesPath ?? '', 'sqljs', file),
          join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', file),
          // Dev / monorepo
          join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
          join(process.cwd(), 'apps', 'desktop', 'node_modules', 'sql.js', 'dist', file),
          join(__dirname, '..', '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
          join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
        ]
        for (const candidate of candidates) {
          if (candidate && existsSync(candidate)) return candidate
        }
        return candidates.find(Boolean) ?? file
      },
    })

    const store = new Store(path)
    if (existsSync(path)) {
      store.db = new SQL.Database(readFileSync(path))
    } else {
      store.db = new SQL.Database()
    }

    store.db.run(MIGRATIONS)
    store.ensureLegacyColumns()
    store.seedIfEmpty()
    store.persist()
    return store
  }

  /** Upgrade DBs created before enabled columns existed. */
  private ensureLegacyColumns(): void {
    // Prefer try/ALTER over PRAGMA — sql.js can be awkward with table_info binding.
    try {
      this.db.run('ALTER TABLE actions ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
    } catch {
      // column already present
    }
    try {
      this.db.run('ALTER TABLE categories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
    } catch {
      // column already present
    }
    try {
      this.db.run('CREATE INDEX IF NOT EXISTS idx_actions_enabled ON actions(enabled)')
    } catch {
      // ignore
    }
  }

  private persist(): void {
    const data = this.db.export()
    writeFileSync(this.dbPath, Buffer.from(data))
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.persist(), 200)
  }

  private exec(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as never[])
    this.schedulePersist()
  }

  private all<T extends object>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql)
    stmt.bind(params as never[])
    const rows: T[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T)
    }
    stmt.free()
    return rows
  }

  private get<T extends object>(sql: string, params: unknown[] = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  private seedIfEmpty(): void {
    const count = this.get<{ c: number }>('SELECT COUNT(*) AS c FROM actions')
    if ((count?.c ?? 0) > 0) return

    const now = new Date().toISOString()
    const catId = randomUUID()
    this.exec('INSERT INTO categories (id, name, sort_order, enabled) VALUES (?, ?, ?, 1)', [
      catId,
      'General',
      0,
    ])

    const seeds: Array<{
      name: string
      description?: string
      kind: string
      tags: string[]
      categoryId: string
      favorite: boolean
      abbreviation?: string
      payload: Record<string, unknown>
    }> = [
      {
        name: 'Email address',
        description: 'Your email',
        kind: 'text.insert',
        tags: ['contact'],
        categoryId: catId,
        favorite: true,
        abbreviation: ';email',
        payload: { body: 'you@example.com', insertionMode: 'paste' },
      },
      {
        name: 'Approval request',
        description: 'Clipboard-aware approval message',
        kind: 'text.insert',
        tags: ['work', 'template'],
        categoryId: catId,
        favorite: true,
        abbreviation: ';approve',
        payload: {
          body: 'Hi Team,\n\n{{clipboard}}\n\nPlease approve this.\n\nThanks',
          insertionMode: 'paste',
        },
      },
      {
        name: 'Ticket update',
        description: 'Parameterized ticket note',
        kind: 'text.insert',
        tags: ['jira', 'template'],
        categoryId: catId,
        favorite: false,
        abbreviation: ';ticket',
        payload: {
          body: 'Ticket {{prompt:Ticket}} on {{prompt:Environment}} — {{prompt:Summary}}\nUpdated: {{datetime}}',
          insertionMode: 'paste',
        },
      },
      {
        name: 'Open Google',
        description: 'Example URL action',
        kind: 'url.open',
        tags: ['demo'],
        categoryId: catId,
        favorite: false,
        payload: { url: 'https://www.google.com' },
      },
    ]

    for (const seed of seeds) {
      const id = randomUUID()
      const searchBlob = buildSearchBlob({
        name: seed.name,
        description: seed.description,
        tags: seed.tags,
        abbreviation: seed.abbreviation,
        payload: seed.payload,
      })
      this.exec(
        `INSERT INTO actions (
          id, name, description, kind, abbreviation, hotkey, tags, category_id,
          favorite, enabled, payload, created_at, updated_at, last_used_at, search_blob
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?, ?, NULL, ?)`,
        [
          id,
          seed.name,
          seed.description ?? null,
          seed.kind,
          seed.abbreviation ?? null,
          JSON.stringify(seed.tags),
          seed.categoryId,
          seed.favorite ? 1 : 0,
          JSON.stringify(seed.payload),
          now,
          now,
          searchBlob,
        ],
      )
    }

    for (const [key, value] of Object.entries(defaults)) {
      this.exec('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [
        key,
        JSON.stringify(value),
      ])
    }
  }

  close(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persist()
    this.db.close()
  }

  getSettings(): AppSettings {
    const rows = this.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const settings: AppSettings = {
      ...defaults,
      templateSuggestions: {
        enabled: defaults.templateSuggestions.enabled,
        groups: { ...defaults.templateSuggestions.groups },
      },
    }
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value)
        if (row.key === 'templateSuggestions' && parsed && typeof parsed === 'object') {
          settings.templateSuggestions = {
            enabled:
              typeof parsed.enabled === 'boolean'
                ? parsed.enabled
                : defaults.templateSuggestions.enabled,
            groups: {
              ...defaults.templateSuggestions.groups,
              ...(parsed.groups && typeof parsed.groups === 'object' ? parsed.groups : {}),
            },
          }
        } else {
          ;(settings as unknown as Record<string, unknown>)[row.key] = parsed
        }
      } catch {
        // ignore
      }
    }
    return settings
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const current = this.getSettings()
    const next: AppSettings = {
      ...current,
      ...partial,
      templateSuggestions: partial.templateSuggestions
        ? {
            enabled:
              partial.templateSuggestions.enabled ?? current.templateSuggestions.enabled,
            groups: {
              ...current.templateSuggestions.groups,
              ...(partial.templateSuggestions.groups ?? {}),
            },
          }
        : current.templateSuggestions,
    }
    for (const [key, value] of Object.entries(next)) {
      this.exec(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, JSON.stringify(value)],
      )
    }
    return next
  }

  listCategories(): Category[] {
    return this.all<CategoryRow>(
      'SELECT id, name, sort_order, enabled FROM categories ORDER BY sort_order, name',
    ).map(rowToCategory)
  }

  createCategory(name: string): Category {
    const id = randomUUID()
    const max = this.get<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories')
    const sortOrder = (max?.m ?? -1) + 1
    this.exec('INSERT INTO categories (id, name, sort_order, enabled) VALUES (?, ?, ?, 1)', [
      id,
      name,
      sortOrder,
    ])
    return { id, name, sortOrder, enabled: true }
  }

  updateCategory(
    id: string,
    input: Partial<{ name: string; enabled: boolean; sortOrder: number }>,
  ): Category {
    const existing = this.listCategories().find((c) => c.id === id)
    if (!existing) throw new Error(`Category not found: ${id}`)
    const next = {
      name: input.name ?? existing.name,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      sortOrder: input.sortOrder ?? existing.sortOrder,
    }
    this.exec('UPDATE categories SET name = ?, enabled = ?, sort_order = ? WHERE id = ?', [
      next.name,
      next.enabled ? 1 : 0,
      next.sortOrder,
      id,
    ])
    return { id, ...next }
  }

  deleteCategory(id: string): void {
    this.exec('UPDATE actions SET category_id = NULL WHERE category_id = ?', [id])
    this.exec('DELETE FROM categories WHERE id = ?', [id])
  }

  private isActionRunnable(
    action: Action,
    disabledCategoryIds?: Set<string>,
  ): boolean {
    if (!action.enabled) return false
    if (!action.categoryId) return true
    if (disabledCategoryIds) return !disabledCategoryIds.has(action.categoryId)
    const cat = this.listCategories().find((c) => c.id === action.categoryId)
    return !cat || cat.enabled
  }

  private disabledCategoryIdSet(): Set<string> {
    return new Set(this.listCategories().filter((c) => !c.enabled).map((c) => c.id))
  }

  listActions(): Action[] {
    return this.all<ActionRow>(
      'SELECT * FROM actions ORDER BY favorite DESC, name COLLATE NOCASE',
    ).map(rowToAction)
  }

  getAction(id: string): Action | null {
    const row = this.get<ActionRow>('SELECT * FROM actions WHERE id = ?', [id])
    return row ? rowToAction(row) : null
  }

  getActionByAbbreviation(abbreviation: string): Action | null {
    const row = this.get<ActionRow>(
      'SELECT * FROM actions WHERE abbreviation = ? COLLATE NOCASE',
      [abbreviation],
    )
    if (!row) return null
    const action = rowToAction(row)
    return this.isActionRunnable(action) ? action : null
  }

  listAbbreviations(): string[] {
    return this.listActions()
      .filter((a) => this.isActionRunnable(a) && a.trigger?.abbreviation)
      .map((a) => a.trigger!.abbreviation!)
  }

  searchActions(query: string): Action[] {
    const q = query.trim()
    const disabledCats = this.disabledCategoryIdSet()
    let actions: Action[]
    if (!q) {
      actions = this.all<ActionRow>(
        `SELECT * FROM actions
         ORDER BY favorite DESC,
                  CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END,
                  last_used_at DESC,
                  name COLLATE NOCASE`,
      ).map(rowToAction)
    } else {
      const tokens = q
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)

      let rows = this.all<ActionRow>('SELECT * FROM actions')
      rows = rows.filter((row) =>
        tokens.every(
          (t) =>
            row.search_blob?.includes(t) ||
            `${row.name} ${row.description ?? ''} ${row.tags} ${row.abbreviation ?? ''} ${row.payload}`
              .toLowerCase()
              .includes(t),
        ),
      )

      rows.sort((a, b) => {
        if (a.favorite !== b.favorite) return b.favorite - a.favorite
        const aName = a.name.toLowerCase()
        const bName = b.name.toLowerCase()
        const aStarts = tokens.some((t) => aName.startsWith(t)) ? 1 : 0
        const bStarts = tokens.some((t) => bName.startsWith(t)) ? 1 : 0
        if (aStarts !== bStarts) return bStarts - aStarts
        return aName.localeCompare(bName)
      })

      actions = rows.slice(0, 50).map(rowToAction)
    }

    return actions.filter((a) => this.isActionRunnable(a, disabledCats))
  }

  createAction(input: {
    name: string
    description?: string
    kind: string
    tags?: string[]
    categoryId?: string | null
    favorite?: boolean
    enabled?: boolean
    trigger?: { abbreviation?: string; hotkey?: string }
    payload: Record<string, unknown>
  }): Action {
    this.assertAbbreviationUnique(input.trigger?.abbreviation)
    const now = new Date().toISOString()
    const id = randomUUID()
    const tags = input.tags ?? []
    const enabled = input.enabled !== false
    const searchBlob = buildSearchBlob({
      name: input.name,
      description: input.description,
      tags,
      abbreviation: input.trigger?.abbreviation,
      payload: input.payload,
    })
    this.exec(
      `INSERT INTO actions (
        id, name, description, kind, abbreviation, hotkey, tags, category_id,
        favorite, enabled, payload, created_at, updated_at, last_used_at, search_blob
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        id,
        input.name,
        input.description ?? null,
        input.kind,
        input.trigger?.abbreviation ?? null,
        input.trigger?.hotkey ?? null,
        JSON.stringify(tags),
        input.categoryId ?? null,
        input.favorite ? 1 : 0,
        enabled ? 1 : 0,
        JSON.stringify(input.payload),
        now,
        now,
        searchBlob,
      ],
    )
    return this.getAction(id)!
  }

  updateAction(
    id: string,
    input: Partial<{
      name: string
      description: string
      kind: string
      tags: string[]
      categoryId: string | null
      favorite: boolean
      enabled: boolean
      trigger: { abbreviation?: string; hotkey?: string }
      payload: Record<string, unknown>
    }>,
  ): Action {
    const existing = this.getAction(id)
    if (!existing) throw new Error(`Action not found: ${id}`)

    const abbreviation =
      input.trigger !== undefined ? input.trigger.abbreviation ?? null : existing.trigger?.abbreviation
    this.assertAbbreviationUnique(abbreviation ?? undefined, id)

    const next = {
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      kind: input.kind ?? existing.kind,
      abbreviation,
      hotkey: input.trigger !== undefined ? input.trigger.hotkey ?? null : existing.trigger?.hotkey ?? null,
      tags: input.tags ?? existing.tags,
      categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
      favorite: input.favorite !== undefined ? input.favorite : existing.favorite,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      payload: input.payload ?? existing.payload,
    }

    const searchBlob = buildSearchBlob({
      name: next.name,
      description: next.description,
      tags: next.tags,
      abbreviation: next.abbreviation,
      payload: next.payload,
    })

    this.exec(
      `UPDATE actions SET
        name = ?, description = ?, kind = ?, abbreviation = ?, hotkey = ?,
        tags = ?, category_id = ?, favorite = ?, enabled = ?, payload = ?, updated_at = ?, search_blob = ?
       WHERE id = ?`,
      [
        next.name,
        next.description ?? null,
        next.kind,
        next.abbreviation,
        next.hotkey,
        JSON.stringify(next.tags),
        next.categoryId ?? null,
        next.favorite ? 1 : 0,
        next.enabled ? 1 : 0,
        JSON.stringify(next.payload),
        new Date().toISOString(),
        searchBlob,
        id,
      ],
    )
    return this.getAction(id)!
  }

  deleteAction(id: string): void {
    this.exec('DELETE FROM actions WHERE id = ?', [id])
  }

  touchActionUsed(id: string): void {
    this.exec('UPDATE actions SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), id])
  }

  private assertAbbreviationUnique(abbreviation?: string | null, excludeId?: string): void {
    if (!abbreviation) return
    const row = excludeId
      ? this.get<{ id: string }>(
          'SELECT id FROM actions WHERE abbreviation = ? COLLATE NOCASE AND id != ?',
          [abbreviation, excludeId],
        )
      : this.get<{ id: string }>('SELECT id FROM actions WHERE abbreviation = ? COLLATE NOCASE', [
          abbreviation,
        ])
    if (row) throw new Error(`Abbreviation already in use: ${abbreviation}`)
  }

  listVariables(): UserVariable[] {
    return this.all<{ name: string; value: string; updated_at: string }>(
      'SELECT name, value, updated_at FROM variables ORDER BY name',
    ).map((r) => ({ name: r.name, value: r.value, updatedAt: r.updated_at }))
  }

  setVariable(name: string, value: string): UserVariable {
    const updatedAt = new Date().toISOString()
    this.exec(
      `INSERT INTO variables (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [name, value, updatedAt],
    )
    return { name, value, updatedAt }
  }

  deleteVariable(name: string): void {
    this.exec('DELETE FROM variables WHERE name = ?', [name])
  }

  getVariablesMap(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const v of this.listVariables()) map[v.name] = v.value
    return map
  }

  recordRun(actionId: string, ok: boolean, message?: string): void {
    this.exec('INSERT INTO run_history (id, action_id, ran_at, ok, message) VALUES (?, ?, ?, ?, ?)', [
      randomUUID(),
      actionId,
      new Date().toISOString(),
      ok ? 1 : 0,
      message ?? null,
    ])
  }

  listRecentRuns(limit = 20): Array<{ actionId: string; ranAt: string; ok: boolean; message?: string }> {
    return this.all<{ action_id: string; ran_at: string; ok: number; message: string | null }>(
      'SELECT action_id, ran_at, ok, message FROM run_history ORDER BY ran_at DESC LIMIT ?',
      [limit],
    ).map((r) => ({
      actionId: r.action_id,
      ranAt: r.ran_at,
      ok: !!r.ok,
      message: r.message ?? undefined,
    }))
  }

  replaceFromExport(data: {
    categories: Category[]
    actions: Action[]
    variables: UserVariable[]
    settings?: Partial<AppSettings>
  }): void {
    this.exec('DELETE FROM run_history')
    this.exec('DELETE FROM actions')
    this.exec('DELETE FROM categories')
    this.exec('DELETE FROM variables')

    for (const c of data.categories) {
      this.exec('INSERT INTO categories (id, name, sort_order, enabled) VALUES (?, ?, ?, ?)', [
        c.id,
        c.name,
        c.sortOrder,
        c.enabled === false ? 0 : 1,
      ])
    }

    for (const a of data.actions) {
      const searchBlob = buildSearchBlob({
        name: a.name,
        description: a.description,
        tags: a.tags ?? [],
        abbreviation: a.trigger?.abbreviation,
        payload: a.payload,
      })
      this.exec(
        `INSERT INTO actions (
          id, name, description, kind, abbreviation, hotkey, tags, category_id,
          favorite, enabled, payload, created_at, updated_at, last_used_at, search_blob
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id,
          a.name,
          a.description ?? null,
          a.kind,
          a.trigger?.abbreviation ?? null,
          a.trigger?.hotkey ?? null,
          JSON.stringify(a.tags ?? []),
          a.categoryId ?? null,
          a.favorite ? 1 : 0,
          a.enabled === false ? 0 : 1,
          JSON.stringify(a.payload),
          a.createdAt,
          a.updatedAt,
          a.lastUsedAt ?? null,
          searchBlob,
        ],
      )
    }

    for (const v of data.variables) {
      this.exec('INSERT INTO variables (name, value, updated_at) VALUES (?, ?, ?)', [
        v.name,
        v.value,
        v.updatedAt,
      ])
    }

    if (data.settings) this.updateSettings(data.settings)
    this.persist()
  }
}
