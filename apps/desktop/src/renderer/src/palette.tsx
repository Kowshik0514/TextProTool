import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Action } from '@textpro/core'
import './styles.css'
import './palette.css'

function kindLabel(kind: string): string {
  if (kind === 'text.insert') return 'text'
  if (kind === 'url.open') return 'url'
  if (kind === 'app.launch') return 'app'
  return kind
}

function PaletteApp() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Action[]>([])
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(async (q: string) => {
    const results = await window.textpro.searchActions(q)
    setItems(results)
    setIndex(0)
  }, [])

  useEffect(() => {
    void search('')
    const unsub = window.textpro.onPaletteFocus(() => {
      setQuery('')
      void search('')
      requestAnimationFrame(() => inputRef.current?.focus())
    })
    inputRef.current?.focus()
    return unsub
  }, [search])

  useEffect(() => {
    const t = setTimeout(() => void search(query), 60)
    return () => clearTimeout(t)
  }, [query, search])

  const run = async (action: Action) => {
    await window.textpro.runAction(action.id)
  }

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[index]
      if (item) await run(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      await window.textpro.hidePalette()
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      await window.textpro.hidePalette()
      await window.textpro.showManager()
    }
  }

  return (
    <div className="palette" onKeyDown={onKeyDown}>
      <div className="palette-search">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search snippets & actions…"
          spellCheck={false}
          autoFocus
        />
      </div>
      <ul className="palette-list">
        {items.length === 0 && <li className="empty muted">No matches</li>}
        {items.map((item, i) => (
          <li
            key={item.id}
            className={i === index ? 'active' : ''}
            onMouseEnter={() => setIndex(i)}
            onClick={() => void run(item)}
          >
            <div className="main">
              <span className="name">
                {item.favorite ? '★ ' : ''}
                {item.name}
              </span>
              {item.description && <span className="desc muted">{item.description}</span>}
            </div>
            <div className="meta">
              <span className="kind">{kindLabel(item.kind)}</span>
              {item.trigger?.abbreviation && (
                <span className="tag">{item.trigger.abbreviation}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="palette-footer muted">
        <span>↵ run</span>
        <span>↑↓ navigate</span>
        <span>esc close</span>
        <span>⇧tab manage</span>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PaletteApp />
  </StrictMode>,
)
