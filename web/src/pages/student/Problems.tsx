import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, ClipboardCheck, FileText, Puzzle, Target } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'

type TransferAssessment = { id: string; title: string; description: string; kind: string; question_count: number }
type Submission = {
  id: string; question: string; response: string; suggested_score: number | null
  final_score: number | null; teacher_comment: string | null
  status: 'pending' | 'reviewed'; created_at: string
}
type SubmissionPage = { items: Submission[]; total: number; limit: number; offset: number }

export function StudentProblemsPage() {
  const { courseId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const assessments = useQuery({ queryKey: ['student-assessments', courseId], queryFn: () => api<TransferAssessment[]>(`/student/courses/${courseId}/assessments`) })
  const submissions = useQuery({ queryKey: ['student-submissions', courseId, 0], queryFn: () => api<SubmissionPage>(`/student/courses/${courseId}/submissions?limit=50`) })
  const start = useMutation({
    mutationFn: (assessmentId: string) => api<{ id: string }>(`/student/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    onSuccess: (attempt) => navigate(`/student/attempts/${attempt.id}`),
    onError: (error) => toast(error.message, 'error'),
  })
  if (assessments.isLoading || submissions.isLoading) return <LoadingState />
  if (assessments.isError || submissions.isError) return <ErrorState message="No pudimos cargar los problemas." retry={() => { void assessments.refetch(); void submissions.refetch() }} />
  const problems = assessments.data!.filter((assessment) => assessment.kind === 'transfer')
  const items = submissions.data!.items

  return <div className="student-view">
    <PageHeader title="Problemas de transferencia" description="Casos nuevos para aplicar lo aprendido. La nota automática queda pendiente hasta que tu docente la confirme." />
    {problems.length ? <div className="problem-grid">{problems.map((problem) => <Card key={problem.id}>
      <div className="problem-card">
        <span className="problem-icon"><Puzzle size={20} /></span>
        <div className="problem-copy">
          <Badge tone="info">Transferencia</Badge>
          <h2>{problem.title}</h2>
          <p className="muted-text text-small">{problem.description || 'Aplica los conceptos del curso en una situación distinta a los ejemplos.'}</p>
          <small className="muted-text">{problem.question_count} {problem.question_count === 1 ? 'pregunta' : 'preguntas'} · revisión docente</small>
        </div>
        <Button disabled={start.isPending} onClick={() => start.mutate(problem.id)}>{start.isPending ? 'Preparando…' : 'Resolver'}<ArrowRight size={15} /></Button>
      </div>
    </Card>)}</div>
      : <Card><EmptyState icon={Puzzle} title="Aún no hay problemas publicados" description="Tu docente publicará casos de transferencia cuando el curso esté listo." /></Card>}

    <Card>
      <div className="card-heading"><h2>Tus entregas</h2><p className="muted-text text-small">Sugerencias automáticas y notas confirmadas de tus respuestas abiertas.</p></div>
      <div className="card-content">
        {items.length ? <div className="submission-list">{items.map((item) => <div className="submission-row" key={item.id}>
          <span className={`submission-mark${item.status === 'reviewed' ? ' is-reviewed' : ''}`}>{item.status === 'reviewed' ? <ClipboardCheck size={16} /> : <FileText size={16} />}</span>
          <div className="submission-copy">
            <strong>{item.question}</strong>
            <p className="muted-text text-small">{item.response}</p>
            {item.teacher_comment && <blockquote>{item.teacher_comment}</blockquote>}
          </div>
          <div className="submission-score">
            <Badge tone={item.status === 'reviewed' ? 'success' : 'warning'}>{item.status === 'reviewed' ? 'Revisada' : 'Pendiente'}</Badge>
            <span>{item.status === 'reviewed' ? `${item.final_score ?? '—'}/20` : item.suggested_score !== null ? `${item.suggested_score}/20 sugerido` : 'Sin nota'}</span>
            <small className="muted-text">{new Date(item.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</small>
          </div>
        </div>)}</div>
          : <EmptyState icon={Target} title="Aún no tienes entregas" description="Cuando respondas un problema abierto, aparecerá aquí con su estado de revisión." />}
      </div>
    </Card>
  </div>
}
