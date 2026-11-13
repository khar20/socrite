import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Check, ClipboardCheck, FileText, Layers3, LoaderCircle, MessageCircle, Repeat2, Send, Target, Users } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { Course, CurriculumUnit, PageResult } from '../types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader, PaginationControls, Select, Stat, TextArea, TextInput, useToast } from '../components/ui'

type StudentMaterial = {
  id: string; name: string; kind: 'file' | 'link'; content_type: string; size_bytes: number
  folder_id: string | null; unit_id: string | null; chunk_count: number
  status: 'queued' | 'processing' | 'ready' | 'failed'
}
type StudentCourse = Pick<Course, 'id' | 'title' | 'code' | 'description' | 'status' | 'credits' |
  'academic_period' | 'created_at' | 'unit_count' | 'material_count'>
type StudentCoursesPage = PageResult<StudentCourse> & {
  summary: { course_count: number; active_course_count: number; material_count: number }
}
type Assessment = { id: string; title: string; description: string; kind: string; question_count: number }
type Recommendation = {
  skill: { id: string; title: string; unit: string; probability: number | null; observations: number; due_at: string | null } | null
  activity: { id: string; title: string; kind: string; question_count: number; predicted_success: number } | null
  reason: string
}
type AttemptQuestion = {
  id: string; prompt: string; question_type: 'open' | 'multiple_choice' | 'numeric'
  options: string[] | null; points: number; response: unknown; is_correct: boolean | null; pending_review: boolean
}
type AssessmentAttempt = {
  id: string; assessment_id: string; status: string; attempt_number: number; questions: AttemptQuestion[]
}
type ProgressData = {
  mastery: { skill_id: string; skill: string; unit: string; probability: number; observations: number; last_evidence_at: string | null }[]
  reviews: { skill_id: string; due_at: string; interval_days: number; repetitions: number }[]
  retention: { due_count: number; review_events: number; on_time_reviews: number; average_self_rating: number | null
    history: { skill_id: string; skill: string; unit: string; rating: number; due_at: string; completed_at: string }[] }
  transfer: { attempts: number; average_score_percent: number | null
    history: { assessment_id: string; title: string; score: number | null; possible_score: number | null; submitted_at: string | null }[] }
  evidence_history: { skill_id: string; skill: string; unit: string; evidence_type: string; is_correct: boolean
    is_transfer: boolean; confidence: number | null; probability_before: number; probability_after: number; created_at: string }[]
}
type TutorSessionInfo = { id: string; skill_id: string | null; status: string; started_at: string }
type TutorSessions = { ai_configured: boolean; sessions: TutorSessionInfo[] }
type TutorMessageInfo = {
  id: string; role: 'user' | 'assistant' | 'system'; content: string
  citations: { material_id: string; material_name: string; page_number: number | null; chunk_index: number }[]
  created_at: string
}
type TutorMessageResponse = { user_message: TutorMessageInfo; assistant_message: TutorMessageInfo }
type TutorMessageSubmission = { sessionId: string; content: string; optimisticId: string }

export function StudentDashboardPage() {
  const [offset, setOffset] = useState(0)
  const limit = 25
  const courses = useQuery({
    queryKey: ['student-courses', offset],
    queryFn: () => api<StudentCoursesPage>(`/student/courses?limit=${limit}&offset=${offset}`),
  })
  if (courses.isLoading) return <LoadingState />
  if (courses.isError) return <ErrorState message="No pudimos cargar tus cursos." retry={() => void courses.refetch()} />
  const list = courses.data!.items
  return <>
    <PageHeader title="Mi aprendizaje" description="Retoma tus cursos, revisa tus actividades y continúa a tu ritmo." />
    <div className="stats-grid stats-grid-compact">
      <Stat icon={BookOpen} label="Mis cursos" value={courses.data!.summary.course_count} detail="cursos a los que tienes acceso" />
      <Stat icon={Layers3} label="Materiales disponibles" value={courses.data!.summary.material_count} detail="recursos compartidos por tus docentes" />
      <Stat icon={ClipboardCheck} label="Cursos activos" value={courses.data!.summary.active_course_count} detail="listos para continuar" />
    </div>
    <Card className="student-courses-card"><div className="card-heading"><h2>Tus cursos</h2><p className="muted-text text-small">Elige un curso para continuar aprendiendo.</p></div>
      <div className="card-content student-course-list">{courses.data!.total ? list.map((course) => <Link className="student-course-row" to={`/student/courses/${course.id}`} key={course.id}>
        <span className="course-row-icon"><BookOpen size={19} /></span><span className="course-row-copy"><strong>{course.title}</strong><small>{course.code || 'Sin código'} · {course.unit_count} unidades · {course.material_count} materiales</small></span><Badge tone={course.status === 'active' ? 'success' : 'neutral'}>{course.status === 'active' ? 'Activo' : 'En preparación'}</Badge><ArrowRight size={16} />
      </Link>) : <EmptyState icon={BookOpen} title="Aún no tienes cursos" description="Pide a tu docente un enlace de invitación para unirte a un curso." />}</div>
      <div className="card-content"><PaginationControls total={courses.data!.total} limit={limit} offset={offset} onChange={setOffset} /></div>
    </Card>
  </>
}

export function StudentJoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const join = useMutation({
    mutationFn: () => api<{ course_id: string }>(`/student/invitations/${token}/accept`, { method: 'POST' }),
    onSuccess: (result) => navigate(`/student/courses/${result.course_id}`, { replace: true }),
    onError: (reason) => setError(reason.message),
  })
  return <main className="access-denied"><div className="empty-icon"><Users size={22} /></div><h1>Invitación a un curso</h1><p>Confirma tu cuenta para unirte al curso. El enlace solo puede usarse con el correo invitado.</p>{error && <div className="inline-alert alert-error" role="alert">{error}</div>}<div className="access-actions"><Button disabled={join.isPending || !token} onClick={() => join.mutate()}>{join.isPending ? 'Uniéndote…' : 'Unirme al curso'}</Button><span className="muted-text text-small">¿No tienes cuenta? <Link className="text-link" to="/login">Inicia sesión o regístrate</Link></span></div></main>
}

export function StudentCoursePage() {
  const { courseId = '' } = useParams()
  const navigate = useNavigate()
  const course = useQuery({ queryKey: ['student-course', courseId], queryFn: () => api<StudentCourse>(`/student/courses/${courseId}`) })
  const curriculum = useQuery({ queryKey: ['student-curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/student/courses/${courseId}/curriculum`) })
  const assessments = useQuery({ queryKey: ['student-assessments', courseId], queryFn: () => api<Assessment[]>(`/student/courses/${courseId}/assessments`) })
  const recommendation = useQuery({
    queryKey: ['student-next-activity', courseId],
    queryFn: () => api<Recommendation>(`/student/courses/${courseId}/next-activity`),
  })
  const startRecommended = useMutation({
    mutationFn: (assessmentId: string) => api<AssessmentAttempt>(`/student/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    onSuccess: (attempt) => navigate(`/student/attempts/${attempt.id}`),
  })
  if (course.isLoading || curriculum.isLoading || assessments.isLoading) return <LoadingState />
  if (course.isError || curriculum.isError || assessments.isError) return <ErrorState message="No pudimos cargar el curso." retry={() => { void course.refetch(); void curriculum.refetch(); void assessments.refetch() }} />
  const item = course.data!
  return <>
    <PageHeader title={item.title} description={`${item.code || 'Curso'}${item.academic_period ? ` · ${item.academic_period}` : ''}`} />
    {recommendation.data && <Card className="next-activity-card"><div className="next-activity-content"><div className="next-activity-copy"><Badge tone={recommendation.data.activity?.kind === 'diagnostic' ? 'info' : 'neutral'}>{recommendation.data.activity?.kind === 'diagnostic' ? 'Conocimientos previos' : recommendation.data.activity?.kind === 'transfer' ? 'Aplicación nueva' : 'Siguiente paso'}</Badge><h2>{recommendation.data.activity?.title || 'Una habilidad para trabajar'}</h2>{recommendation.data.skill && <p className="next-activity-skill">{recommendation.data.skill.unit} · {recommendation.data.skill.title}{recommendation.data.skill.probability !== null && ` · dominio estimado ${Math.round(recommendation.data.skill.probability * 100)}%`}</p>}<p>{recommendation.data.reason}</p>{recommendation.data.activity && <small>{recommendation.data.activity.question_count} preguntas · dificultad ajustada a tu nivel (IRT {Math.round(recommendation.data.activity.predicted_success * 100)}% de éxito esperado)</small>}{recommendation.data.skill && <small>{recommendation.data.skill.observations} evidencias registradas</small>}</div>{recommendation.data.activity ? <Button className="next-activity-action" disabled={startRecommended.isPending} onClick={() => startRecommended.mutate(recommendation.data!.activity!.id)}>{startRecommended.isPending ? 'Preparando…' : 'Empezar actividad'}<ArrowRight size={15} /></Button> : <Link className="button button-outline next-activity-action" to={`/student/courses/${courseId}/curriculum`}>Revisar habilidades</Link>}</div></Card>}
    {startRecommended.isError && <div className="inline-alert alert-error" role="alert">{startRecommended.error.message}</div>}
    <Card className="student-course-intro"><div className="student-course-mark"><BookOpen size={22} /></div><div><Badge tone={item.status === 'active' ? 'success' : 'warning'}>{item.status === 'active' ? 'En curso' : 'En preparación'}</Badge><h2>{item.description || 'Tu espacio de aprendizaje está listo.'}</h2><p>{item.credits} créditos · {item.unit_count} unidades · {item.material_count} materiales</p></div></Card>
    <div className="student-shortcuts">
      <Link to={`/student/courses/${courseId}/curriculum`}><Layers3 size={19} /><span><strong>Ruta de aprendizaje</strong><small>Unidades, temas y habilidades</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/materials`}><FileText size={19} /><span><strong>Materiales</strong><small>Documentos y recursos del curso</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/assessments`}><ClipboardCheck size={19} /><span><strong>Práctica y evaluaciones</strong><small>{assessments.data!.length} actividades disponibles</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/tutor`}><MessageCircle size={19} /><span><strong>Tutor socrático</strong><small>Piensa y pregunta con ayuda guiada</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/feedback`}><FileText size={19} /><span><strong>Retroalimentación</strong><small>Comentarios de tus docentes</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/progress`}><Target size={19} /><span><strong>Mi progreso</strong><small>Dominio estimado y repasos</small></span><ArrowRight size={15} /></Link>
    </div>
    <section className="student-units-section"><div className="section-intro"><div><h2>Contenido del curso</h2><p className="muted-text">Explora las unidades que tu docente ha preparado.</p></div></div>
      {curriculum.data!.length ? <div className="student-unit-grid">{curriculum.data!.map((unit, index) => <Card key={unit.id}><div className="card-content"><span className="unit-number">{String(index + 1).padStart(2, '0')}</span><h3>{unit.title}</h3><p>{unit.outcome || 'Resultado de aprendizaje por definir.'}</p><span className="muted-text text-small">{unit.topics.length} temas · {unit.skills.length} habilidades</span></div></Card>)}</div> : <Card><EmptyState icon={Layers3} title="Contenido en preparación" description="Tu docente todavía no ha publicado unidades para este curso." /></Card>}
    </section>
  </>
}

export function StudentCurriculumPage() {
  const { courseId = '' } = useParams()
  const curriculum = useQuery({ queryKey: ['student-curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/student/courses/${courseId}/curriculum`) })
  const progress = useQuery({ queryKey: ['student-progress', courseId], queryFn: () => api<ProgressData>(`/student/courses/${courseId}/progress`) })
  if (curriculum.isLoading || progress.isLoading) return <LoadingState />
  if (curriculum.isError || progress.isError) return <ErrorState message="No pudimos cargar la ruta de aprendizaje." retry={() => { void curriculum.refetch(); void progress.refetch() }} />
  const mastery = new Map(progress.data!.mastery.map((item) => [item.skill_id, item]))
  return <>
    <PageHeader title="Ruta de aprendizaje" description="Revisa unidades, temas y habilidades del curso. El dominio es una estimación basada en tus respuestas." />
    {!curriculum.data!.length ? <Card><EmptyState icon={Layers3} title="La ruta se está preparando" description="Las unidades aparecerán aquí cuando tu docente publique la estructura del curso." /></Card> : <div className="curriculum-list">{curriculum.data!.map((unit, index) => <Card className="student-unit-card" key={unit.id}><div className="card-content"><div className="student-unit-heading"><span className="unit-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{unit.title}</h2><p>{unit.outcome}</p></div></div><div className="unit-content-grid"><div><div className="unit-subheading"><span><BookOpen size={15} />Temas</span></div>{unit.topics.length ? <ul className="curriculum-items">{unit.topics.map((topic) => <li key={topic.id}>{topic.title}</li>)}</ul> : <p className="subsection-empty">Aún no hay temas.</p>}</div><div><div className="unit-subheading"><span><Target size={15} />Habilidades</span></div>{unit.skills.length ? <div className="student-skill-list">{unit.skills.map((skill) => {
          const evidence = mastery.get(skill.id)
          const probability = evidence?.probability ?? null
          return <div className="student-skill-row" key={skill.id}><div><strong>{skill.title}</strong>{skill.description && <small>{skill.description}</small>}</div>{probability === null ? <Badge>Sin evidencia</Badge> : <div className="student-mastery"><div className="progress-track"><i style={{ width: `${Math.round(probability * 100)}%` }} /></div><small>Dominio estimado {Math.round(probability * 100)}%</small></div>}</div>
        })}</div> : <p className="subsection-empty">Aún no hay habilidades.</p>}</div></div></div></Card>)}</div>}
  </>
}

export function StudentMaterialsPage() {
  const { courseId = '' } = useParams()
  const toast = useToast()
  const [offset, setOffset] = useState(0)
  const limit = 25
  const materials = useQuery({
    queryKey: ['student-materials', courseId, offset],
    queryFn: () => api<PageResult<StudentMaterial>>(`/student/courses/${courseId}/materials?limit=${limit}&offset=${offset}`),
    refetchInterval: (current) => current.state.data?.items.some((material) =>
      material.status === 'queued' || material.status === 'processing',
    ) ? 5000 : false,
  })
  async function openMaterial(material: StudentMaterial) {
    try {
      const { url } = await api<{ url: string }>(`/student/materials/${material.id}/download-url`)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo abrir el material.', 'error') }
  }
  if (materials.isLoading) return <LoadingState />
  if (materials.isError) return <ErrorState message="No pudimos cargar los materiales." retry={() => void materials.refetch()} />
  return <><PageHeader title="Materiales de clase" description="Recursos que tu docente ha compartido para el curso." /><Card><div className="materials-list">{materials.data!.items.length ? materials.data!.items.map((material) => <button className="student-material-row" key={material.id} onClick={() => void openMaterial(material)}><span className="file-type-mark">{material.kind === 'link' ? 'URL' : material.name.split('.').pop()?.toUpperCase()}</span><span className="material-copy"><strong>{material.name}</strong><small>{material.kind === 'link' ? 'Enlace externo' : `${material.status === 'queued' ? 'Subido' : material.status === 'processing' ? 'Procesando' : material.status === 'failed' ? 'Texto no disponible' : 'Listo'} · ${Math.ceil(material.size_bytes / 1024)} KB · ${material.chunk_count} fragmentos`}</small></span><ArrowRight size={16} /></button>) : <EmptyState icon={FileText} title="Aún no hay materiales" description="Los documentos y enlaces del curso aparecerán aquí cuando tu docente los comparta." />}</div></Card><PaginationControls total={materials.data!.total} limit={limit} offset={offset} onChange={setOffset} /></>
}

export function StudentAssessmentsPage() {
  const { courseId = '' } = useParams()
  const toast = useToast()
  const navigate = useNavigate()
  const assessments = useQuery({ queryKey: ['student-assessments', courseId], queryFn: () => api<Assessment[]>(`/student/courses/${courseId}/assessments`) })
  const start = useMutation({
    mutationFn: (assessmentId: string) => api<AssessmentAttempt>(`/student/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    onSuccess: (attempt) => navigate(`/student/attempts/${attempt.id}`),
    onError: (error) => toast(error.message, 'error'),
  })
  if (assessments.isLoading) return <LoadingState />
  if (assessments.isError) return <ErrorState message="No pudimos cargar las actividades." retry={() => void assessments.refetch()} />
  return <><PageHeader title="Práctica y evaluaciones" description="Responde sin consultar el material y explica tu razonamiento cuando la pregunta sea abierta." />{assessments.data!.length ? <div className="assessment-list">{assessments.data!.map((assessment) => <Card key={assessment.id}><div className="assessment-card"><span className="question-icon"><ClipboardCheck size={19} /></span><div className="assessment-copy"><strong>{assessment.title}</strong><p>{assessment.description || 'Responde y revisa qué conceptos conviene practicar.'}</p><small>{assessment.question_count} preguntas · {assessment.kind === 'diagnostic' ? 'Diagnóstico' : assessment.kind === 'transfer' ? 'Transferencia' : 'Práctica'}</small></div><Button onClick={() => start.mutate(assessment.id)} disabled={start.isPending}>Comenzar<ArrowRight size={15} /></Button></div></Card>)}</div> : <Card><EmptyState icon={ClipboardCheck} title="No hay evaluaciones disponibles" description="Las actividades aparecerán aquí cuando tu docente las publique." /></Card>}</>
}

export function StudentFeedbackPage() {
  const { courseId = '' } = useParams()
  const [offset, setOffset] = useState(0)
  const limit = 25
  const submissions = useQuery({
    queryKey: ['student-submissions', courseId, offset],
    queryFn: () => api<PageResult<{ id: string; question: string; response: string; suggested_score: number | null;
      final_score: number | null; teacher_comment: string | null; status: 'pending' | 'reviewed'; created_at: string }>>(
      `/student/courses/${courseId}/submissions?limit=${limit}&offset=${offset}`,
    ),
  })
  if (submissions.isLoading) return <LoadingState />
  if (submissions.isError) return <ErrorState message="No pudimos cargar tus entregas." retry={() => void submissions.refetch()} />
  const items = submissions.data!.items
  return <>
    <PageHeader title="Retroalimentación" description="Revisa comentarios y notas confirmadas por tu docente. Las sugerencias automáticas no son la nota final." />
    {!submissions.data!.total ? <Card><EmptyState icon={FileText} title="Aún no tienes entregas" description="Cuando envíes una respuesta abierta, su estado y revisión aparecerán aquí." /></Card> : <div className="feedback-list">{items.map((item) => <Card key={item.id}><div className="feedback-heading"><div><h2>{item.question}</h2><p className="muted-text text-small">Enviada {new Date(item.created_at).toLocaleDateString('es')}</p></div><Badge tone={item.status === 'reviewed' ? 'success' : 'warning'}>{item.status === 'reviewed' ? 'Revisada' : 'Pendiente de revisión'}</Badge></div><div className="feedback-response"><strong>Tu respuesta</strong><p>{item.response}</p></div>{item.status === 'reviewed' ? <div className="feedback-result"><strong>Nota final: {item.final_score ?? '—'}/20</strong>{item.teacher_comment && <p>{item.teacher_comment}</p>}</div> : item.suggested_score !== null && <p className="muted-text text-small">Sugerencia automática: {item.suggested_score}/20 · pendiente de confirmación docente.</p>}</Card>)}</div>}
    <PaginationControls total={submissions.data!.total} limit={limit} offset={offset} onChange={setOffset} />
  </>
}

export function StudentAttemptPage() {
  const { attemptId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [response, setResponse] = useState<unknown>(null)
  const [confidence, setConfidence] = useState(1)
  const attempt = useQuery({ queryKey: ['student-attempt', attemptId], queryFn: () => api<AssessmentAttempt>(`/student/attempts/${attemptId}`) })
  const answer = useMutation({
    mutationFn: ({ questionId, value }: { questionId: string; value: unknown }) => api(`/student/attempts/${attemptId}/questions/${questionId}`, { method: 'POST', body: jsonBody({ response: value, confidence }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['student-attempt', attemptId] }); setResponse(null) },
    onError: (error) => toast(error.message, 'error'),
  })
  const finish = useMutation({
    mutationFn: () => api<{ score: number | null; possible_score: number | null }>(`/student/attempts/${attemptId}/submit`, { method: 'POST' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['student-attempt', attemptId] }); toast('Evaluación enviada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  if (attempt.isLoading) return <LoadingState />
  if (attempt.isError) return <ErrorState message="No pudimos abrir esta evaluación." retry={() => void attempt.refetch()} />
  const data = attempt.data!
  const current = data.questions.find((question) => question.response === null || question.response === undefined)
  if (data.status !== 'in_progress') return <Card><EmptyState icon={Check} title="Evaluación enviada" description="Tus respuestas se guardaron. Las preguntas abiertas aparecerán en la sección de revisión docente." /></Card>
  if (!current) return <div className="attempt-finish"><Card><div className="card-content text-center"><div className="empty-icon"><Check size={22} /></div><h2>Completaste todas las preguntas</h2><p>Envía la evaluación para guardar tus respuestas.</p><Button className="attempt-finish-button" onClick={() => finish.mutate()} disabled={finish.isPending}>{finish.isPending ? 'Enviando…' : 'Enviar evaluación'}</Button></div></Card></div>
  const index = data.questions.findIndex((question) => question.id === current.id)
  return <><PageHeader title="Práctica" description={`Pregunta ${index + 1} de ${data.questions.length} · Intento ${data.attempt_number}`} />
    <div className="attempt-progress"><div className="progress-track"><i style={{ width: `${Math.round(index / data.questions.length * 100)}%` }} /></div></div>
    <Card className="attempt-card"><div className="card-content"><Badge>{current.question_type === 'open' ? 'Respuesta abierta' : current.question_type === 'numeric' ? 'Respuesta numérica' : 'Opción múltiple'}</Badge><h2>{current.prompt}</h2>
      {current.question_type === 'multiple_choice' ? <div className="attempt-options">{(current.options || []).map((option, optionIndex) => <button className={`quiz-option${response === optionIndex ? ' is-active' : ''}`} key={optionIndex} onClick={() => setResponse(optionIndex)}><span className="option-key">{String.fromCharCode(65 + optionIndex)}</span>{option}</button>)}</div> : current.question_type === 'numeric' ? <Field label="Tu respuesta"><TextInput type="number" step="any" value={typeof response === 'number' || typeof response === 'string' ? response : ''} onChange={(event) => setResponse(event.target.value === '' ? null : Number(event.target.value))} /></Field> : <Field label="Tu razonamiento"><TextArea rows={6} value={typeof response === 'string' ? response : ''} onChange={(event) => setResponse(event.target.value)} placeholder="Describe cómo llegaste a tu respuesta…" /></Field>}
      <div className="confidence-picker"><span>¿Qué tan seguro estás?</span>{[['Adivinando', 0], ['Dudoso', 1], ['Seguro', 2]].map(([label, value]) => <button className={confidence === value ? 'is-selected' : ''} key={value} onClick={() => setConfidence(Number(value))}>{label}</button>)}</div>
      <Button onClick={() => answer.mutate({ questionId: current.id, value: response })} disabled={answer.isPending || response === null || response === ''}>{answer.isPending ? 'Guardando…' : 'Responder'}</Button>
    </div></Card>
  </>
}

export function StudentProgressPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [reflection, setReflection] = useState('')
  const progress = useQuery({ queryKey: ['student-progress', courseId], queryFn: () => api<ProgressData>(`/student/courses/${courseId}/progress`) })
  const reflections = useQuery({ queryKey: ['student-reflections', courseId], queryFn: () => api<{ id: string; prompt: string; body: string; created_at: string }[]>(`/student/courses/${courseId}/reflections`) })
  const saveReflection = useMutation({
    mutationFn: () => api(`/student/courses/${courseId}/reflections`, {
      method: 'POST', body: jsonBody({ body: reflection.trim(), prompt: '¿Qué fue lo más difícil y qué estrategia probarás?' }),
    }),
    onSuccess: async () => { setReflection(''); await queryClient.invalidateQueries({ queryKey: ['student-reflections', courseId] }); toast('Reflexión guardada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  const rate = useMutation({
    mutationFn: ({ skillId, rating }: { skillId: string; rating: number }) => api(`/student/reviews/${skillId}/rate?course_id=${courseId}`, { method: 'POST', body: jsonBody({ rating }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['student-progress', courseId] }); toast('Repaso programado.') },
    onError: (error) => toast(error.message, 'error'),
  })
  if (progress.isLoading || reflections.isLoading) return <LoadingState />
  if (progress.isError || reflections.isError) return <ErrorState message="No pudimos cargar tu progreso." retry={() => { void progress.refetch(); void reflections.refetch() }} />
  const data = progress.data!
  return <><PageHeader title="Mi progreso" description="El dominio es una estimación basada en respuestas y revisiones, no una calificación definitiva." />
    <div className="stats-grid stats-grid-compact"><Stat icon={Target} label="Habilidades con evidencia" value={data.mastery.length} detail="basadas en tus respuestas" /><Stat icon={Repeat2} label="Repasos vencidos" value={data.retention.due_count} detail={`${data.reviews.length} habilidades en tu agenda`} /><Stat icon={ClipboardCheck} label="Pruebas de transferencia" value={data.transfer.attempts} detail={data.transfer.average_score_percent === null ? 'sin evaluaciones completadas' : `${Math.round(data.transfer.average_score_percent)}% promedio`} /></div>
    <Card className="student-progress-card"><div className="card-heading"><h2>Dominio por habilidad</h2></div><div className="card-content">{data.mastery.length ? data.mastery.map((item) => <div className="mastery-row" key={item.skill_id}><div><strong>{item.skill}</strong><small>{item.unit} · {item.observations} evidencias</small></div><div className="student-mastery"><div className="progress-track"><i style={{ width: `${Math.round(item.probability * 100)}%` }} /></div><small>{Math.round(item.probability * 100)}%</small></div></div>) : <EmptyState icon={Target} title="Aún no hay evidencia de aprendizaje" description="Completa una actividad para comenzar a ver estimaciones de dominio." />}</div></Card>
     <Card className="student-progress-card"><div className="card-heading"><h2>Repasos espaciados</h2><p className="muted-text text-small">Después de intentar recuperar la idea, registra qué tan fácil fue recordarla. Es una autoevaluación, no una calificación.</p></div><div className="card-content">{data.reviews.length ? data.reviews.map((item) => { const due = new Date(item.due_at) <= new Date(); return <div className="review-schedule-row" key={item.skill_id}><div><strong>{data.mastery.find((skill) => skill.skill_id === item.skill_id)?.skill || 'Habilidad'}</strong><small>{due ? 'Vencido · ' : 'Próximo repaso · '}{new Date(item.due_at).toLocaleDateString('es')}</small></div><div className="review-rating">{[['Otra vez', 0], ['Difícil', 1], ['Bien', 2], ['Fácil', 3]].map(([label, rating]) => <button key={rating} disabled={rate.isPending} onClick={() => rate.mutate({ skillId: item.skill_id, rating: Number(rating) })}>{label}</button>)}</div></div>}) : <EmptyState icon={Repeat2} title="No tienes repasos programados" description="Los repasos se agregarán después de que demuestres conocimientos en una habilidad." />}</div></Card>
     <Card className="student-progress-card"><div className="card-heading"><h2>Retención y transferencia</h2><p className="muted-text text-small">Las pruebas de transferencia verifican si puedes aplicar la idea en una situación nueva.</p></div><div className="card-content progress-report-grid"><div><strong>{data.retention.on_time_reviews}</strong><span>autoevaluaciones después de un repaso vencido</span><small>{data.retention.average_self_rating === null ? 'Aún no hay valoraciones' : `Facilidad media ${data.retention.average_self_rating.toFixed(1)} de 3`}</small></div><div><strong>{data.transfer.attempts}</strong><span>evaluaciones de transferencia completadas</span><small>{data.transfer.average_score_percent === null ? 'Sin resultados disponibles' : `${Math.round(data.transfer.average_score_percent)}% del puntaje posible`}</small></div></div>{data.evidence_history.length > 0 && <div className="card-content evidence-history"><h3>Últimas evidencias</h3>{data.evidence_history.slice(0, 10).map((event, index) => <div className="evidence-history-row" key={`${event.skill_id}-${event.created_at}-${index}`}><div><strong>{event.skill}</strong><small>{event.unit} · {event.is_transfer ? 'Transferencia' : event.evidence_type === 'teacher_review' ? 'Revisión docente' : 'Recuperación activa'}</small></div><Badge tone={event.is_correct ? 'success' : 'warning'}>{event.is_correct ? 'Correcta' : 'Por reforzar'}</Badge><span className="evidence-change">{Math.round(event.probability_before * 100)}% → {Math.round(event.probability_after * 100)}%</span></div>)}</div>}</Card>
    <Card className="student-progress-card"><div className="card-heading"><h2>Diario de reflexión</h2><p className="muted-text text-small">Piensa qué te resultó difícil y qué intentarás después.</p></div><div className="card-content"><Field label="Tu reflexión"><TextArea rows={3} value={reflection} onChange={(event) => setReflection(event.target.value)} maxLength={10000} placeholder="Escribe una estrategia que quieras probar…" /></Field><Button onClick={() => saveReflection.mutate()} disabled={!reflection.trim() || saveReflection.isPending}>Guardar reflexión</Button>{reflections.data!.map((item) => <div className="reflection-entry" key={item.id}><small>{new Date(item.created_at).toLocaleString('es')}</small><p>{item.body}</p></div>)}</div></Card>
  </>
}

export function StudentTutorPage() {
  const { courseId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [sessionId, setSessionId] = useState('')
  const [skillId, setSkillId] = useState('')
  const [message, setMessage] = useState('')
  const [sendCooldown, setSendCooldown] = useState(false)
  const [responseError, setResponseError] = useState<{ sessionId: string; message: string } | null>(null)
  const lastSentAt = useRef(0)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const curriculum = useQuery({ queryKey: ['student-curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/student/courses/${courseId}/curriculum`) })
  const requestedSkillId = searchParams.get('skill_id')
  useEffect(() => {
    if (requestedSkillId && curriculum.data?.some((unit) => unit.skills.some((skill) => skill.id === requestedSkillId))) {
      setSkillId(requestedSkillId)
    }
  }, [requestedSkillId, curriculum.data])
  const sessions = useQuery({ queryKey: ['tutor-sessions', courseId], queryFn: () => api<TutorSessions>(`/student/courses/${courseId}/tutor/sessions`) })
  useEffect(() => {
    if (!sessionId && sessions.data?.sessions.length) setSessionId(sessions.data.sessions[0].id)
  }, [sessionId, sessions.data])
  const messages = useQuery({
    queryKey: ['tutor-messages', sessionId],
    queryFn: () => api<{ id: string; messages: TutorMessageInfo[] }>(`/student/tutor/sessions/${sessionId}`),
    enabled: !!sessionId,
  })
  useEffect(() => () => {
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
  }, [])
  const createSession = useMutation({
    mutationFn: () => api<TutorSessionInfo>(`/student/courses/${courseId}/tutor/sessions${skillId ? `?skill_id=${skillId}` : ''}`, { method: 'POST' }),
    onSuccess: async (session) => {
      setSessionId(session.id)
      await queryClient.invalidateQueries({ queryKey: ['tutor-sessions', courseId] })
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const sendMessage = useMutation({
    mutationFn: ({ sessionId: targetSessionId, content }: TutorMessageSubmission) => api<TutorMessageResponse>(`/student/tutor/sessions/${targetSessionId}/messages`, {
      method: 'POST', body: jsonBody({ content }),
    }),
    onSuccess: (result, variables) => {
      const queryKey = ['tutor-messages', variables.sessionId]
      queryClient.setQueryData<{ id: string; messages: TutorMessageInfo[] }>(queryKey, (current) => {
        const existing = (current?.messages || []).filter((item) => item.id !== variables.optimisticId)
        const byId = new Map(existing.map((item) => [item.id, item]))
        byId.set(result.user_message.id, result.user_message)
        byId.set(result.assistant_message.id, result.assistant_message)
        const updated = [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
        return { id: variables.sessionId, messages: updated }
      })
      setResponseError((current) => current?.sessionId === variables.sessionId ? null : current)
      void queryClient.invalidateQueries({ queryKey })
    },
    onError: (error, variables) => setResponseError({ sessionId: variables.sessionId, message: error.message }),
  })
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' })
  }, [sessionId, messages.data, sendMessage.isPending, responseError])
  if (curriculum.isLoading || sessions.isLoading || (sessionId && messages.isLoading)) return <LoadingState />
  if (curriculum.isError || sessions.isError || messages.isError) return <ErrorState message="No pudimos cargar la sesión del tutor." retry={() => { void sessions.refetch(); if (sessionId) void messages.refetch() }} />
  const aiReady = sessions.data!.ai_configured
  const skills = curriculum.data!.flatMap((unit) => unit.skills.map((skill) => ({ ...skill, unitTitle: unit.title })))
  const currentMessages = messages.data?.messages || []
  const waitingForTutor = sendMessage.isPending && sendMessage.variables?.sessionId === sessionId
  const currentResponseError = responseError?.sessionId === sessionId ? responseError.message : ''

  function submitMessage() {
    const content = message.trim()
    const now = Date.now()
    if (!content || !aiReady || sendMessage.isPending || now - lastSentAt.current < 2000) return
    lastSentAt.current = now
    setSendCooldown(true)
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
    cooldownTimer.current = setTimeout(() => {
      setSendCooldown(false)
      cooldownTimer.current = null
    }, 2000)

    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const optimisticMessage: TutorMessageInfo = {
      id: optimisticId,
      role: 'user',
      content,
      citations: [],
      created_at: new Date(now).toISOString(),
    }
    queryClient.setQueryData<{ id: string; messages: TutorMessageInfo[] }>(
      ['tutor-messages', sessionId],
      (current) => ({ id: sessionId, messages: [...(current?.messages || []), optimisticMessage] }),
    )
    setMessage('')
    setResponseError(null)
    sendMessage.mutate({ sessionId, content, optimisticId })
  }
  return <>
    <PageHeader title="Tutor socrático" description="Recibe preguntas y pistas guiadas. El tutor te ayuda a razonar, no decide por sí solo si dominas una habilidad." actions={sessionId ? <Button variant="outline" onClick={() => createSession.mutate()} disabled={!aiReady || createSession.isPending}>Nueva conversación</Button> : undefined} />
    {!aiReady && <div className="inline-alert alert-warning"><MessageCircle size={17} /><span>El tutor está desactivado hasta que se configure el proveedor OpenAI-compatible en el servidor.</span></div>}
    {!sessionId ? <Card><div className="card-content tutor-start"><div className="tutor-start-icon"><MessageCircle size={22} /></div><h2>Comienza con una habilidad</h2><p>Elige un tema del curso o inicia una conversación general. Las respuestas se apoyan en los materiales procesados cuando hay fuentes disponibles.</p><div className="tutor-start-controls"><Field label="Habilidad"><Select value={skillId} onChange={(event) => setSkillId(event.target.value)}><option value="">Sin habilidad específica</option>{skills.map((skill) => <option value={skill.id} key={skill.id}>{skill.unitTitle} · {skill.title}</option>)}</Select></Field><Button onClick={() => createSession.mutate()} disabled={!aiReady || createSession.isPending}>Iniciar conversación</Button></div></div></Card> : <Card className="tutor-chat-card">
      <div className="tutor-session-toolbar"><div><Badge tone={aiReady ? 'success' : 'warning'}>{aiReady ? 'Tutor listo' : 'Proveedor pendiente'}</Badge><span>{skills.find((skill) => skill.id === sessions.data!.sessions.find((session) => session.id === sessionId)?.skill_id)?.title || 'Conversación general'}</span></div><Select aria-label="Cambiar conversación" value={sessionId} onChange={(event) => setSessionId(event.target.value)}>{sessions.data!.sessions.map((session) => <option value={session.id} key={session.id}>{new Date(session.started_at).toLocaleString('es')}</option>)}</Select></div>
      <div className="tutor-message-list" aria-live="polite">
        {currentMessages.length ? currentMessages.map((item) => <article className={`tutor-message tutor-message-${item.role}`} key={item.id}>
          <div className="tutor-message-role">{item.role === 'user' ? 'Tú' : 'Tutor'}</div>
          <p>{item.content}</p>
          {!!item.citations.length && <div className="tutor-citations"><span>Fuentes del curso</span>{item.citations.map((citation) => <span className="filter-chip" key={`${citation.material_id}:${citation.chunk_index}`}>{citation.material_name}{citation.page_number ? ` · pág. ${citation.page_number}` : ''}</span>)}</div>}
        </article>) : <EmptyState icon={MessageCircle} title="La conversación está lista" description="Escribe qué estás intentando comprender. El tutor empezará con una pregunta, no con la respuesta final." />}
        {waitingForTutor && <article className="tutor-message tutor-message-assistant tutor-message-pending" role="status"><div className="tutor-message-role">Tutor</div><p><LoaderCircle className="spin" size={14} />Preparando una respuesta…</p></article>}
        {currentResponseError && <div className="tutor-response-error" role="alert"><strong>No se pudo obtener una respuesta</strong><span>{currentResponseError}</span></div>}
        <div ref={messageEndRef} />
      </div>
      <form className="tutor-composer" onSubmit={(event) => { event.preventDefault(); submitMessage() }}>
        <TextArea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submitMessage()
          }
        }} maxLength={5000} placeholder="Escribe tu razonamiento o una duda…" aria-label="Mensaje para el tutor" />
        <Button type="submit" disabled={!aiReady || !message.trim() || sendMessage.isPending || sendCooldown} aria-label="Enviar mensaje">{sendMessage.isPending ? <><LoaderCircle className="spin" size={15} />Pensando…</> : <><Send size={16} />Enviar</>}</Button>
      </form>
      <p className="tutor-composer-hint" aria-live="polite">{sendMessage.isPending ? 'Tu mensaje ya está en la conversación; el tutor está preparando una respuesta.' : sendCooldown ? 'Espera un momento antes de enviar otro mensaje.' : 'Enter envía · Shift + Enter agrega una línea nueva'}</p>
    </Card>}
  </>
}
