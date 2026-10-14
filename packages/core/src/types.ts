/** Supported insertion strategies for text actions. */
export type InsertionMode = 'paste' | 'type' | 'auto'

/** Built-in and open-ended action kinds. */
export type ActionKind =
  | 'text.insert'
  | 'url.open'
  | 'app.launch'
  | 'workflow.run'
  | (string & {})

export interface ActionTrigger {
  abbreviation?: string
  hotkey?: string
}

export interface TextInsertPayload {
  body: string
  insertionMode?: InsertionMode
}

export interface UrlOpenPayload {
  url: string
}

export interface AppLaunchPayload {
  path: string
  args?: string[]
}

export interface Action {
  id: string
  name: string
  description?: string
  kind: ActionKind
  trigger?: ActionTrigger
  tags: string[]
  categoryId?: string | null
  favorite: boolean
  /** When false, hidden from palette / abbreviations but kept in Manage */
  enabled: boolean
  payload: TextInsertPayload | UrlOpenPayload | AppLaunchPayload | Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastUsedAt?: string | null
}

export interface Category {
  id: string
  name: string
  sortOrder: number
  /** When false, all snippets in this category are inactive */
  enabled: boolean
}

export interface UserVariable {
  name: string
  value: string
  updatedAt: string
}

export interface TemplateSuggestionGroups {
  context: boolean
  prompts: boolean
  keys: boolean
  variables: boolean
}

export interface TemplateSuggestionSettings {
  enabled: boolean
  groups: TemplateSuggestionGroups
}

export interface AppSettings {
  paletteHotkey: string
  defaultInsertionMode: InsertionMode
  abbreviationEnabled: boolean
  abbreviationDelimiter: string
  showManagerOnStartup: boolean
  templateSuggestions: TemplateSuggestionSettings
}

export const DEFAULT_TEMPLATE_SUGGESTIONS: TemplateSuggestionSettings = {
  enabled: true,
  groups: {
    context: true,
    prompts: true,
    keys: true,
    variables: true,
  },
}

export const DEFAULT_SETTINGS: AppSettings = {
  paletteHotkey: 'CommandOrControl+Shift+Space',
  defaultInsertionMode: 'paste',
  abbreviationEnabled: true,
  abbreviationDelimiter: ' ',
  showManagerOnStartup: true,
  templateSuggestions: { ...DEFAULT_TEMPLATE_SUGGESTIONS, groups: { ...DEFAULT_TEMPLATE_SUGGESTIONS.groups } },
}

export interface ActionSearchResult extends Action {
  score?: number
}

export interface ExportBundle {
  version: 1
  exportedAt: string
  categories: Category[]
  actions: Action[]
  variables: UserVariable[]
  settings?: Partial<AppSettings>
}
