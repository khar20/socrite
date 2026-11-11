import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Check, CircleAlert, Info, LoaderCircle, X } from 'lucide-react'

type ToastItem = { id: number; message: string; tone: 'success' | 'error' | 'info' }
const ToastContext = createContext<(message: string, tone?: ToastItem['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const toast = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    const id = Date.now() + Math.random()
    setItems((current) => [...current, { id, message, tone }])
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200)
  }, [])
  return <ToastContext.Provider value={toast}>
    {children}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {items.map((item) => <div className={`toast toast-${item.tone}`} key={item.id}>
        {item.tone === 'success' ? <Check size={17} /> : item.tone === 'error' ? <CircleAlert size={17} /> : <Info size={17} />}
        <span>{item.message}</span>
        <button className="icon-button toast-dismiss" onClick={() => setItems((current) => current.filter((x) => x.id !== item.id))} aria-label="Cerrar notificación"><X size={15} /></button>
      </div>)}
    </div>
  </ToastContext.Provider>
}

export const useToast = () => useContext(ToastContext)

export function Button({ children, variant = 'primary', size, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger'; size?: 'small' | 'large' }) {
  return <button className={`button button-${variant}${size ? ` button-${size}` : ''} ${className}`} {...props}>{children}</button>
}

export function Card({ children, className = '', ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={`content-card ${className}`} {...props}>{children}</section>
}

export function CardHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className="card-heading"><h2>{children}</h2>{aside}</div>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{description && <p className="muted-text">{description}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</header>
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: React.ComponentType<{ size?: number }>; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={22} /></div><h3>{title}</h3><p>{description}</p>{action && <div className="empty-action">{action}</div>}</div>
}

export function LoadingState({ label = 'Cargando información…' }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={19} />{label}</div>
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state"><CircleAlert size={19} /><div><strong>No se pudo cargar</strong><p>{message}</p>{retry && <Button variant="outline" size="small" onClick={retry}>Reintentar</Button>}</div></div>
}

export function Modal({ title, description, open, onClose, children, onSubmit, submitLabel, busy = false, wide = false }: {
  title: string; description?: string; open: boolean; onClose: () => void; children: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void; submitLabel?: string; busy?: boolean; wide?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])
  const content = <>
    <div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId} className="muted-text text-small">{description}</p>}</div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"> <X size={18} /></button></div>
    <div className="modal-body">{children}</div>
    {(onSubmit || submitLabel) && <div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>{onSubmit && <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" size={15} />}{submitLabel || 'Guardar'}</Button>}</div>}
  </>
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} className={`modal-dialog${wide ? ' modal-wide' : ''}`} onCancel={(event) => { event.preventDefault(); onClose() }} onClose={onClose}>
    {onSubmit ? <form onSubmit={onSubmit}>{content}</form> : content}
  </dialog>
}

export function Field({ label, hint, error, children, required = false }: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return <div className="form-field"><label className="field-label">{label}{required && <span aria-hidden="true"> *</span>}{children}</label>{hint && !error && <p className="field-hint">{hint}</p>}{error && <p className="field-error" role="alert">{error}</p>}</div>
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="text-input" {...props} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="text-area" {...props} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select-input" {...props} />
}

export function Stat({ icon: Icon, label, value, detail }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string | number; detail: string }) {
  return <Card className="stat-card"><div className="stat-top"><span>{label}</span><Icon size={17} /></div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></Card>
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-scroll"><table>{children}</table></div>
}

export function PaginationControls({ total, limit, offset, onChange }: {
  total: number; limit: number; offset: number; onChange: (offset: number) => void
}) {
  if (total <= limit) return null
  const start = offset + 1
  const end = Math.min(offset + limit, total)
  return <nav className="pagination-controls" aria-label="Paginación">
    <span>{start}–{end} de {total}</span>
    <div><Button variant="outline" size="small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Anterior</Button>
      <Button variant="outline" size="small" disabled={end >= total} onClick={() => onChange(offset + limit)}>Siguiente</Button></div>
  </nav>
}
