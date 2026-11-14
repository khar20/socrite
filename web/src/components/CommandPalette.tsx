import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export type PaletteItem = {
  label: string
  group: string
  to: string
  icon: React.ComponentType<{ size?: number }>
}

export function CommandPalette({ open, items, onClose }: { open: boolean; items: PaletteItem[]; onClose: () => void }) {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return items
    return items.filter((item) => item.label.toLowerCase().includes(term) || item.group.toLowerCase().includes(term))
  }, [items, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    window.setTimeout(() => input.current?.focus(), 20)
  }, [open])

  useEffect(() => {
    setActive((value) => Math.min(value, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  if (!open) return null

  function choose(item: PaletteItem) {
    navigate(item.to)
    onClose()
  }

  return <div className="palette-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Buscar en Socrite">
      <div className="palette-search"><Search size={17} /><input ref={input} value={query} placeholder="Buscar una sección…"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(value + 1, filtered.length - 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
          if (event.key === 'Enter' && filtered[active]) { event.preventDefault(); choose(filtered[active]) }
        }} /></div>
      <div className="palette-results">
        {filtered.length ? filtered.map((item, index) => <button key={`${item.group}-${item.label}`}
          className={`palette-item${index === active ? ' is-active' : ''}`}
          onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>
          <item.icon size={16} /><span>{item.label}</span><small>{item.group}</small>
        </button>) : <p className="palette-empty">Sin resultados para «{query}».</p>}
      </div>
      <div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></div>
    </div>
  </div>
}
