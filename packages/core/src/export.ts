import type { Action, ExportBundle, Category, UserVariable, AppSettings } from './types.js'

export function createExportBundle(input: {
  categories: Category[]
  actions: Action[]
  variables: UserVariable[]
  settings?: Partial<AppSettings>
}): ExportBundle {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: input.categories,
    actions: input.actions,
    variables: input.variables,
    settings: input.settings,
  }
}

export function parseExportBundle(raw: unknown): ExportBundle {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid export: expected an object')
  }
  const data = raw as Record<string, unknown>
  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${String(data.version)}`)
  }
  if (!Array.isArray(data.actions) || !Array.isArray(data.categories)) {
    throw new Error('Invalid export: missing actions or categories')
  }
  return {
    version: 1,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
    categories: data.categories as Category[],
    actions: data.actions as Action[],
    variables: Array.isArray(data.variables) ? (data.variables as UserVariable[]) : [],
    settings: data.settings as Partial<AppSettings> | undefined,
  }
}
