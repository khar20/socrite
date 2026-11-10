import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, Plus, Trash2 } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { Assessment, Question } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, Select, TextArea, TextInput, useToast } from '../components/ui'

export function AssessmentsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<Assessment['kind']>('practice')
  const [questionToAdd, setQuestionToAdd] = useState<Record<string, string>>({})
  const assessments = useQuery({ queryKey: ['assessments', courseId], queryFn: () => api<Assessment[]>(`/courses/${courseId}/assessments`) })
  const questions = useQuery({ queryKey: ['questions', courseId], queryFn: () => api<Question[]>(`/courses/${courseId}/questions`) })
  const create = useMutation({
    mutationFn: () => api<Assessment>(`/courses/${courseId}/assessments`, {
      method: 'POST', body: jsonBody({ title, description, kind }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assessments', courseId] })
      setOpen(false)
      setTitle('')
      setDescription('')
      toast('Evaluación creada como borrador.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const addQuestion = useMutation({
    mutationFn: ({ assessmentId, questionId, position }: { assessmentId: string; questionId: string; position: number }) => api(
      `/assessments/${assessmentId}/questions/${questionId}`,
      { method: 'PUT', body: jsonBody({ question_id: questionId, position, points: 1 }) },
    ),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['assessments', courseId] }); toast('Pregunta agregada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const removeQuestion = useMutation({
    mutationFn: ({ assessmentId, questionId }: { assessmentId: string; questionId: string }) => api(
      `/assessments/${assessmentId}/questions/${questionId}`, { method: 'DELETE' },
    ),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['assessments', courseId] }); toast('Pregunta retirada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const publish = useMutation({
    mutationFn: (id: string) => api(`/assessments/${id}/publish`, { method: 'PATCH' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['assessments', courseId] }); toast('Evaluación publicada para estudiantes.') },
    onError: (error) => toast(error.message, 'error'),
  })
  if (assessments.isLoading || questions.isLoading) return <LoadingState />
  if (assessments.isError || questions.isError) return <ErrorState message="No pudimos cargar las evaluaciones." retry={() => { void assessments.refetch(); void questions.refetch() }} />
  const items = assessments.data!
  const publishedQuestions = questions.data!.filter((question) => question.status === 'published')
  const kinds: { value: Assessment['kind']; label: string }[] = [
    { value: 'diagnostic', label: 'Diagnóstico' },
    { value: 'practice', label: 'Práctica' },
    { value: 'quiz', label: 'Cuestionario' },
    { value: 'transfer', label: 'Transferencia' },
  ]

  return <>
    <PageHeader title="Evaluaciones" description="Agrupa preguntas publicadas en diagnósticos, prácticas, cuestionarios y actividades de transferencia." actions={<Button onClick={() => setOpen(true)}><Plus size={16} />Nueva evaluación</Button>} />
    {!items.length ? <Card><EmptyState icon={ClipboardCheck} title="Aún no hay evaluaciones" description="Crea una evaluación y agrega preguntas publicadas del banco." action={<Button onClick={() => setOpen(true)}><Plus size={15} />Crear evaluación</Button>} /></Card> : <div className="assessment-list">{items.map((assessment) => {
      const attached = questions.data!.filter((question) => assessment.question_ids.includes(question.id))
      return <Card key={assessment.id}><div className="assessment-card"><span className="question-icon"><ClipboardCheck size={19} /></span><div className="assessment-copy"><div className="assessment-title-row"><strong>{assessment.title}</strong><Badge tone={assessment.status === 'published' ? 'success' : 'warning'}>{assessment.status === 'published' ? 'Publicada' : 'Borrador'}</Badge></div><p>{assessment.description || 'Sin instrucciones adicionales.'}</p><small>{kinds.find((item) => item.value === assessment.kind)?.label} · {attached.length} preguntas</small>{!!attached.length && <ul className="assessment-questions">{attached.map((question) => <li key={question.id}><span>{question.prompt}</span>{assessment.status === 'draft' && <button aria-label="Retirar pregunta" onClick={() => removeQuestion.mutate({ assessmentId: assessment.id, questionId: question.id })}><Trash2 size={14} /></button>}</li>)}</ul>}{assessment.status === 'draft' && <div className="assessment-add-question"><Select aria-label="Pregunta para agregar" value={questionToAdd[assessment.id] || ''} onChange={(event) => setQuestionToAdd({ ...questionToAdd, [assessment.id]: event.target.value })}><option value="">Selecciona una pregunta publicada</option>{publishedQuestions.filter((question) => !assessment.question_ids.includes(question.id)).map((question) => <option value={question.id} key={question.id}>{question.prompt}</option>)}</Select><Button size="small" variant="outline" disabled={!questionToAdd[assessment.id] || addQuestion.isPending} onClick={() => { const questionId = questionToAdd[assessment.id]; addQuestion.mutate({ assessmentId: assessment.id, questionId, position: assessment.question_ids.length }); setQuestionToAdd({ ...questionToAdd, [assessment.id]: '' }) }}><Plus size={14} />Agregar</Button></div>}</div>{assessment.status === 'draft' && <Button variant="outline" size="small" disabled={!assessment.question_ids.length || publish.isPending} onClick={() => publish.mutate(assessment.id)}><Check size={14} />Publicar</Button>}</div></Card>
    })}</div>}
    {!publishedQuestions.length && <div className="inline-alert alert-info page-note"><ClipboardCheck size={16} /><span>Publica preguntas del banco antes de agregarlas a una evaluación.</span></div>}
    <Modal open={open} onClose={() => setOpen(false)} title="Nueva evaluación" description="La evaluación queda como borrador hasta que tenga preguntas y la publiques." onSubmit={(event) => { event.preventDefault(); create.mutate() }} submitLabel="Crear borrador" busy={create.isPending}>
      <Field label="Título" required><TextInput autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} maxLength={200} placeholder="Ej. Diagnóstico de funciones" /></Field>
      <Field label="Tipo"><Select value={kind} onChange={(event) => setKind(event.target.value as Assessment['kind'])}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
      <Field label="Instrucciones"><TextArea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} placeholder="Indica cómo prepararse y qué se espera en las respuestas." /></Field>
    </Modal>
  </>
}
