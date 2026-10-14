import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  TemplateSuggestionGroups,
  TemplateSuggestionSettings,
  UserVariable,
} from '@textpro/core'
import { DEFAULT_TEMPLATE_SUGGESTIONS } from '@textpro/core'

type SuggestionGroup = keyof TemplateSuggestionGroups

type Suggestion = {
  id: string
  group: SuggestionGroup
  token: string
  label: string
  description: string
  insertFull?: string
}

const BUILTIN: Suggestion[] = [
  {
    id: 'clipboard',
    group: 'context',
    token: 'clipboard',
    label: 'clipboard',
    description: 'Current clipboard text',
  },
  { id: 'date', group: 'context', token: 'date', label: 'date', description: "Today's date" },
  { id: 'time', group: 'context', token: 'time', label: 'time', description: 'Current time' },
  {
    id: 'datetime',
    group: 'context',
    token: 'datetime',
    label: 'datetime',
    description: 'Date and time',
  },
  {
    id: 'cursor',
    group: 'context',
    token: 'cursor',
    label: 'cursor',
    description: 'Leave the caret here after insert',
  },
  {
    id: 'prompt',
    group: 'prompts',
    token: 'prompt:Label',
    label: 'prompt:Label',
    description: 'Ask for a value before insert — rename Label',
  },
  {
    id: 'key-enter',
    group: 'keys',
    token: 'key:enter',
    label: 'key:enter',
    description: 'Press Enter after text',
  },
  {
    id: 'wait',
    group: 'keys',
    token: 'wait:2s',
    label: 'wait:2s',
    description: 'Pause so the next page can appear (for example a password step)',
  },
  {
    id: 'key-tab',
    group: 'keys',
    token: 'key:tab',
    label: 'key:tab',
    description: 'Press Tab (next field)',
  },
  {
    id: 'key-escape',
    group: 'keys',
    token: 'key:escape',
    label: 'key:escape',
    description: 'Press Escape',
  },
  {
    id: 'key-space',
    group: 'keys',
    token: 'key:space',
    label: 'key:space',
    description: 'Press Space',
  },
  {
    id: 'enter',
    group: 'keys',
    token: 'enter',
    label: 'enter',
    description: 'Shorthand for key:enter',
  },
  { id: 'tab', group: 'keys', token: 'tab', label: 'tab', description: 'Shorthand for key:tab' },
]

const GROUP_LABELS: Record<SuggestionGroup, string> = {
  context: 'Context',
  prompts: 'Prompts',
  keys: 'Keys',
  variables: 'Variables',
}

type ActiveToken = {
  start: number
  end: number
  query: string
}

/** Find an open {{…}} at the cursor (no closing }} yet). */
export function findActiveToken(value: string, cursor: number): ActiveToken | null {
  const before = value.slice(0, cursor)
  const open = before.lastIndexOf('{{')
  if (open < 0) return null

  const afterOpen = before.slice(open + 2)
  if (afterOpen.includes('}}')) return null
  if (afterOpen.includes('\n')) return null

  return {
    start: open,
    end: cursor,
    query: afterOpen,
  }
}

function buildSuggestions(variables: UserVariable[]): Suggestion[] {
  const vars: Suggestion[] = variables.map((v) => ({
    id: `var:${v.name}`,
    group: 'variables' as const,
    token: `var:${v.name}`,
    label: `var:${v.name}`,
    description: v.value.length > 40 ? `${v.value.slice(0, 40)}…` : v.value || 'User variable',
  }))
  return [...BUILTIN, ...vars]
}

type Props = {
  value: string
  onChange: (value: string) => void
  variables: UserVariable[]
  suggestionSettings: TemplateSuggestionSettings
  onSuggestionSettingsChange: (next: TemplateSuggestionSettings) => void
  rows?: number
  placeholder?: string
}

export function TemplateBodyEditor({
  value,
  onChange,
  variables,
  suggestionSettings,
  onSuggestionSettingsChange,
  rows = 10,
  placeholder,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<ActiveToken | null>(null)
  const [index, setIndex] = useState(0)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const settings = suggestionSettings ?? DEFAULT_TEMPLATE_SUGGESTIONS
  const groups = settings.groups

  const all = useMemo(() => {
    const built = buildSuggestions(variables)
    return built.filter((s) => groups[s.group])
  }, [variables, groups])

  const filtered = useMemo(() => {
    if (!settings.enabled || !active) return []
    const q = active.query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    )
  }, [active, all, settings.enabled])

  useEffect(() => {
    setIndex(0)
  }, [active?.query, open])

  const setEnabled = (enabled: boolean) => {
    onSuggestionSettingsChange({ ...settings, enabled })
    if (!enabled) {
      setOpen(false)
      setActive(null)
    }
  }

  const setGroup = (group: SuggestionGroup, on: boolean) => {
    onSuggestionSettingsChange({
      ...settings,
      groups: { ...settings.groups, [group]: on },
    })
  }

  const updateFromTextarea = (el: HTMLTextAreaElement) => {
    if (!settings.enabled) {
      setActive(null)
      setOpen(false)
      return
    }

    const token = findActiveToken(el.value, el.selectionStart)
    setActive(token)
    setOpen(!!token)

    if (token) {
      const style = window.getComputedStyle(el)
      const lineHeight = parseFloat(style.lineHeight) || 20
      const paddingTop = parseFloat(style.paddingTop) || 0
      const paddingLeft = parseFloat(style.paddingLeft) || 0
      const before = el.value.slice(0, token.start)
      const lines = before.split('\n')
      const row = lines.length - 1
      const col = lines[lines.length - 1]?.length ?? 0
      const charWidth = 8.2
      setMenuPos({
        top: paddingTop + (row + 1) * lineHeight - el.scrollTop + 4,
        left: Math.min(paddingLeft + col * charWidth - el.scrollLeft, el.clientWidth - 260),
      })
    }
  }

  const applySuggestion = (suggestion: Suggestion) => {
    const el = textareaRef.current
    if (!el || !active) return

    const insert = suggestion.insertFull ?? `{{${suggestion.token}}}`
    const next = value.slice(0, active.start) + insert + value.slice(active.end)
    onChange(next)
    setOpen(false)
    setActive(null)

    const cursor = active.start + insert.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(cursor, cursor)
      if (suggestion.token === 'prompt:Label') {
        const labelStart = active.start + '{{prompt:'.length
        const labelEnd = labelStart + 'Label'.length
        el.setSelectionRange(labelStart, labelEnd)
      }
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || filtered.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      applySuggestion(filtered[index] ?? filtered[0])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="template-editor">
      <div className="suggest-toggles">
        <label className="check compact">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Suggestions
        </label>
        {(Object.keys(GROUP_LABELS) as SuggestionGroup[]).map((group) => (
          <label key={group} className={`check compact ${!settings.enabled ? 'disabled' : ''}`}>
            <input
              type="checkbox"
              checked={groups[group]}
              disabled={!settings.enabled}
              onChange={(e) => setGroup(group, e.target.checked)}
            />
            {GROUP_LABELS[group]}
          </label>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value)
          updateFromTextarea(e.target)
        }}
        onKeyUp={(e) => updateFromTextarea(e.currentTarget)}
        onClick={(e) => updateFromTextarea(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150)
        }}
      />

      {open && filtered.length > 0 && (
        <ul
          className="template-suggest"
          style={{ top: menuPos.top, left: Math.max(menuPos.left, 8) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((s, i) => (
            <li
              key={s.id}
              className={i === index ? 'active' : ''}
              onMouseEnter={() => setIndex(i)}
              onClick={() => applySuggestion(s)}
            >
              <div className="suggest-row">
                <code>{`{{${s.label}}}`}</code>
                <span className="tag">{GROUP_LABELS[s.group]}</span>
              </div>
              <span className="muted">{s.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
