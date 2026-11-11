import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import type { PageResult } from '../types'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, PaginationControls, TableWrap, useToast } from '../components/ui'

type ActivityItem = { id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }

export function ActivityPage() {
  const { courseId } = useParams()
  const toast = useToast()
  const [offset, setOffset] = useState(0)
  const limit = 50
  const activity = useQuery({
    queryKey: ['activity', courseId || 'all', offset],
    queryFn: () => api<PageResult<ActivityItem>>(`${courseId ? `/courses/${courseId}/activity` : '/teacher/activity'}?limit=${limit}&offset=${offset}`),
  })
  function exportCsv() {
    if (!activity.data?.items.length) return toast('No hay actividad en esta página para exportar.', 'info')
    const rows = [['Fecha', 'Acción', 'Tipo de elemento', 'ID', 'Detalles'], ...activity.data.items.map((item) => [new Date(item.created_at).toISOString(), item.action, item.entity_type, item.entity_id || '', JSON.stringify(item.details || {})])]
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `socrite-actividad-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  if (activity.isLoading) return <LoadingState />
  if (activity.isError) return <ErrorState message="No pudimos cargar el registro de actividad." retry={() => void activity.refetch()} />
  const items = activity.data!.items
  return <>
    <PageHeader title="Actividad y auditoría" description="Registro de cambios realizados en el curso." actions={<Button variant="outline" onClick={exportCsv}><ArrowDownToLine size={15} />Exportar CSV</Button>} />
    <Card>{!activity.data!.total ? <EmptyState icon={ShieldCheck} title="Sin actividad registrada" description="Los cambios que realices en tus cursos aparecerán aquí." /> : <TableWrap><thead><tr><th>Fecha</th><th>Acción</th><th>Elemento</th><th>Referencia</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))}</td><td><strong>{item.action.replaceAll('.', ' · ')}</strong></td><td>{item.entity_type || '—'}</td><td className="muted-text">{item.entity_id || '—'}</td></tr>)}</tbody></TableWrap>}</Card>
    <PaginationControls total={activity.data!.total} limit={limit} offset={offset} onChange={setOffset} />
  </>
}
