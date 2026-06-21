import { useState } from 'react'
import { ANZSIC_OPTIONS } from './catalogue'

interface AnzsicSelectorProps {
  value: string | null
  onChange: (code: string) => void
}

export function AnzsicSelector({ value, onChange }: AnzsicSelectorProps) {
  const [query, setQuery] = useState('')

  const filtered = ANZSIC_OPTIONS.filter((opt) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      opt.code.toLowerCase().includes(q) ||
      opt.label.toLowerCase().includes(q)
    )
  })

  return (
    <div className="anzsic-selector">
      <div className="field">
        <label htmlFor="anzsic-search">Search industry</label>
        <input
          id="anzsic-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by code or name…"
          autoComplete="off"
        />
      </div>

      {filtered.length > 0 && (
        <ul className="anzsic-options" role="listbox" aria-label="Industry options">
          {filtered.map((opt) => (
            <li
              key={opt.code}
              role="option"
              aria-selected={value === opt.code}
              className={value === opt.code ? 'selected' : ''}
              style={{ cursor: 'pointer', padding: '0.4rem 0.6rem' }}
              onClick={() => onChange(opt.code)}
            >
              {opt.code} — {opt.label}
            </li>
          ))}
        </ul>
      )}

      {filtered.length === 0 && query && (
        <p>No industry codes match "{query}".</p>
      )}
    </div>
  )
}
