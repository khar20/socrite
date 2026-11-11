import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileQuestion, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { CurriculumUnit, Question } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, Select, TextArea, TextInput, useToast } from '../components/ui'

export function QuestionsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)
  const [prompt, setPrompt] = useState('')
  const [unitId, setUnitId] = useState('')
  const [skillId, setSkillId] = useState('')
  const [questionType, setQuestionType] = useState<Question['question_type']>('open')
  const [options, setOptions] = useState('')
  const [answerKey, setAnswerKey] = useState('')
  const [rubric, setRubric] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [discrimination, setDiscrimination] = useState('')
  const questions = useQuery({ queryKey: ['questions', courseId], queryFn: () => api<Question[]>(`/courses/${courseId}/questions`) })
  const units = useQuery({ queryKey: ['curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/courses/${courseId}/curriculum`) })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        prompt: prompt.trim(),
        unit_id: unitId || null,
        skill_id: skillId || null,
        question_type: questionType,
        options: questionType === 'multiple_choice' ? options.split('\n').map((option) => option.trim()).filter(Boolean) : null,
        answer_key: questionType === 'open' ? null : Number(answerKey),
        rubric: rubric.split('\n').map((line) => line.trim()).filter(Boolean).map((criterion) => ({ criterion })),
        irt_difficulty: difficulty === '' ? null : Number(difficulty),
        irt_discrimination: discrimination === '' ? null : Number(discrimination),
      }
      return api(editing ? `/questions/${editing.id}` : `/courses/${courseId}/questions`, {
        method: editing ? 'PATCH' : 'POST', body: jsonBody(body),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['questions', courseId] })
      setOpen(false)
      setEditing(null)
      setPrompt('')
      setUnitId('')
      setSkillId('')
      setQuestionType('open')
      setOptions('')
      setAnswerKey('')
      setRubric('')
      setDifficulty('')
      setDiscrimination('')
      toast(editing ? 'Borrador actualizado.' : 'Pregunta guardada como borrador.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const publish = useMutation({
    mutationFn: (id: string) => api(`/questions/${id}/publish`, { method: 'PATCH' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['questions', courseId] }); toast('Pregunta publicada.') },
    onError: (error) => toast(error.message, 'error'),
  })

  function newQuestion() {
    setEditing(null)
    setPrompt('')
    setUnitId('')
    setSkillId('')
    setQuestionType('open')
    setOptions('')
    setAnswerKey('')
    setRubric('')
    setDifficulty('')
    setDiscrimination('')
    setOpen(true)
  }

  function editQuestion(question: Question) {
    setEditing(question)
    setPrompt(question.prompt)
    setUnitId(question.unit_id || '')
    setSkillId(question.skill_id || '')
    setQuestionType(question.question_type)
    setOptions(question.options?.join('\n') || '')
    setAnswerKey(question.answer_key === null || question.answer_key === undefined ? '' : String(question.answer_key))
    setRubric(question.rubric.map((item) => item.criterion || '').filter(Boolean).join('\n'))
    setDifficulty(question.irt_difficulty == null ? '' : String(question.irt_difficulty))
    setDiscrimination(question.irt_discrimination == null ? '' : String(question.irt_discrimination))
    setOpen(true)
  }

  async function deleteQuestion(question: Question) {
    if (!window.confirm('¿Eliminar este borrador? Esta acción no se puede deshacer.')) return
    try {
      await api(`/questions/${question.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['questions', courseId] })
      toast('Borrador eliminado.')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo eliminar.', 'error') }
  }

  if (questions.isLoading || units.isLoading) return <LoadingState />
  if (questions.isError || units.isError) return <ErrorState message="No pudimos cargar el banco de preguntas." retry={() => { void questions.refetch(); void units.refetch() }} />
  const items = questions.data!
  const availableSkills = units.data!.filter((unit) => !unitId || unit.id === unitId)
    .flatMap((unit) => unit.skills.map((skill) => ({ ...skill, unitTitle: unit.title })))

  return <>
    <PageHeader title="Banco de preguntas" description="Crea preguntas de práctica y revisa los borradores generados desde tus materiales." actions={<Button onClick={newQuestion}><Plus size={16} />Nueva pregunta</Button>} />
    {!items.length ? <Card><EmptyState icon={FileQuestion} title="El banco está vacío" description="Escribe una pregunta o genera un borrador a partir de un material ya procesado." action={<Button onClick={newQuestion}><Plus size={15} />Crear pregunta</Button>} /></Card> : <Card>
      <div className="card-heading card-heading-row"><div><h2>Preguntas del curso</h2><p className="muted-text text-small">{items.length} pregunta{items.length === 1 ? '' : 's'} · cada borrador requiere revisión docente.</p></div></div>
      <div className="question-list">{items.map((question) => {
        const criteriaCount = question.rubric.filter((item) => item.criterion?.trim()).length
        const unitTitle = units.data!.find((unit) => unit.id === question.unit_id)?.title
        return <article className="question-row" key={question.id}>
          <span className="question-icon"><FileQuestion size={17} /></span>
          <div className="question-copy"><p>{question.prompt}</p><small>{question.question_type === 'open' ? 'Respuesta abierta' : question.question_type === 'numeric' ? 'Respuesta numérica' : 'Opción múltiple'}{unitTitle ? ` · ${unitTitle}` : ''} · {criteriaCount} criterio{criteriaCount === 1 ? '' : 's'}{question.irt_difficulty != null && ` · dificultad IRT ${question.irt_difficulty.toFixed(1)}`}</small></div>
          <Badge tone={question.status === 'published' ? 'success' : 'warning'}>{question.status === 'published' ? 'Publicada' : 'Borrador'}</Badge>
          {question.status === 'draft' && <div className="question-actions">
            <Button size="small" variant="outline" aria-label="Editar borrador" onClick={() => editQuestion(question)}><Pencil size={14} />Editar</Button>
            <Button size="small" variant="outline" disabled={publish.isPending || criteriaCount === 0} onClick={() => publish.mutate(question.id)}><Check size={14} />Aprobar</Button>
            <Button size="small" variant="ghost" aria-label="Eliminar borrador" onClick={() => void deleteQuestion(question)}><Trash2 size={14} /></Button>
          </div>}
        </article>
      })}</div>
    </Card>}
    <Modal open={open} onClose={() => { setOpen(false); setEditing(null) }} title={editing ? 'Editar borrador' : 'Nueva pregunta'} description="Las preguntas se guardan como borradores; agrega criterios para aprobarlas." onSubmit={(event) => { event.preventDefault(); save.mutate() }} submitLabel={editing ? 'Guardar cambios' : 'Guardar borrador'} busy={save.isPending}>
      <Field label="Enunciado" required><TextArea autoFocus rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} minLength={5} maxLength={10000} required placeholder="Escribe una pregunta que invite a explicar el razonamiento…" /></Field>
      <Field label="Unidad"><Select value={unitId} onChange={(event) => { setUnitId(event.target.value); setSkillId('') }}><option value="">Sin unidad vinculada</option>{units.data!.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</Select></Field>
      <Field label="Habilidad evaluada"><Select value={skillId} onChange={(event) => setSkillId(event.target.value)}><option value="">Sin habilidad vinculada</option>{availableSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.unitTitle} · {skill.title}</option>)}</Select></Field>
      <Field label="Tipo de pregunta"><Select value={questionType} onChange={(event) => { setQuestionType(event.target.value as Question['question_type']); setAnswerKey('') }}><option value="open">Respuesta abierta</option><option value="multiple_choice">Opción múltiple</option><option value="numeric">Respuesta numérica</option></Select></Field>
      {questionType === 'multiple_choice' && <Field label="Opciones" hint="Escribe una opción por línea; agrega al menos dos." required><TextArea rows={4} value={options} onChange={(event) => setOptions(event.target.value)} placeholder={'Opción 1\nOpción 2\nOpción 3'} /></Field>}
      {questionType !== 'open' && <Field label={questionType === 'multiple_choice' ? 'Índice de la opción correcta (empieza en 0)' : 'Respuesta numérica correcta'} required><TextInput type="number" step={questionType === 'numeric' ? 'any' : '1'} min="0" value={answerKey} onChange={(event) => setAnswerKey(event.target.value)} required /></Field>}
      <Field label="Criterios de revisión" hint="Escribe un criterio por línea. Puedes revisarlos antes de publicar la pregunta."><TextArea rows={3} value={rubric} onChange={(event) => setRubric(event.target.value)} maxLength={5000} placeholder={'Explica el procedimiento\nJustifica la respuesta'} /></Field>
      <div className="form-grid"><Field label="Dificultad IRT" hint="Opcional · de −4 (fácil) a 4 (difícil)."><TextInput type="number" min="-4" max="4" step="0.1" value={difficulty} onChange={(event) => setDifficulty(event.target.value)} placeholder="Sin estimar" /></Field><Field label="Discriminación IRT" hint="Opcional · de 0.1 a 4."><TextInput type="number" min="0.1" max="4" step="0.1" value={discrimination} onChange={(event) => setDiscrimination(event.target.value)} placeholder="1.0 por defecto" /></Field></div>
      <div className="inline-alert alert-info form-note"><Sparkles size={16} /><span>Los borradores generados por IA usan material del curso como contexto. Revísalos y completa los criterios antes de aprobar.</span></div>
    </Modal>
  </>
}
