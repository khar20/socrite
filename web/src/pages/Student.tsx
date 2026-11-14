import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Check, CircleHelp, ClipboardCheck, FileText, Gauge, Layers3, Lightbulb, LoaderCircle, Lock, MessageCircle, Repeat2, Send, Target, Users } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import { ProgressRing } from '../components/ProgressRing'
import type { Course, PageResult } from '../types'
import type { PathData, HomeData } from './student/types'
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
type AssessmentAttempt = {
  id: string; assessment_id: string; course_id: string; status: string; attempt_number: number
  assessment: { title: string; description: string; instructions: string; kind: string } | null
  score: number | null; possible_score: number | null; submitted_at: string | null; questions: AttemptQuestion[]
}
type AnswerResult = { question_id: string; is_correct: boolean | null; pending_review: boolean; suggested_score: number | null }
type AttemptQuestion = {
  id: string; prompt: string; question_type: 'open' | 'multiple_choice' | 'numeric'
  options: string[] | null; points: number; response: unknown; is_correct: boolean | null; pending_review: boolean
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
type TutorHintResponse = { level: number; assistant_message: TutorMessageInfo }
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
  const course = useQuery({ queryKey: ['student-course', courseId], queryFn: () => api<StudentCourse>(`/student/courses/${courseId}`) })
  const path = useQuery({ queryKey: ['student-path', courseId], queryFn: () => api<PathData>(`/student/courses/${courseId}/path`) })
  if (course.isLoading || path.isLoading) return <LoadingState />
  if (course.isError || path.isError) return <ErrorState message="No pudimos cargar el curso." retry={() => { void course.refetch(); void path.refetch() }} />
  const item = course.data!
  const units = path.data!.units
  const materialCount = units.reduce((total, unit) => total + unit.materials.length, 0)
  const skillCount = units.reduce((total, unit) => total + unit.skills.length, 0)
  return <div className="student-view">
    <PageHeader title={item.title} description={`${item.code || 'Curso'}${item.academic_period ? ` · ${item.academic_period}` : ''}`}
      actions={<Link className="button button-outline" to={`/student/courses/${courseId}/practice`}><ClipboardCheck size={15} />Ir a práctica</Link>} />
    <Card className="student-course-intro"><div className="student-course-mark"><BookOpen size={22} /></div><div>
      <Badge tone={item.status === 'active' ? 'success' : 'warning'}>{item.status === 'active' ? 'En curso' : 'En preparación'}</Badge>
      <h2>{item.description || 'Tu espacio de aprendizaje está listo.'}</h2>
      <p>{item.credits} créditos · {units.length} unidades · {skillCount} habilidades · {materialCount} materiales</p>
    </div></Card>
    <div className="student-shortcuts">
      <Link to={`/student/courses/${courseId}/path`}><Layers3 size={19} /><span><strong>Mi ruta</strong><small>Unidades, temas y habilidades</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/materials`}><FileText size={19} /><span><strong>Materiales</strong><small>Documentos y recursos del curso</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/tutor`}><MessageCircle size={19} /><span><strong>Tutor socrático</strong><small>Piensa y pregunta con ayuda guiada</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/review`}><Repeat2 size={19} /><span><strong>Repaso espaciado</strong><small>Consolida lo que ya aprendiste</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/problems`}><Target size={19} /><span><strong>Problemas</strong><small>Aplica lo aprendido en casos nuevos</small></span><ArrowRight size={15} /></Link>
      <Link to={`/student/courses/${courseId}/progress`}><ClipboardCheck size={19} /><span><strong>Mi progreso</strong><small>Dominio estimado y evidencias</small></span><ArrowRight size={15} /></Link>
    </div>
    <Card>
      <div className="card-heading card-heading-row"><div><h2>Unidades del curso</h2><p className="muted-text text-small">Explora las unidades que tu docente ha preparado.</p></div>
        <Link className="subtle-link" to={`/student/courses/${courseId}/path`}>Ver ruta<ArrowRight size={14} /></Link></div>
      <div className="card-content unit-progress-list">
        {units.length ? units.map((unit) => <div className="unit-progress-row" key={unit.id}>
          <ProgressRing value={unit.mastery ?? 0} />
          <div className="unit-progress-copy"><strong>Unidad {unit.position} · {unit.title}</strong><small className="muted-text">{unit.skills.length} {unit.skills.length === 1 ? 'habilidad' : 'habilidades'} · {unit.materials.length} {unit.materials.length === 1 ? 'material' : 'materiales'}</small></div>
          <Link className="button button-outline button-small" to={`/student/courses/${courseId}/path#unit-${unit.id}`}>Continuar</Link>
        </div>) : <EmptyState icon={Layers3} title="Contenido en preparación" description="Tu docente todavía no ha publicado unidades para este curso." />}
      </div>
    </Card>
  </div>
}

export function StudentMaterialsPage() {
  const { courseId = '' } = useParams()
  const toast = useToast()
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const limit = 25
  const materials = useQuery({
    queryKey: ['student-materials', courseId, offset, term],
    queryFn: () => api<PageResult<StudentMaterial>>(`/student/courses/${courseId}/materials?limit=${limit}&offset=${offset}${term ? `&search=${encodeURIComponent(term)}` : ''}`),
    refetchInterval: (current) => current.state.data?.items.some((material) =>
      material.status === 'queued' || material.status === 'processing',
    ) ? 5000 : false,
  })
  const path = useQuery({ queryKey: ['student-path', courseId], queryFn: () => api<PathData>(`/student/courses/${courseId}/path`) })
  async function openMaterial(material: StudentMaterial) {
    try {
      const { url } = await api<{ url: string }>(`/student/materials/${material.id}/download-url`)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo abrir el material.', 'error') }
  }
  if (materials.isLoading || path.isLoading) return <LoadingState />
  if (materials.isError || path.isError) return <ErrorState message="No pudimos cargar los materiales." retry={() => { void materials.refetch(); void path.refetch() }} />
  const units = new Map(path.data!.units.map((unit) => [unit.id, unit]))
  return <div className="student-view">
    <PageHeader title="Materiales" description="Recursos que tu docente ha compartido. El tutor socrático responde con base en estos materiales." />
    <Card>
      <div className="library-toolbar">
        <form onSubmit={(event) => { event.preventDefault(); setOffset(0); setTerm(search.trim()) }}>
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre…" aria-label="Buscar materiales" />
        </form>
        <span className="muted-text text-small">{materials.data!.total} {materials.data!.total === 1 ? 'material' : 'materiales'}{term ? ` para «${term}»` : ''}</span>
      </div>
      <div className="card-content">
        {materials.data!.items.length ? <div className="library-grid">{materials.data!.items.map((material) => {
          const unit = material.unit_id ? units.get(material.unit_id) : undefined
          return <button className="library-item" key={material.id} onClick={() => void openMaterial(material)}>
            <span className="library-item-mark">{material.kind === 'link' ? 'URL' : material.name.split('.').pop()?.toUpperCase().slice(0, 4) || 'DOC'}</span>
            <span className="library-item-copy">
              <strong>{material.name}</strong>
              <small className="muted-text">{unit ? `Unidad ${unit.position} · ${unit.title}` : 'Material general'}</small>
              <small className="muted-text">{material.kind === 'link' ? 'Enlace externo' : `${material.status === 'queued' ? 'Subido' : material.status === 'processing' ? 'Procesando' : material.status === 'failed' ? 'Texto no disponible' : 'Listo'} · ${Math.ceil(material.size_bytes / 1024)} KB · ${material.chunk_count} fragmentos`}</small>
            </span>
            <ArrowRight size={16} />
          </button>
        })}</div>
          : <EmptyState icon={FileText} title={term ? 'Sin resultados' : 'Aún no hay materiales'} description={term ? 'Prueba con otro nombre o revisa la biblioteca completa.' : 'Los documentos y enlaces del curso aparecerán aquí cuando tu docente los comparta.'} action={term ? <Button variant="outline" onClick={() => { setSearch(''); setTerm(''); setOffset(0) }}>Ver todos</Button> : undefined} />}
      </div>
    </Card>
    <PaginationControls total={materials.data!.total} limit={limit} offset={offset} onChange={setOffset} />
  </div>
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
  const [confidence, setConfidence] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ question: AttemptQuestion; result: AnswerResult } | null>(null)
  const attempt = useQuery({ queryKey: ['student-attempt', attemptId], queryFn: () => api<AssessmentAttempt>(`/student/attempts/${attemptId}`) })
  const answer = useMutation({
    mutationFn: ({ questionId, value }: { questionId: string; value: unknown }) => api<AnswerResult>(`/student/attempts/${attemptId}/questions/${questionId}`, { method: 'POST', body: jsonBody({ response: value, confidence }) }),
    onSuccess: async (result, variables) => {
      const question = attempt.data?.questions.find((item) => item.id === variables.questionId)
      if (question) setFeedback({ question, result })
      await queryClient.invalidateQueries({ queryKey: ['student-attempt', attemptId] })
      setResponse(null)
      setConfidence(null)
    },
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

  if (data.status !== 'in_progress') {
    const score = data.score ?? finish.data?.score ?? null
    const possible = data.possible_score ?? finish.data?.possible_score ?? null
    const ratio = score !== null && possible ? score / possible : 0
    return <div className="student-view attempt-summary">
      <PageHeader title="Práctica completada" description="Tus respuestas se guardaron. Las preguntas abiertas aparecerán en la sección de revisión docente." />
      <Card><div className="attempt-summary-body">
        <ProgressRing value={ratio} size={92} stroke={9} />
        <div><h2>{score !== null && possible ? `${Math.round(score * 10) / 10} de ${Math.round(possible * 10) / 10} puntos` : 'Evaluación enviada'}</h2>
          <p className="muted-text">Cada respuesta ajustó tu dominio estimado. Revisa tus repasos para consolidar lo aprendido.</p></div>
        <div className="attempt-summary-actions">
          <Link className="button button-outline" to={`/student/courses/${data.course_id}/review`}><Repeat2 size={15} />Ir a repaso</Link>
          <Link className="button button-outline" to={`/student/courses/${data.course_id}/progress`}><Target size={15} />Ver mi progreso</Link>
        </div>
      </div></Card>
    </div>
  }

  if (!current && !feedback) return <div className="student-view attempt-finish"><Card><div className="attempt-finish-body">
    <span className="empty-icon"><Check size={22} /></span>
    <h2>Completaste todas las preguntas</h2>
    <p className="muted-text">Envía la práctica para guardar tus respuestas y actualizar tu progreso.</p>
    <Button className="attempt-finish-button" onClick={() => finish.mutate()} disabled={finish.isPending}>{finish.isPending ? 'Enviando…' : 'Enviar práctica'}</Button>
  </div></Card></div>

  const reviewedQuestion = feedback?.question ?? current!
  const index = data.questions.findIndex((question) => question.id === reviewedQuestion.id)
  const answered = data.questions.filter((question) => question.response !== null && question.response !== undefined).length
  const remaining = data.questions.filter((question) => question.response === null || question.response === undefined).length

  return <div className="student-view attempt-view">
    <div className="attempt-topline">
      <Link className="subtle-link" to={`/student/courses/${data.course_id}/practice`}>← Salir</Link>
      <div className="attempt-topline-meta">
        <Badge tone="info">Pregunta {index + 1} de {data.questions.length}</Badge>
        <Badge>Intento {data.attempt_number}</Badge>
      </div>
    </div>
    <div className="attempt-progress"><div className="progress-track"><i style={{ width: `${Math.round(answered / data.questions.length * 100)}%` }} /></div></div>

    {data.assessment && <header className="page-header"><div><h1>{data.assessment.title}</h1>{data.assessment.description && <p className="muted-text">{data.assessment.description}</p>}{data.assessment.instructions && <p className="muted-text text-small">{data.assessment.instructions}</p>}</div></header>}

    <Card className="attempt-card"><div className="card-content attempt-body">
      <Badge>{reviewedQuestion.question_type === 'open' ? 'Respuesta abierta' : reviewedQuestion.question_type === 'numeric' ? 'Respuesta numérica' : 'Opción múltiple'}</Badge>
      <h2>{reviewedQuestion.prompt}</h2>

      {feedback ? <div className={`attempt-result ${feedback.result.pending_review ? 'is-pending' : feedback.result.is_correct ? 'is-correct' : 'is-incorrect'}`}>
        <strong>{feedback.result.pending_review ? 'Respuesta guardada' : feedback.result.is_correct ? '¡Correcto!' : 'Aún no'}</strong>
        <p>{feedback.result.pending_review
          ? 'Tu respuesta abierta quedó pendiente de revisión docente. La sugerencia automática no es la nota final.'
          : feedback.result.is_correct ? 'Tu dominio estimado se actualizó con esta evidencia.' : 'Este error queda registrado para reforzar la habilidad. Revisa el concepto con el tutor.'}</p>
        <Button onClick={() => setFeedback(null)}>{remaining ? 'Siguiente pregunta' : 'Ver cierre'}<ArrowRight size={15} /></Button>
      </div> : <>
        {reviewedQuestion.question_type === 'multiple_choice'
          ? <div className="attempt-options">{(reviewedQuestion.options || []).map((option, optionIndex) => <button className={`quiz-option${response === optionIndex ? ' is-active' : ''}`} key={optionIndex} onClick={() => setResponse(optionIndex)}><span className="option-key">{String.fromCharCode(65 + optionIndex)}</span>{option}</button>)}</div>
          : reviewedQuestion.question_type === 'numeric'
            ? <Field label="Tu respuesta"><TextInput type="number" step="any" value={typeof response === 'number' || typeof response === 'string' ? response : ''} onChange={(event) => setResponse(event.target.value === '' ? null : Number(event.target.value))} /></Field>
            : <Field label="Tu razonamiento"><TextArea rows={6} value={typeof response === 'string' ? response : ''} onChange={(event) => setResponse(event.target.value)} placeholder="Describe cómo llegaste a tu respuesta…" /></Field>}
        <div className="confidence-picker"><span>¿Qué tan seguro estás?</span>{[['Adivinando', 0], ['Dudoso', 1], ['Seguro', 2]].map(([label, value]) => <button className={confidence === value ? 'is-selected' : ''} key={value} onClick={() => setConfidence(Number(value))}>{label}</button>)}</div>
        <p className="attempt-note"><Lock size={13} />Sin apuntes: responde desde tu memoria. La confianza también es evidencia.</p>
        <Button onClick={() => answer.mutate({ questionId: reviewedQuestion.id, value: response })} disabled={answer.isPending || response === null || response === '' || confidence === null}>{answer.isPending ? 'Guardando…' : 'Responder'}<ArrowRight size={15} /></Button>
      </>}
    </div></Card>
  </div>
}

const PROGRESS_TABS = [
  { id: 'dominio', label: 'Dominio' },
  { id: 'metacognicion', label: 'Metacognición' },
  { id: 'evidencias', label: 'Evidencias' },
] as const
type ProgressTab = typeof PROGRESS_TABS[number]['id']

export function StudentProgressPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<ProgressTab>('dominio')
  const [reflection, setReflection] = useState('')
  const progress = useQuery({ queryKey: ['student-progress', courseId], queryFn: () => api<ProgressData>(`/student/courses/${courseId}/progress`) })
  const home = useQuery({ queryKey: ['student-home', courseId], queryFn: () => api<HomeData>(`/student/courses/${courseId}/home`) })
  const reflections = useQuery({ queryKey: ['student-reflections', courseId], queryFn: () => api<{ id: string; prompt: string; body: string; created_at: string }[]>(`/student/courses/${courseId}/reflections`) })
  const saveReflection = useMutation({
    mutationFn: () => api(`/student/courses/${courseId}/reflections`, {
      method: 'POST', body: jsonBody({ body: reflection.trim(), prompt: '¿Qué fue lo más difícil y qué estrategia probarás?' }),
    }),
    onSuccess: async () => { setReflection(''); await queryClient.invalidateQueries({ queryKey: ['student-reflections', courseId] }); toast('Reflexión guardada.') },
    onError: (error) => toast(error.message, 'error'),
  })
  if (progress.isLoading || home.isLoading || reflections.isLoading) return <LoadingState />
  if (progress.isError || home.isError || reflections.isError) return <ErrorState message="No pudimos cargar tu progreso." retry={() => { void progress.refetch(); void home.refetch(); void reflections.refetch() }} />

  const data = progress.data!
  const summary = home.data!.summary
  const average = summary.average_mastery ?? 0
  const theta = average > 0.001 && average < 0.999 ? Math.log(average / (1 - average)) : 0
  const calibration = [0, 1, 2].map((value) => {
    const items = data.evidence_history.filter((event) => event.confidence === value)
    const correct = items.filter((event) => event.is_correct).length
    return { label: ['Adivinando', 'Dudoso', 'Seguro'][value], count: items.length, rate: items.length ? correct / items.length : 0 }
  })
  const weakEvidence = data.evidence_history.filter((event) => !event.is_correct).slice(0, 6)
  const masteryBySkill = new Map(data.mastery.map((item) => [item.skill_id, item]))
  const reviewRows = [...data.reviews].sort((a, b) => a.due_at.localeCompare(b.due_at))

  return <div className="student-view">
    <PageHeader title="Mi progreso" description="El dominio es una estimación basada en respuestas y revisiones, no una calificación definitiva."
      actions={<Link className="button button-outline" to={`/student/courses/${courseId}/review`}><Repeat2 size={15} />Ir a repaso</Link>} />

    <div className="progress-tabs" role="tablist" aria-label="Secciones de progreso">
      {PROGRESS_TABS.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id}
        className={`progress-tab${tab === item.id ? ' is-active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>

    {tab === 'dominio' && <>
      <div className="proto-grid proto-grid-3">
        <Card><div className="progress-overview">
          <ProgressRing value={average} size={64} stroke={7} />
          <div><span className="muted-text text-small">Dominio global</span><strong>{Math.round(average * 100)}%</strong><small className="muted-text">estimación BKT</small></div>
        </div></Card>
        <Card><div className="progress-figure">
          <span className="muted-text text-small">Habilidad (θ, IRT)</span><strong>{theta.toFixed(2)}</strong><small className="muted-text">escala logit del nivel estimado</small>
        </div></Card>
        <Card><div className="progress-figure">
          <span className="muted-text text-small">Retención y transferencia</span>
          <div className="topic-chips">
            <Badge tone={summary.mastered_skills > 0 ? 'success' : 'neutral'}>{summary.mastered_skills} dominadas</Badge>
            <Badge tone={data.retention.due_count > 0 ? 'warning' : 'success'}>{data.retention.due_count} repasos vencidos</Badge>
          </div>
          <small className="muted-text">{data.transfer.average_score_percent === null ? 'Aún sin pruebas de transferencia' : `${Math.round(data.transfer.average_score_percent)}% en transferencia`}</small>
        </div></Card>
      </div>

      <Card>
        <div className="card-heading card-heading-row"><div><h2>Dominio por habilidad</h2><p className="muted-text text-small">Cada respuesta ajusta la probabilidad de que hayas comprendido la habilidad.</p></div>
          <Link className="subtle-link" to={`/student/courses/${courseId}/path`}>Ver ruta<ArrowRight size={14} /></Link></div>
        <div className="card-content progress-skill-list">
          {data.mastery.length ? data.mastery.map((item) => <div className="progress-skill-row" key={item.skill_id}>
            <span className={`progress-skill-mark${item.probability >= 0.85 ? ' is-mastered' : ''}`}><Target size={15} /></span>
            <div className="progress-skill-copy"><strong>{item.skill}</strong><small className="muted-text">{item.unit} · {item.observations} {item.observations === 1 ? 'evidencia' : 'evidencias'}</small></div>
            <div className="progress-skill-bar"><div className="progress-track"><i style={{ width: `${Math.round(item.probability * 100)}%` }} /></div><span>{Math.round(item.probability * 100)}%</span></div>
          </div>) : <EmptyState icon={Target} title="Aún no hay evidencia de aprendizaje" description="Completa una actividad para comenzar a ver estimaciones de dominio." />}
        </div>
      </Card>

      <Card>
        <div className="card-heading card-heading-row"><div><h2>Agenda de repasos</h2><p className="muted-text text-small">La valoración de cada repaso define cuándo volverá a aparecer.</p></div>
          <Badge tone={data.retention.due_count ? 'warning' : 'success'}>{data.retention.due_count ? `${data.retention.due_count} para hoy` : 'Todo al día'}</Badge></div>
        <div className="card-content review-queue">
          {reviewRows.length ? reviewRows.map((review) => {
            const skill = masteryBySkill.get(review.skill_id)
            const due = new Date(review.due_at) <= new Date()
            return <div className="review-queue-row" key={review.skill_id}>
              <div><strong>{skill?.skill || 'Habilidad'}</strong><small className="muted-text">{skill?.unit || ''} · cada {review.interval_days} d</small></div>
              <div className="review-queue-side"><span className="muted-text text-small">{Math.round((skill?.probability ?? 0) * 100)}%</span>
                <Badge tone={due ? 'warning' : 'neutral'}>{due ? 'Vence hoy' : new Date(review.due_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</Badge></div>
            </div>
          }) : <EmptyState icon={Repeat2} title="No tienes repasos programados" description="Los repasos se agregan después de tu primera evidencia en una habilidad." />}
        </div>
      </Card>
    </>}

    {tab === 'metacognicion' && <>
      <div className="proto-grid proto-grid-2">
        <Card>
          <div className="card-heading"><h2>Calibración de confianza</h2><p className="muted-text text-small">¿Qué tan bien predice tu confianza tus aciertos?</p></div>
          <div className="card-content calibration-list">
            {calibration.map((item) => <div className="calibration-row" key={item.label}>
              <div className="calibration-heading"><strong>{item.label}</strong><span className="muted-text text-small">{item.count} resp. · {Math.round(item.rate * 100)}% aciertos</span></div>
              <div className="progress-track"><i style={{ width: `${Math.round(item.rate * 100)}%` }} /></div>
            </div>)}
            <p className="muted-text text-small">{calibration[2].count > 0 && calibration[2].rate < 0.7
              ? 'Cuando te sientes seguro aún fallas con frecuencia: verifica tus procedimientos antes de confiar.'
              : 'Tu confianza es coherente con tu desempeño registrado.'}</p>
          </div>
        </Card>
        <Card>
          <div className="card-heading"><h2>Por reforzar</h2><p className="muted-text text-small">Evidencias recientes que no salieron bien.</p></div>
          <div className="card-content error-notebook">
            {weakEvidence.length ? weakEvidence.map((event, index) => <div className="error-row" key={`${event.skill_id}-${event.created_at}-${index}`}>
              <span className="error-mark">!</span>
              <div><strong>{event.skill}</strong><small className="muted-text">{event.unit} · {new Date(event.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</small></div>
              <Link className="button button-outline button-small" to={`/student/courses/${courseId}/tutor?skill_id=${event.skill_id}`}><MessageCircle size={13} />Reforzar</Link>
            </div>) : <EmptyState icon={Check} title="Sin errores recientes" description="Buen trabajo: tus últimas evidencias no muestran conceptos pendientes." />}
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-heading"><h2>Diario de reflexión</h2><p className="muted-text text-small">Piensa qué te resultó difícil y qué intentarás después.</p></div>
        <div className="card-content reflection-block">
          <Field label="Tu reflexión"><TextArea rows={3} value={reflection} onChange={(event) => setReflection(event.target.value)} maxLength={10000} placeholder="Escribe una estrategia que quieras probar…" /></Field>
          <Button onClick={() => saveReflection.mutate()} disabled={!reflection.trim() || saveReflection.isPending}>Guardar reflexión</Button>
          {reflections.data!.map((item) => <div className="reflection-entry" key={item.id}><small>{new Date(item.created_at).toLocaleString('es')}</small><p>{item.body}</p></div>)}
        </div>
      </Card>
    </>}

    {tab === 'evidencias' && <>
      <Card>
        <div className="card-heading"><h2>Registro de evidencias</h2><p className="muted-text text-small">Cada evidencia guarda el cambio en tu dominio estimado.</p></div>
        <div className="card-content evidence-history">
          {data.evidence_history.length ? data.evidence_history.map((event, index) => <div className="evidence-history-row" key={`${event.skill_id}-${event.created_at}-${index}`}>
            <div><strong>{event.skill}</strong><small className="muted-text">{event.unit} · {event.is_transfer ? 'Transferencia' : event.evidence_type === 'teacher_review' ? 'Revisión docente' : 'Recuperación activa'} · {new Date(event.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</small></div>
            <Badge tone={event.is_correct ? 'success' : 'warning'}>{event.is_correct ? 'Correcta' : 'Por reforzar'}</Badge>
            <span className="evidence-change">{Math.round(event.probability_before * 100)}% → {Math.round(event.probability_after * 100)}%</span>
          </div>) : <EmptyState icon={ClipboardCheck} title="Aún no hay evidencias" description="Responde una práctica o conversa con el tutor para comenzar." />}
        </div>
      </Card>

      <Card>
        <div className="card-heading"><h2>Retención y transferencia</h2><p className="muted-text text-small">Los repasos y los problemas nuevos confirman si el aprendizaje se sostiene.</p></div>
        <div className="card-content progress-report-grid">
          <div><strong>{data.retention.on_time_reviews}</strong><span>autoevaluaciones después de un repaso vencido</span><small>{data.retention.average_self_rating === null ? 'Aún no hay valoraciones' : `Facilidad media ${data.retention.average_self_rating.toFixed(1)} de 3`}</small></div>
          <div><strong>{data.transfer.attempts}</strong><span>evaluaciones de transferencia completadas</span><small>{data.transfer.average_score_percent === null ? 'Sin resultados disponibles' : `${Math.round(data.transfer.average_score_percent)}% del puntaje posible`}</small></div>
        </div>
        {!!data.transfer.history.length && <div className="card-content evidence-history">
          {data.transfer.history.map((item) => <div className="evidence-history-row" key={`${item.assessment_id}-${item.submitted_at}`}>
            <div><strong>{item.title}</strong><small className="muted-text">{item.submitted_at ? new Date(item.submitted_at).toLocaleDateString('es', { day: '2-digit', month: 'short' }) : 'Sin fecha'}</small></div>
            <span className="evidence-change">{item.score ?? '—'}/{item.possible_score ?? '—'}</span>
          </div>)}
        </div>}
      </Card>
    </>}
  </div>
}

const HINT_STEPS = ['Pista conceptual', 'Pista específica', 'Revisión guiada'] as const

export function StudentTutorPage() {
  const { courseId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [sessionId, setSessionId] = useState('')
  const [skillId, setSkillId] = useState('')
  const [message, setMessage] = useState('')
  const [sendCooldown, setSendCooldown] = useState(false)
  const [hintLevel, setHintLevel] = useState(0)
  const [hintLabels, setHintLabels] = useState<Record<string, number>>({})
  const [responseError, setResponseError] = useState<{ sessionId: string; message: string } | null>(null)
  const lastSentAt = useRef(0)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const path = useQuery({ queryKey: ['student-path', courseId], queryFn: () => api<PathData>(`/student/courses/${courseId}/path`) })
  const requestedSkillId = searchParams.get('skill_id')
  useEffect(() => {
    if (requestedSkillId && path.data?.units.some((unit) => unit.skills.some((skill) => skill.id === requestedSkillId))) {
      setSkillId(requestedSkillId)
    }
  }, [requestedSkillId, path.data])
  const sessions = useQuery({ queryKey: ['tutor-sessions', courseId], queryFn: () => api<TutorSessions>(`/student/courses/${courseId}/tutor/sessions`) })
  useEffect(() => {
    if (!sessionId && sessions.data?.sessions.length) setSessionId(sessions.data.sessions[0].id)
  }, [sessionId, sessions.data])
  useEffect(() => {
    setHintLevel(0)
    setHintLabels({})
  }, [sessionId])
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
  const requestHint = useMutation({
    mutationFn: ({ sessionId: targetSessionId, level }: { sessionId: string; level: number }) => api<TutorHintResponse>(`/student/tutor/sessions/${targetSessionId}/hint`, {
      method: 'POST', body: jsonBody({ level }),
    }),
    onSuccess: (result, variables) => {
      const queryKey = ['tutor-messages', variables.sessionId]
      setHintLevel(Math.min(HINT_STEPS.length, variables.level + 1))
      setHintLabels((current) => ({ ...current, [result.assistant_message.id]: result.level }))
      queryClient.setQueryData<{ id: string; messages: TutorMessageInfo[] }>(queryKey, (current) => {
        const byId = new Map((current?.messages || []).map((item) => [item.id, item]))
        byId.set(result.assistant_message.id, result.assistant_message)
        return { id: variables.sessionId, messages: [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)) }
      })
      setResponseError((current) => current?.sessionId === variables.sessionId ? null : current)
      void queryClient.invalidateQueries({ queryKey })
    },
    onError: (error, variables) => setResponseError({ sessionId: variables.sessionId, message: error.message }),
  })
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' })
  }, [sessionId, messages.data, sendMessage.isPending, requestHint.isPending, responseError])
  if (path.isLoading || sessions.isLoading || (sessionId && messages.isLoading)) return <LoadingState />
  if (path.isError || sessions.isError || messages.isError) return <ErrorState message="No pudimos cargar la sesión del tutor." retry={() => { void path.refetch(); void sessions.refetch(); if (sessionId) void messages.refetch() }} />
  const aiReady = sessions.data!.ai_configured
  const skills = path.data!.units.flatMap((unit) => unit.skills.map((skill) => ({ ...skill, unitTitle: unit.title })))
  const currentSession = sessions.data!.sessions.find((session) => session.id === sessionId)
  const activeSkill = skills.find((skill) => skill.id === currentSession?.skill_id)
  const currentMessages = messages.data?.messages || []
  const waitingForTutor = sendMessage.isPending && sendMessage.variables?.sessionId === sessionId
  const waitingForHint = requestHint.isPending && requestHint.variables?.sessionId === sessionId
  const currentResponseError = responseError?.sessionId === sessionId ? responseError.message : ''
  const busy = sendMessage.isPending || requestHint.isPending || sendCooldown
  const hintsUsed = Math.min(HINT_STEPS.length, hintLevel)
  const sourceMap = new Map<string, TutorMessageInfo['citations'][number]>()
  for (const item of currentMessages) {
    for (const citation of item.citations) sourceMap.set(`${citation.material_id}:${citation.chunk_index}`, citation)
  }
  const sources = [...sourceMap.values()]

  function submitContent(content: string) {
    const trimmed = content.trim()
    const now = Date.now()
    if (!trimmed || !aiReady || busy || now - lastSentAt.current < 2000) return
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
      content: trimmed,
      citations: [],
      created_at: new Date(now).toISOString(),
    }
    queryClient.setQueryData<{ id: string; messages: TutorMessageInfo[] }>(
      ['tutor-messages', sessionId],
      (current) => ({ id: sessionId, messages: [...(current?.messages || []), optimisticMessage] }),
    )
    setMessage('')
    setResponseError(null)
    sendMessage.mutate({ sessionId, content: trimmed, optimisticId })
  }

  function submitMessage() {
    submitContent(message)
  }

  return <>
    <PageHeader title="Tutor socrático" description="Recibe preguntas y pistas guiadas. El tutor te ayuda a razonar, no decide por sí solo si dominas una habilidad." actions={sessionId ? <Button variant="outline" onClick={() => createSession.mutate()} disabled={!aiReady || createSession.isPending}>Nueva conversación</Button> : undefined} />
    {!aiReady && <div className="inline-alert alert-warning"><MessageCircle size={17} /><span>El tutor está desactivado hasta que se configure el proveedor OpenAI-compatible en el servidor.</span></div>}
    {!sessionId ? <Card><div className="card-content tutor-start"><div className="tutor-start-icon"><MessageCircle size={22} /></div><h2>Comienza con una habilidad</h2><p>Elige un tema del curso o inicia una conversación general. Las respuestas se apoyan en los materiales procesados cuando hay fuentes disponibles.</p><div className="tutor-start-controls"><Field label="Habilidad"><Select value={skillId} onChange={(event) => setSkillId(event.target.value)}><option value="">Sin habilidad específica</option>{skills.map((skill) => <option value={skill.id} key={skill.id}>{skill.unitTitle} · {skill.title}</option>)}</Select></Field><Button onClick={() => createSession.mutate()} disabled={!aiReady || createSession.isPending}>Iniciar conversación</Button></div></div></Card> : <div className="tutor-layout">
      <Card className="tutor-chat-card">
        <div className="tutor-session-toolbar"><div><Badge tone={aiReady ? 'success' : 'warning'}>{aiReady ? 'Tutor listo' : 'Proveedor pendiente'}</Badge><span>{activeSkill?.title || 'Conversación general'}</span></div><Select aria-label="Cambiar conversación" value={sessionId} onChange={(event) => setSessionId(event.target.value)}>{sessions.data!.sessions.map((session) => <option value={session.id} key={session.id}>{new Date(session.started_at).toLocaleString('es')}</option>)}</Select></div>
        <div className="tutor-message-list" aria-live="polite">
          {currentMessages.length ? currentMessages.map((item) => <article className={`tutor-message tutor-message-${item.role}${hintLabels[item.id] !== undefined ? ' tutor-message-hint' : ''}`} key={item.id}>
            <div className="tutor-message-role">{item.role === 'user' ? 'Tú' : hintLabels[item.id] !== undefined ? 'Pista' : 'Tutor'}</div>
            {hintLabels[item.id] !== undefined && <div className="tutor-hint-label"><Lightbulb size={12} />{HINT_STEPS[hintLabels[item.id]]}</div>}
            <p>{item.content}</p>
            {!!item.citations.length && <div className="tutor-citations"><span>Fuentes del curso</span>{item.citations.map((citation) => <span className="filter-chip" key={`${citation.material_id}:${citation.chunk_index}`}>{citation.material_name}{citation.page_number ? ` · pág. ${citation.page_number}` : ''}</span>)}</div>}
          </article>) : <EmptyState icon={MessageCircle} title="La conversación está lista" description="Escribe qué estás intentando comprender. El tutor empezará con una pregunta, no con la respuesta final." />}
          {waitingForTutor && <article className="tutor-message tutor-message-assistant tutor-message-pending" role="status"><div className="tutor-message-role">Tutor</div><p><LoaderCircle className="spin" size={14} />Preparando una respuesta…</p></article>}
          {waitingForHint && <article className="tutor-message tutor-message-assistant tutor-message-pending" role="status"><div className="tutor-message-role">Pista</div><p><LoaderCircle className="spin" size={14} />Preparando una pista…</p></article>}
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
          <Button type="submit" disabled={!aiReady || !message.trim() || busy} aria-label="Enviar mensaje">{sendMessage.isPending ? <><LoaderCircle className="spin" size={15} />Pensando…</> : <><Send size={16} />Enviar</>}</Button>
        </form>
        <div className="tutor-composer-actions">
          <Button type="button" variant="ghost" size="small" onClick={() => requestHint.mutate({ sessionId, level: hintsUsed })} disabled={!aiReady || busy || hintsUsed >= HINT_STEPS.length}>
            {requestHint.isPending ? <LoaderCircle className="spin" size={14} /> : <Lightbulb size={14} />}
            {hintsUsed >= HINT_STEPS.length ? 'Pistas agotadas' : hintsUsed === 0 ? 'Pedir pista' : `Siguiente pista`}
          </Button>
          <Button type="button" variant="ghost" size="small" onClick={() => submitContent('No lo sé')} disabled={!aiReady || busy}>
            <CircleHelp size={14} />No lo sé
          </Button>
        </div>
        <p className="tutor-composer-hint" aria-live="polite">{sendMessage.isPending ? 'Tu mensaje ya está en la conversación; el tutor está preparando una respuesta.' : sendCooldown ? 'Espera un momento antes de enviar otro mensaje.' : 'Enter envía · Shift + Enter agrega una línea nueva'}</p>
      </Card>

      <aside className="tutor-context">
        <Card>
          <div className="card-heading"><h2>Contexto de la sesión</h2></div>
          <div className="card-content tutor-context-body">
            {activeSkill ? <div className="tutor-context-skill">
              <ProgressRing value={activeSkill.probability ?? 0} size={56} stroke={6} />
              <div><strong>{activeSkill.title}</strong><small className="muted-text">{activeSkill.unitTitle} · {activeSkill.probability === null ? 'sin evidencia' : `${Math.round(activeSkill.probability * 100)}% de dominio estimado`}</small></div>
            </div> : <p className="muted-text text-small">Conversación general. Elige una habilidad al iniciar una nueva conversación para enfocar las pistas.</p>}

            <div className="tutor-context-block">
              <span className="tutor-context-label">Escalera de ayuda</span>
              <div className="tutor-ladder">{HINT_STEPS.map((label, index) => <div className="tutor-ladder-step" key={label}>
                <div className="progress-track"><i style={{ width: hintsUsed > index ? '100%' : '0%' }} /></div>
                <small className={hintsUsed > index ? 'is-used' : ''}>{label}</small>
              </div>)}</div>
            </div>

            <div className="tutor-context-block">
              <span className="tutor-context-label">Fuentes recuperadas</span>
              {sources.length ? <div className="tutor-context-sources">{sources.map((source) => <span className="filter-chip" key={`${source.material_id}:${source.chunk_index}`}><BookOpen size={11} />{source.material_name}{source.page_number ? ` · p. ${source.page_number}` : ''}</span>)}</div>
                : <p className="muted-text text-small">Aún no hay fuentes citadas. Aparecerán cuando el tutor use material indizado del curso.</p>}
            </div>
          </div>
        </Card>
        <Card>
          <div className="card-heading"><h2>Reglas del tutor</h2></div>
          <div className="card-content tutor-rules">
            <div><Lock size={15} /><span>No revela la solución: usa la escalera de pistas para guiarte.</span></div>
            <div><Target size={15} /><span>Evalúa tu razonamiento, no solo el resultado final.</span></div>
            <div><Gauge size={15} /><span>El dominio lo estima el modelo con evidencias; el tutor no decide si dominas una habilidad.</span></div>
          </div>
        </Card>
      </aside>
    </div>}
  </>
}
