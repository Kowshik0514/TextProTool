import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  Action,
  AppSettings,
  Category,
  InsertionMode,
  TemplateSuggestionSettings,
  UserVariable,
} from '@textpro/core'
import { DEFAULT_TEMPLATE_SUGGESTIONS } from '@textpro/core'
import { TemplateBodyEditor } from './TemplateBodyEditor'
import './styles.css'
import './manager.css'

type Tab = 'snippets' | 'variables' | 'settings' | 'plugins'

type Draft = {
  id?: string
  name: string
  description: string
  kind: string
  tags: string
  categoryId: string
  favorite: boolean
  enabled: boolean
  abbreviation: string
  body: string
  url: string
  appPath: string
  insertionMode: InsertionMode
}

const emptyDraft = (): Draft => ({
  name: '',
  description: '',
  kind: 'text.insert',
  tags: '',
  categoryId: '',
  favorite: false,
  enabled: true,
  abbreviation: '',
  body: '',
  url: 'https://',
  appPath: '',
  insertionMode: 'paste',
})

function actionToDraft(a: Action): Draft {
  const payload = a.payload as Record<string, unknown>
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? '',
    kind: a.kind,
    tags: a.tags.join(', '),
    categoryId: a.categoryId ?? '',
    favorite: a.favorite,
    enabled: a.enabled !== false,
    abbreviation: a.trigger?.abbreviation ?? '',
    body: typeof payload.body === 'string' ? payload.body : '',
    url: typeof payload.url === 'string' ? payload.url : 'https://',
    appPath: typeof payload.path === 'string' ? payload.path : '',
    insertionMode: (payload.insertionMode as InsertionMode) || 'paste',
  }
}

function ManagerApp() {
  const [tab, setTab] = useState<Tab>('snippets')
  const [actions, setActions] = useState<Action[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [variables, setVariables] = useState<UserVariable[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [plugins, setPlugins] = useState<Array<{ id: string; name: string; version?: string }>>([])
  const [history, setHistory] = useState<
    Array<{ actionId: string; ranAt: string; ok: boolean; message?: string }>
  >([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [filter, setFilter] = useState('')
  const [preview, setPreview] = useState('')
  const [status, setStatus] = useState('')
  const [varName, setVarName] = useState('')
  const [varValue, setVarValue] = useState('')

  const reload = async () => {
    const [a, c, v, s, p, h] = await Promise.all([
      window.textpro.listActions(),
      window.textpro.listCategories(),
      window.textpro.listVariables(),
      window.textpro.getSettings(),
      window.textpro.listPlugins(),
      window.textpro.listHistory(),
    ])
    setActions(a)
    setCategories(c)
    setVariables(v)
    setSettings(s)
    setPlugins(p)
    setHistory(h)
  }

  useEffect(() => {
    void reload()
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return actions
    return actions.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)) ||
        (a.trigger?.abbreviation ?? '').toLowerCase().includes(q) ||
        a.kind.toLowerCase().includes(q),
    )
  }, [actions, filter])

  const select = (a: Action) => {
    setSelectedId(a.id)
    setDraft(actionToDraft(a))
    setPreview('')
    setStatus('')
  }

  const newSnippet = () => {
    setSelectedId(null)
    setDraft({
      ...emptyDraft(),
      categoryId: categories[0]?.id ?? '',
    })
    setPreview('')
    setStatus('')
  }

  const save = async () => {
    try {
      const tags = draft.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const trigger = {
        abbreviation: draft.abbreviation.trim() || undefined,
      }
      let payload: Record<string, unknown>
      if (draft.kind === 'text.insert') {
        payload = { body: draft.body, insertionMode: draft.insertionMode }
      } else if (draft.kind === 'url.open') {
        payload = { url: draft.url }
      } else if (draft.kind === 'app.launch') {
        payload = { path: draft.appPath, args: [] }
      } else {
        payload = { body: draft.body }
      }

      const input = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        kind: draft.kind,
        tags,
        categoryId: draft.categoryId || null,
        favorite: draft.favorite,
        enabled: draft.enabled,
        trigger,
        payload,
      }

      if (!input.name) {
        setStatus('Name is required')
        return
      }

      let saved: Action
      if (draft.id) {
        saved = await window.textpro.updateAction(draft.id, input)
      } else {
        saved = await window.textpro.createAction(input)
      }
      await reload()
      select(saved)
      setStatus('Saved')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async () => {
    if (!draft.id) return
    if (!confirm(`Delete “${draft.name}”?`)) return
    await window.textpro.deleteAction(draft.id)
    setDraft(emptyDraft())
    setSelectedId(null)
    await reload()
    setStatus('Deleted')
  }

  const refreshPreview = async () => {
    if (!draft.id || draft.kind !== 'text.insert') {
      setPreview(draft.body)
      return
    }
    try {
      // For preview, leave prompts as placeholders visually by supplying blanks
      const fields = [...draft.body.matchAll(/\{\{\s*prompt:([^}]+)\s*\}\}/g)].map((m) => m[0])
      const prompts: Record<string, string> = {}
      for (const f of fields) {
        const key = f.replace(/^\{\{\s*|\s*\}\}$/g, '')
        prompts[key] = `[${key.slice('prompt:'.length)}]`
      }
      const text = await window.textpro.previewAction(draft.id, prompts)
      setPreview(text)
    } catch (err) {
      setPreview(err instanceof Error ? err.message : String(err))
    }
  }

  const addCategory = async () => {
    const name = prompt('Category name')
    if (!name) return
    await window.textpro.createCategory(name)
    await reload()
  }

  const saveVariable = async () => {
    if (!varName.trim()) return
    await window.textpro.setVariable(varName.trim(), varValue)
    setVarName('')
    setVarValue('')
    await reload()
  }

  const saveSettings = async (partial: Partial<AppSettings>) => {
    const next = await window.textpro.updateSettings(partial)
    setSettings(next)
    setStatus('Settings updated')
  }

  return (
    <div className="manager">
      <aside className="sidebar">
        <div className="brand">
          <h1>TextPro</h1>
          <p className="muted">Personal automation</p>
        </div>
        <nav>
          {(
            [
              ['snippets', 'Snippets'],
              ['variables', 'Variables'],
              ['settings', 'Settings'],
              ['plugins', 'Plugins'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? 'nav active' : 'nav'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button
            onClick={async () => {
              const r = await window.textpro.exportData()
              setStatus(r.ok ? `Exported to ${r.path}` : 'Export cancelled')
            }}
          >
            Export
          </button>
          <button
            onClick={async () => {
              const r = await window.textpro.importData()
              if (r.ok) {
                await reload()
                setStatus(`Imported ${r.count} actions`)
              } else setStatus('Import cancelled')
            }}
          >
            Import
          </button>
        </div>
      </aside>

      <main className="content">
        {tab === 'snippets' && (
          <div className="snippets-layout">
            <section className="list-pane">
              <div className="toolbar">
                <input
                  placeholder="Filter…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <button className="primary" onClick={newSnippet}>
                  New
                </button>
              </div>

              {categories.length > 0 && (
                <div className="group-toggles">
                  <div className="group-toggles-title muted">Groups</div>
                  {categories.map((c) => (
                    <label key={c.id} className={`check compact ${c.enabled ? '' : 'disabled'}`}>
                      <input
                        type="checkbox"
                        checked={c.enabled !== false}
                        onChange={async (e) => {
                          e.stopPropagation()
                          await window.textpro.updateCategory(c.id, { enabled: e.target.checked })
                          await reload()
                          setStatus(
                            e.target.checked
                              ? `Group “${c.name}” on`
                              : `Group “${c.name}” off`,
                          )
                        }}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}

              <ul className="action-list">
                {filtered.map((a) => {
                  const cat = categories.find((c) => c.id === a.categoryId)
                  const groupOff = !!(cat && cat.enabled === false)
                  const off = a.enabled === false || groupOff
                  return (
                    <li
                      key={a.id}
                      className={`${selectedId === a.id ? 'active' : ''} ${off ? 'disabled-item' : ''}`}
                      onClick={() => select(a)}
                    >
                      <label
                        className="check compact snippet-toggle"
                        title={
                          groupOff
                            ? 'Group is off — turn the group on above'
                            : a.enabled === false
                              ? 'Snippet off'
                              : 'Snippet on'
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={a.enabled !== false}
                          disabled={groupOff}
                          onChange={async (e) => {
                            e.stopPropagation()
                            const updated = await window.textpro.updateAction(a.id, {
                              enabled: e.target.checked,
                            })
                            await reload()
                            if (selectedId === a.id) select(updated)
                            setStatus(
                              e.target.checked ? `“${a.name}” on` : `“${a.name}” off`,
                            )
                          }}
                        />
                      </label>
                      <div className="action-main">
                        <strong>
                          {a.favorite ? '★ ' : ''}
                          {a.name}
                        </strong>
                        <div className="muted small">
                          {a.kind}
                          {a.trigger?.abbreviation ? ` · ${a.trigger.abbreviation}` : ''}
                          {groupOff ? ' · group off' : a.enabled === false ? ' · off' : ''}
                        </div>
                      </div>
                      <div className="tags">
                        {a.tags.slice(0, 3).map((t) => (
                          <span className="tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="editor-pane">
              <div className="editor-header">
                <h2>{draft.id ? 'Edit action' : 'New action'}</h2>
                <div className="row">
                  <button className="primary" onClick={() => void save()}>
                    Save
                  </button>
                  {draft.id && (
                    <button className="danger" onClick={() => void remove()}>
                      Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>Name</label>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Kind</label>
                  <select
                    value={draft.kind}
                    onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                  >
                    <option value="text.insert">Text insert</option>
                    <option value="url.open">Open URL</option>
                    <option value="app.launch">Launch app</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Description</label>
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>Abbreviation (e.g. ;sig)</label>
                  <input
                    value={draft.abbreviation}
                    onChange={(e) => setDraft({ ...draft, abbreviation: e.target.value })}
                    placeholder=";email"
                  />
                </div>
                <div className="field">
                  <label>Category</label>
                  <div className="row">
                    <select
                      value={draft.categoryId}
                      onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                    >
                      <option value="">None</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => void addCategory()}>+</button>
                  </div>
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>Tags (comma-separated)</label>
                  <input
                    value={draft.tags}
                    onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Favorite</label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.favorite}
                      onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })}
                    />
                    Show at top of palette
                  </label>
                </div>
              </div>

              <div className="field">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  />
                  Enabled (show in palette & abbreviations)
                </label>
              </div>

              {draft.kind === 'text.insert' && (
                <>
                  <div className="field">
                    <label>Template body</label>
                    <TemplateBodyEditor
                      rows={10}
                      value={draft.body}
                      onChange={(body) => setDraft({ ...draft, body })}
                      variables={variables}
                      suggestionSettings={
                        settings?.templateSuggestions ?? DEFAULT_TEMPLATE_SUGGESTIONS
                      }
                      onSuggestionSettingsChange={(templateSuggestions) => {
                        const next = settings
                          ? { ...settings, templateSuggestions }
                          : null
                        if (next) setSettings(next)
                        void saveSettings({ templateSuggestions })
                      }}
                      placeholder={
                        'Hi Team,\n\n{{clipboard}}\n\nPlease approve.\n\nTicket: {{prompt:Ticket}}'
                      }
                    />
                    <p className="hint muted">
                      Type {'{{'} for suggestions. Toggle groups above the editor.
                    </p>
                  </div>
                  <div className="field">
                    <label>Insertion mode</label>
                    <select
                      value={draft.insertionMode}
                      onChange={(e) =>
                        setDraft({ ...draft, insertionMode: e.target.value as InsertionMode })
                      }
                    >
                      <option value="paste">Paste (default)</option>
                      <option value="type">Simulate typing</option>
                      <option value="auto">Auto (prefer paste)</option>
                    </select>
                  </div>
                  <div className="preview-box">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <label>Resolved preview</label>
                      <button onClick={() => void refreshPreview()}>Refresh preview</button>
                    </div>
                    <pre>{preview || 'Click refresh to preview with live clipboard/vars.'}</pre>
                  </div>
                </>
              )}

              {draft.kind === 'url.open' && (
                <div className="field">
                  <label>URL</label>
                  <input
                    value={draft.url}
                    onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  />
                </div>
              )}

              {draft.kind === 'app.launch' && (
                <div className="field">
                  <label>Application path</label>
                  <input
                    value={draft.appPath}
                    onChange={(e) => setDraft({ ...draft, appPath: e.target.value })}
                    placeholder="C:\\Program Files\\..."
                  />
                </div>
              )}

              {status && <p className="status">{status}</p>}
            </section>
          </div>
        )}

        {tab === 'variables' && (
          <div className="panel">
            <h2>User variables</h2>
            <p className="muted">Reference with {'{{var:Name}}'} in templates.</p>
            <div className="grid-2">
              <div className="field">
                <label>Name</label>
                <input value={varName} onChange={(e) => setVarName(e.target.value)} />
              </div>
              <div className="field">
                <label>Value</label>
                <input value={varValue} onChange={(e) => setVarValue(e.target.value)} />
              </div>
            </div>
            <button className="primary" onClick={() => void saveVariable()}>
              Save variable
            </button>
            <ul className="var-list">
              {variables.map((v) => (
                <li key={v.name}>
                  <div>
                    <strong>{v.name}</strong>
                    <div className="muted">{v.value}</div>
                  </div>
                  <button
                    className="danger"
                    onClick={async () => {
                      await window.textpro.deleteVariable(v.name)
                      await reload()
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'settings' && settings && (
          <div className="panel">
            <h2>Settings</h2>
            <div className="field">
              <label>Palette hotkey</label>
              <input
                value={settings.paletteHotkey}
                onChange={(e) => setSettings({ ...settings, paletteHotkey: e.target.value })}
                onBlur={() => void saveSettings({ paletteHotkey: settings.paletteHotkey })}
              />
              <p className="hint muted">Electron accelerator, e.g. CommandOrControl+Shift+Space</p>
            </div>
            <div className="field">
              <label>Default insertion mode</label>
              <select
                value={settings.defaultInsertionMode}
                onChange={(e) => {
                  const defaultInsertionMode = e.target.value as InsertionMode
                  setSettings({ ...settings, defaultInsertionMode })
                  void saveSettings({ defaultInsertionMode })
                }}
              >
                <option value="paste">Paste</option>
                <option value="type">Type</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <div className="field">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.abbreviationEnabled}
                  onChange={(e) => {
                    const abbreviationEnabled = e.target.checked
                    setSettings({ ...settings, abbreviationEnabled })
                    void saveSettings({ abbreviationEnabled })
                  }}
                />
                Enable abbreviation expansion (type abbrev + space)
              </label>
            </div>
            <div className="field">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.showManagerOnStartup}
                  onChange={(e) => {
                    const showManagerOnStartup = e.target.checked
                    setSettings({ ...settings, showManagerOnStartup })
                    void saveSettings({ showManagerOnStartup })
                  }}
                />
                Open this window when TextPro starts
              </label>
            </div>

            <h3>Template suggestions</h3>
            <p className="muted hint">Shown when typing {'{{'} in a template body.</p>
            <div className="field">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.templateSuggestions?.enabled ?? true}
                  onChange={(e) => {
                    const templateSuggestions: TemplateSuggestionSettings = {
                      ...(settings.templateSuggestions ?? DEFAULT_TEMPLATE_SUGGESTIONS),
                      enabled: e.target.checked,
                    }
                    setSettings({ ...settings, templateSuggestions })
                    void saveSettings({ templateSuggestions })
                  }}
                />
                Enable template suggestions
              </label>
            </div>
            <div className="suggest-settings-groups">
              {(
                [
                  ['context', 'Context (clipboard, date, time)'],
                  ['prompts', 'Prompts'],
                  ['keys', 'Keys (enter, tab, …)'],
                  ['variables', 'User variables'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="check">
                  <input
                    type="checkbox"
                    checked={settings.templateSuggestions?.groups?.[key] ?? true}
                    disabled={!(settings.templateSuggestions?.enabled ?? true)}
                    onChange={(e) => {
                      const current =
                        settings.templateSuggestions ?? DEFAULT_TEMPLATE_SUGGESTIONS
                      const templateSuggestions: TemplateSuggestionSettings = {
                        ...current,
                        groups: { ...current.groups, [key]: e.target.checked },
                      }
                      setSettings({ ...settings, templateSuggestions })
                      void saveSettings({ templateSuggestions })
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            {status && <p className="status">{status}</p>}
          </div>
        )}

        {tab === 'plugins' && (
          <div className="panel">
            <h2>Plugins & history</h2>
            <h3>Registered plugins</h3>
            <ul className="var-list">
              {plugins.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted">
                      {p.id}
                      {p.version ? ` · v${p.version}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <h3>Recent runs</h3>
            <ul className="var-list">
              {history.map((h, i) => {
                const action = actions.find((a) => a.id === h.actionId)
                return (
                  <li key={`${h.actionId}-${i}`}>
                    <div>
                      <strong>
                        {h.ok ? '✓' : '✗'} {action?.name ?? h.actionId}
                      </strong>
                      <div className="muted">
                        {new Date(h.ranAt).toLocaleString()}
                        {h.message ? ` — ${h.message}` : ''}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="muted hint">
              New action kinds register via <code>ActionRegistry</code> / <code>PluginHost</code> in
              @textpro/core. Built-ins: text.insert, url.open, app.launch.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ManagerApp />
  </StrictMode>,
)
