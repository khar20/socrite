import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileQuestion, Plus, Sparkles } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { CurriculumUnit, Question } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, Select, TextArea, useToast } from '../components/ui'

export function QuestionsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [unitId, setUnitId] = useState('')
  const questions = useQuery({ queryKey: ['questions', courseId], queryFn: () => api<Question[]>(`/courses/${courseId}/questions`) })
  const units = useQuery({ queryKey: ['curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/courses/${courseId}/curriculum`) })
  const create = useMutation({
    mutationFn: () => api(`/courses/${courseId}/questions`, { method: 'POST', body: jsonBody({ prompt, unit_id: unitId || null, question_type: 'open', rubric: [] }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['questions', courseId] }); setOpen(false); setPrompt(''); toast('Pregunta guardada como borrador.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const publish = useMutation({
    mutationFn: (id: string) => api(`/questions/${id}/publish`, { method: 'PATCH' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['questions', courseId] }); toast('Pregunta publicada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  if (questions.isLoading || units.isLoading) return <LoadingState />
  if (questions.isError || units.isError) return <ErrorState message="No pudimos cargar el banco de preguntas." retry={() => { void questions.refetch(); void units.refetch() }} />
  const items = questions.data!

  return <>
    <PageHeader title="Banco de preguntas" description="Crea preguntas de práctica y revisa los borradores generados desde tus materiales." actions={<Button onClick={() => setOpen(true)}><Plus size={16} />Nueva pregunta</Button>} />
    {!items.length ? <Card><EmptyState icon={FileQuestion} title="El banco está vacío" description="Escribe una pregunta o genera un borrador a partir de un material ya procesado." action={<Button onClick={() => setOpen(true)}><Plus size={15} />Crear pregunta</Button>} /></Card> : <Card><div className="card-heading card-heading-row"><div><h2>Preguntas del curso</h2><p className="muted-text text-small">{items.length} pregunta{items.length === 1 ? '' : 's'} · los borradores requieren revisión docente.</p></div></div><div className="question-list">{items.map((question) => <article className="question-row" key={question.id}><span className="question-icon"><FileQuestion size={17} /></span><div className="question-copy"><p>{question.prompt}</p><small>{question.question_type === 'open' ? 'Respuesta abierta' : 'Opción múltiple'}{question.unit_id ? ` · Unidad ${units.data!.find((unit) => unit.id === question.unit_id)?.title || ''}` : ''}</small></div><Badge tone={question.status === 'published' ? 'success' : 'warning'}>{question.status === 'published' ? 'Publicada' : 'Borrador'}</Badge>{question.status === 'draft' && <Button size="small" variant="outline" disabled={publish.isPending} onClick={() => publish.mutate(question.id)}><Check size={14} />Aprobar</Button>}</article>)}</div></Card>}
    <Modal open={open} onClose={() => setOpen(false)} title="Nueva pregunta" description="Las preguntas nuevas se guardan como borrador hasta que las apruebes." onSubmit={(event) => { event.preventDefault(); create.mutate() }} submitLabel="Guardar borrador" busy={create.isPending}>
      <Field label="Enunciado" required><TextArea autoFocus rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} minLength={5} maxLength={10000} required placeholder="Escribe una pregunta que invite a explicar el razonamiento…" /></Field>
      <Field label="Unidad"><Select value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="">Sin unidad vinculada</option>{units.data!.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</Select></Field>
      <div className="inline-alert alert-info form-note"><Sparkles size={16} /><span>Los borradores generados por IA deben ser revisados y aprobados antes de publicarse. Para generar uno desde una fuente, abre el material procesado en la biblioteca.</span></div>
    </Modal>
  </>
}
