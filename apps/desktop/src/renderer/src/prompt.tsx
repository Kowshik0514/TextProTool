import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './prompt.css'

function PromptApp() {
  const [fields, setFields] = useState<Array<{ key: string; label: string }>>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return window.textpro.onPromptFields((f) => {
      setFields(f)
      const init: Record<string, string> = {}
      for (const field of f) init[field.key] = ''
      setValues(init)
      requestAnimationFrame(() => firstRef.current?.focus())
    })
  }, [])

  const submit = async () => {
    await window.textpro.submitPrompt(values)
  }

  const cancel = async () => {
    await window.textpro.cancelPrompt()
  }

  return (
    <div
      className="prompt"
      onKeyDown={(e) => {
        if (e.key === 'Escape') void cancel()
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
      }}
    >
      <h2>Fill in values</h2>
      {fields.map((f, i) => (
        <div className="field" key={f.key}>
          <label>{f.label}</label>
          <input
            ref={i === 0 ? firstRef : undefined}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && i === fields.length - 1) {
                e.preventDefault()
                void submit()
              }
            }}
          />
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={() => void cancel()}>Cancel</button>
        <button className="primary" onClick={() => void submit()}>
          Insert
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PromptApp />
  </StrictMode>,
)
