import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { Assessment, Configuration, CurriculumUnit, GeneratedPractice, Material, Question } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, Select, TextArea, TextInput, useToast } from '../components/ui'

export function AssessmentsPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Assessment | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [kind, setKind] = useState<Assessment['kind']>('practice')
  const [questionToAdd, setQuestionToAdd] = useState<Record<string, string>>({})
  const [generateOpen, setGenerateOpen] = useState(false)
  const [materialId, setMaterialId] = useState('')
  const [questionCount, setQuestionCount] = useState(6)
  const [includeMultipleChoice, setIncludeMultipleChoice] = useState(true)
  const [includeOpen, setIncludeOpen] = useState(true)
  const [focus, setFocus] = useState('')
  const [unitId, setUnitId] = useState('')
  const [skillId, setSkillId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [generationKind, setGenerationKind] = useState<Assessment['kind']>('quiz')
  const [includeNumeric, setIncludeNumeric] = useState(false)
  const [activityFilter, setActivityFilter] = useState<'all' | Assessment['kind']>('all')
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null)
  const [questionPrompt, setQuestionPrompt] = useState('')
  const [questionUnitId, setQuestionUnitId] = useState('')
  const [questionSkillId, setQuestionSkillId] = useState('')
  const [questionTopicId, setQuestionTopicId] = useState('')
  const [questionFormType, setQuestionFormType] = useState<Question['question_type']>('open')
  const [questionOptions, setQuestionOptions] = useState('')
  const [questionAnswerKey, setQuestionAnswerKey] = useState('')
  const [questionRubric, setQuestionRubric] = useState('')
  const assessments = useQuery({ queryKey: ['assessments', courseId], queryFn: () => api<Assessment[]>(`/courses/${courseId}/assessments`) })
  const questions = useQuery({ queryKey: ['questions', courseId], queryFn: () => api<Question[]>(`/courses/${courseId}/questions`) })
  const materials = useQuery({ queryKey: ['materials', courseId], queryFn: () => api<{ items: Material[] }>(`/courses/${courseId}/materials?limit=100`) })
  const configuration = useQuery({ queryKey: ['configuration'], queryFn: () => api<Configuration>('/configuration') })
  const curriculum = useQuery({ queryKey: ['curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/courses/${courseId}/curriculum`) })
  const readyMaterials = materials.data?.items.filter((material) => (
    material.status === 'ready' && material.kind === 'file' && material.chunk_count > 0
  )) ?? []
  const selectedTypes = [includeMultipleChoice ? 'multiple_choice' : '', includeOpen ? 'open' : '', includeNumeric ? 'numeric' : ''].filter(Boolean)
  const validQuestionCount = Number.isInteger(questionCount) && questionCount >= 1 && questionCount <= 12
  const create = useMutation({
    mutationFn: () => api<Assessment>(editing ? `/assessments/${editing.id}` : `/courses/${courseId}/assessments`, {
      method: editing ? 'PATCH' : 'POST', body: jsonBody(editing ? { title, description, instructions, kind } : { title, description, kind }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assessments', courseId] })
      setOpen(false)
      setEditing(null)
      setTitle('')
      setDescription('')
      toast(editing ? 'Actividad actualizada.' : 'Actividad creada como borrador.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const generatePractice = useMutation({
    mutationFn: () => api<GeneratedPractice>(`/courses/${courseId}/assessments/generate-practice`, {
      method: 'POST',
      body: jsonBody({
        material_id: materialId,
        unit_id: unitId || null,
        skill_id: skillId,
        topic_id: topicId,
        kind: generationKind,
        question_count: questionCount,
        question_types: selectedTypes,
        focus: focus.trim(),
      }),
    }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assessments', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['questions', courseId] }),
      ])
      setGenerateOpen(false)
      setFocus('')
      toast(`Se crearon ${result.questions.length} preguntas en borrador para ${result.title}.`)
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
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['assessments', courseId] }); toast('Actividad publicada para estudiantes.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api<{ status: 'deleted' | 'archived' }>(`/assessments/${id}`, { method: 'DELETE' }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['assessments', courseId] })
      toast(result.status === 'archived' ? 'Actividad archivada; se conservaron respuestas e intentos.' : 'Actividad eliminada.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const saveQuestion = useMutation({
    mutationFn: () => {
      if (!editingQuestion) throw new Error('No hay una pregunta seleccionada.')
      return api(`/questions/${editingQuestion.id}`, { method: 'PATCH', body: jsonBody({
        prompt: questionPrompt.trim(), unit_id: questionUnitId || null,
        skill_id: questionSkillId || null, topic_id: questionTopicId || null,
        question_type: questionFormType,
        options: questionFormType === 'multiple_choice' ? questionOptions.split('\n').map((item) => item.trim()).filter(Boolean) : null,
        answer_key: questionFormType === 'open' ? null : questionFormType === 'numeric' ? Number(questionAnswerKey) : Number.parseInt(questionAnswerKey, 10),
        rubric: questionRubric.split('\n').map((item) => item.trim()).filter(Boolean).map((criterion) => ({ criterion })),
        irt_difficulty: editingQuestion.irt_difficulty ?? null,
        irt_discrimination: editingQuestion.irt_discrimination ?? null,
      }) })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assessments', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['questions', courseId] }),
      ])
      setEditingQuestion(null)
      toast('Pregunta de la actividad actualizada.')
    },
    onError: (error) => toast(error.message, 'error'),
  })
  if (assessments.isLoading || questions.isLoading || curriculum.isLoading) return <LoadingState />
  if (assessments.isError || questions.isError || curriculum.isError) return <ErrorState message="No pudimos cargar las prácticas y evaluaciones." retry={() => { void assessments.refetch(); void questions.refetch(); void curriculum.refetch() }} />
  const items = assessments.data!
  const filteredItems = items.filter((item) => activityFilter === 'all' || item.kind === activityFilter)
  const publishedQuestions = questions.data!.filter((question) => question.status === 'published')
  const units = curriculum.data!
  const availableSkills = units.filter((unit) => !unitId || unit.id === unitId).flatMap((unit) => unit.skills.map((skill) => ({ ...skill, unitId: unit.id, unitTitle: unit.title }))).filter((skill) => skill.status === 'published')
  const availableTopics = units.filter((unit) => !unitId || unit.id === unitId).flatMap((unit) => unit.topics.map((topic) => ({ ...topic, unitId: unit.id, unitTitle: unit.title }))).filter((topic) => topic.status === 'published')
  const editSkills = units.filter((unit) => !questionUnitId || unit.id === questionUnitId).flatMap((unit) => unit.skills.map((skill) => ({ ...skill, unitTitle: unit.title }))).filter((skill) => skill.status === 'published')
  const editTopics = units.filter((unit) => !questionUnitId || unit.id === questionUnitId).flatMap((unit) => unit.topics.map((topic) => ({ ...topic, unitTitle: unit.title }))).filter((topic) => topic.status === 'published')
  const kinds: { value: Assessment['kind']; label: string }[] = [
    { value: 'diagnostic', label: 'Diagnóstico' },
    { value: 'practice', label: 'Práctica' },
    { value: 'quiz', label: 'Evaluación' },
    { value: 'transfer', label: 'Transferencia' },
  ]

  function editAssessment(assessment: Assessment) {
    setEditing(assessment)
    setTitle(assessment.title)
    setDescription(assessment.description)
    setInstructions(assessment.settings?.instructions || '')
    setKind(assessment.kind)
    setOpen(true)
  }

  function openGeneration() {
    const selectedMaterial = readyMaterials.find((material) => material.id === materialId) || readyMaterials[0]
    if (selectedMaterial) {
      setMaterialId(selectedMaterial.id)
      const unit = units.find((item) => item.id === (unitId || selectedMaterial.unit_id)) || units[0]
      if (unit) {
        setUnitId(unit.id)
        setSkillId(unit.skills.find((item) => item.status === 'published')?.id || '')
        setTopicId(unit.topics.find((item) => item.status === 'published')?.id || '')
      }
    }
    setGenerateOpen(true)
  }

  function editGeneratedQuestion(question: Question) {
    setEditingQuestion(question)
    setQuestionPrompt(question.prompt)
    setQuestionUnitId(question.unit_id || '')
    setQuestionSkillId(question.skill_id || '')
    setQuestionTopicId(question.topic_id || '')
    setQuestionFormType(question.question_type)
    setQuestionOptions(question.options?.join('\n') || '')
    setQuestionAnswerKey(question.answer_key == null ? '' : String(question.answer_key))
    setQuestionRubric(question.rubric.map((item) => item.criterion || '').filter(Boolean).join('\n'))
  }

  return <>
    <PageHeader title="Prácticas y evaluaciones" description="Organiza actividades formativas, evaluaciones y problemas de transferencia por unidad." help="Las prácticas desarrollan habilidades; las evaluaciones comprueban el aprendizaje; transferencia plantea casos nuevos. Puedes agregar preguntas publicadas del banco o generar preguntas privadas para esta actividad. Cada pregunta debe vincularse a un tema y habilidad. Las respuestas se conservan al archivar actividades que ya tuvieron intentos." actions={<><Button variant="outline" onClick={openGeneration}><Sparkles size={16} />Generar evaluación con IA</Button><Button onClick={() => { setEditing(null); setTitle(''); setDescription(''); setInstructions(''); setKind('practice'); setOpen(true) }}><Plus size={16} />Nueva actividad</Button></>} />
    {!items.length ? <Card><EmptyState icon={ClipboardCheck} title="Aún no hay actividades" description="Crea una práctica o evaluación con preguntas publicadas del banco, o genera preguntas privadas directamente para una actividad." action={<Button onClick={openGeneration}><Sparkles size={15} />Generar evaluación</Button>} /></Card> : <>
    <nav className="assessment-filters" aria-label="Filtrar actividades">{[{ value: 'all', label: 'Todas' }, ...kinds].map((filter) => <button key={filter.value} type="button" className={activityFilter === filter.value ? 'is-active' : ''} aria-pressed={activityFilter === filter.value} onClick={() => setActivityFilter(filter.value as typeof activityFilter)}>{filter.label}</button>)}</nav>
    {!filteredItems.length ? <Card><EmptyState icon={ClipboardCheck} title="No hay actividades en esta categoría" description="Cambia el filtro o crea una actividad nueva." /></Card> : <div className="assessment-list">{filteredItems.map((assessment) => {
      const attached = assessment.questions || []
      const hasCurriculumLinks = attached.length > 0 && attached.every((question) => {
        const unit = units.find((item) => item.id === question.unit_id)
        return Boolean(question.skill_id && question.topic_id
          && unit?.skills.some((skill) => skill.id === question.skill_id && skill.status === 'published')
          && unit?.topics.some((topic) => topic.id === question.topic_id && topic.status === 'published'))
      })
      const canPublish = hasCurriculumLinks && attached.every((question) =>
        (question.status === 'published' || (!question.bank_visible && question.status === 'draft'))
        && (question.question_type !== 'open' || question.rubric.length > 0))
      const practice = assessment.settings?.practice ? assessment.settings : null
      return <Card key={assessment.id}>
        <div className="assessment-card">
          <span className="question-icon"><ClipboardCheck size={19} /></span>
          <div className="assessment-copy">
            <div className="assessment-title-row">
              <strong>{assessment.title}</strong>
              <Badge tone={assessment.status === 'published' ? 'success' : assessment.status === 'archived' ? 'neutral' : 'warning'}>{assessment.status === 'published' ? 'Publicada' : assessment.status === 'archived' ? 'Archivada' : 'Borrador'}</Badge>
              {practice?.generated && <Badge tone="info">{practice.learning_technique === 'spaced_repetition' ? 'Repaso espaciado IA' : practice.learning_technique === 'transfer' ? 'Transferencia IA' : practice.learning_technique === 'assessment' ? 'Evaluación IA' : 'Práctica IA'}</Badge>}
            </div>
            <p>{assessment.description || 'Sin instrucciones adicionales.'}</p>
            <small>
              {kinds.find((item) => item.value === assessment.kind)?.label} · {attached.length} preguntas
              {practice?.theme ? ` · ${practice.theme}` : ''}
              {practice?.question_count ? ` · ${practice.question_count} generadas` : ''}
            </small>
            {practice?.instructions && <p className="assessment-instructions">{practice.instructions}</p>}
            {!!attached.length && <ul className="assessment-questions">{attached.map((question) => {
              const topic = units.flatMap((unit) => unit.topics).find((item) => item.id === question.topic_id)
              const skill = units.flatMap((unit) => unit.skills).find((item) => item.id === question.skill_id)
              return <li key={question.id}><span><strong>{question.prompt}</strong><small className="muted-text">{topic?.title || 'Sin tema'} · {skill?.title || 'Sin habilidad'} · {question.bank_visible ? 'Banco' : 'Solo esta actividad'}</small></span>{assessment.status === 'draft' && <span className="assessment-question-actions">{!question.bank_visible && question.status === 'draft' && <Button size="small" variant="ghost" aria-label="Editar pregunta de la actividad" onClick={() => editGeneratedQuestion(question)}><Pencil size={14} /></Button>}<button aria-label="Retirar pregunta" onClick={() => removeQuestion.mutate({ assessmentId: assessment.id, questionId: question.id })}><Trash2 size={14} /></button></span>}</li>
            })}</ul>}
            {assessment.status === 'draft' && <div className="assessment-add-question"><Select aria-label="Pregunta para agregar" value={questionToAdd[assessment.id] || ''} onChange={(event) => setQuestionToAdd({ ...questionToAdd, [assessment.id]: event.target.value })}><option value="">Agregar del banco de preguntas</option>{publishedQuestions.filter((question) => !assessment.question_ids.includes(question.id)).map((question) => <option value={question.id} key={question.id}>{question.prompt}</option>)}</Select><Button size="small" variant="outline" disabled={!questionToAdd[assessment.id] || addQuestion.isPending} onClick={() => { const questionId = questionToAdd[assessment.id]; addQuestion.mutate({ assessmentId: assessment.id, questionId, position: assessment.question_ids.length }); setQuestionToAdd({ ...questionToAdd, [assessment.id]: '' }) }}><Plus size={14} />Agregar</Button></div>}
            {assessment.status === 'draft' && attached.length > 0 && !canPublish && <div className="inline-alert alert-info form-note"><ClipboardCheck size={16} /><span>Completa los vínculos a tema y habilidad y aprueba las preguntas del banco antes de publicar. Las preguntas privadas se publican junto con esta actividad.</span></div>}
          </div>
          {assessment.status !== 'archived' && <div className="question-actions">{(assessment.status === 'draft' || (assessment.status === 'published' && !assessment.attempt_count)) && <Button variant="outline" size="small" onClick={() => editAssessment(assessment)}><Pencil size={14} />Editar</Button>}{assessment.status === 'draft' && <Button variant="outline" size="small" disabled={!canPublish || publish.isPending} onClick={() => publish.mutate(assessment.id)}><Check size={14} />Publicar</Button>}<Button variant="ghost" size="small" aria-label="Eliminar o archivar actividad" disabled={remove.isPending} onClick={() => { if (window.confirm('¿Quitar esta actividad? Si tiene intentos, se archivará y se conservarán las respuestas.')) remove.mutate(assessment.id) }}><Trash2 size={14} />Quitar</Button></div>}
        </div>
      </Card>
    })}</div>}
    </>}
    <Modal open={open} onClose={() => { setOpen(false); setEditing(null) }} title={editing ? 'Editar actividad' : 'Nueva actividad'} description="La actividad queda como borrador hasta que tenga preguntas y la publiques." onSubmit={(event) => { event.preventDefault(); create.mutate() }} submitLabel={editing ? 'Guardar cambios' : 'Crear borrador'} busy={create.isPending}>
      <Field label="Título" required><TextInput autoFocus value={title} onChange={(event) => setTitle(event.target.value.toUpperCase())} required minLength={2} maxLength={200} placeholder="Ej. Diagnóstico de funciones" /></Field>
      <Field label="Tipo" hint="Diagnóstico y práctica sirven para orientar el estudio; evaluación comprueba el aprendizaje; transferencia aplica lo aprendido a casos nuevos."><Select value={kind} onChange={(event) => setKind(event.target.value as Assessment['kind'])}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
      <Field label="Instrucciones"><TextArea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} placeholder="Indica cómo prepararse y qué se espera en las respuestas." /></Field>
      {editing && <Field label="Orientaciones de la actividad" hint="Revisa o edita las indicaciones generadas por la IA."><TextArea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={5000} /></Field>}
    </Modal>
    <Modal open={generateOpen} onClose={() => setGenerateOpen(false)} title="Generar evaluación con IA" description="Genera preguntas privadas para esta actividad; no es necesario publicarlas en el banco." onSubmit={(event) => { event.preventDefault(); generatePractice.mutate() }} submitLabel="Generar preguntas" busy={generatePractice.isPending} submitDisabled={!materialId || !unitId || !skillId || !topicId || !selectedTypes.length || !validQuestionCount || generatePractice.isPending} wide>
      {configuration.data && !configuration.data.ai_configured && <div className="inline-alert alert-info form-note"><Sparkles size={16} /><span>Configura OpenRouter para generar preguntas.</span></div>}
      {!readyMaterials.length && <div className="inline-alert alert-info form-note"><Sparkles size={16} /><span>No hay materiales procesados con texto. Sube y procesa un archivo antes de generar.</span></div>}
      <Field label="Material de origen" hint="La IA usará exclusivamente la descripción del curso y el texto extraído de este material." required>
        <Select value={materialId} onChange={(event) => { const material = readyMaterials.find((item) => item.id === event.target.value); setMaterialId(event.target.value); if (material?.unit_id && units.some((unit) => unit.id === material.unit_id)) { setUnitId(material.unit_id); const unit = units.find((item) => item.id === material.unit_id)!; setSkillId(unit.skills.find((item) => item.status === 'published')?.id || ''); setTopicId(unit.topics.find((item) => item.status === 'published')?.id || '') } }} required>
          <option value="">Selecciona un material procesado</option>
          {readyMaterials.filter((material) => !unitId || !material.unit_id || material.unit_id === unitId).map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}
        </Select>
      </Field>
      <Field label="Tipo de actividad" required><Select value={generationKind} onChange={(event) => setGenerationKind(event.target.value as Assessment['kind'])}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
      <Field label="Unidad" required><Select value={unitId} onChange={(event) => { const unit = units.find((item) => item.id === event.target.value); setUnitId(event.target.value); setSkillId(unit?.skills.find((item) => item.status === 'published')?.id || ''); setTopicId(unit?.topics.find((item) => item.status === 'published')?.id || ''); const material = readyMaterials.find((item) => item.id === materialId && (!item.unit_id || item.unit_id === event.target.value)) || readyMaterials.find((item) => !item.unit_id || item.unit_id === event.target.value); setMaterialId(material?.id || '') }} required><option value="">Selecciona una unidad</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</Select></Field>
      <Field label="Habilidad evaluada" required><Select value={skillId} onChange={(event) => setSkillId(event.target.value)} required><option value="">Selecciona una habilidad publicada</option>{availableSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.unitTitle} · {skill.title}</option>)}</Select></Field>
      <Field label="Tema relacionado" required><Select value={topicId} onChange={(event) => setTopicId(event.target.value)} required><option value="">Selecciona un tema publicado</option>{availableTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.unitTitle} · {topic.title}</option>)}</Select></Field>
      <Field label="Cantidad de preguntas" required><TextInput type="number" min={1} max={12} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} required /></Field>
      <div className="form-field">
        <span className="field-label">Tipos de pregunta <span aria-hidden="true">*</span></span>
        <div className="choice-row">
          <label className="choice-option"><input type="checkbox" checked={includeMultipleChoice} onChange={(event) => setIncludeMultipleChoice(event.target.checked)} />Opción múltiple</label>
          <label className="choice-option"><input type="checkbox" checked={includeOpen} onChange={(event) => setIncludeOpen(event.target.checked)} />Respuesta abierta</label>
          <label className="choice-option"><input type="checkbox" checked={includeNumeric} onChange={(event) => setIncludeNumeric(event.target.checked)} />Respuesta numérica</label>
        </div>
        <p className="field-hint">Puedes combinar opción múltiple y respuesta abierta con rúbrica.</p>
      </div>
      <Field label="Enfoque adicional" hint="Opcional. Indica un aspecto del material que quieres priorizar."><TextArea rows={3} value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={500} placeholder="Ej. prioriza la identificación de signos de alarma" /></Field>
      <div className="inline-alert alert-info form-note"><Sparkles size={16} /><span>Las preguntas citan el material y quedan vinculadas con el tema y habilidad seleccionados. Revisa su contenido y publícalas junto con esta evaluación; no aparecerán en el banco de preguntas.</span></div>
    </Modal>
    <Modal open={!!editingQuestion} onClose={() => setEditingQuestion(null)} title="Editar pregunta de la actividad" description="Los cambios se guardan en el borrador de esta pregunta y conservan su vínculo con el tema y la habilidad." onSubmit={(event) => { event.preventDefault(); saveQuestion.mutate() }} submitLabel="Guardar pregunta" busy={saveQuestion.isPending}>
      <Field label="Enunciado" required><TextArea rows={5} value={questionPrompt} onChange={(event) => setQuestionPrompt(event.target.value)} required minLength={5} maxLength={10000} /></Field>
      <Field label="Unidad"><Select value={questionUnitId} onChange={(event) => { const unit = units.find((item) => item.id === event.target.value); setQuestionUnitId(event.target.value); setQuestionSkillId(unit?.skills.find((item) => item.status === 'published')?.id || ''); setQuestionTopicId(unit?.topics.find((item) => item.status === 'published')?.id || '') }}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</Select></Field>
      <Field label="Habilidad evaluada" required><Select value={questionSkillId} onChange={(event) => setQuestionSkillId(event.target.value)} required><option value="">Selecciona una habilidad</option>{editSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.unitTitle} · {skill.title}</option>)}</Select></Field>
      <Field label="Tema relacionado" required><Select value={questionTopicId} onChange={(event) => setQuestionTopicId(event.target.value)} required><option value="">Selecciona un tema</option>{editTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.unitTitle} · {topic.title}</option>)}</Select></Field>
      <Field label="Formato de respuesta"><Select value={questionFormType} onChange={(event) => { setQuestionFormType(event.target.value as Question['question_type']); setQuestionAnswerKey('') }}><option value="open">Respuesta abierta</option><option value="multiple_choice">Opción múltiple</option><option value="numeric">Respuesta numérica</option></Select></Field>
      {questionFormType === 'multiple_choice' && <Field label="Opciones" hint="Una por línea. La clave usa índice desde 0." required><TextArea rows={4} value={questionOptions} onChange={(event) => setQuestionOptions(event.target.value)} required /></Field>}
      {questionFormType !== 'open' && <Field label={questionFormType === 'numeric' ? 'Respuesta numérica correcta' : 'Índice de respuesta correcta'} required><TextInput type="number" step={questionFormType === 'numeric' ? 'any' : '1'} min="0" value={questionAnswerKey} onChange={(event) => setQuestionAnswerKey(event.target.value)} required /></Field>}
      <Field label="Criterios de revisión" hint="Un criterio por línea para respuestas abiertas."><TextArea rows={3} value={questionRubric} onChange={(event) => setQuestionRubric(event.target.value)} /></Field>
    </Modal>
  </>
}
