import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CheckCircle2, Flame, Repeat2, Sparkles, Target } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { useAuth } from '../../auth-context'
import { ProgressRing } from '../../components/ProgressRing'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Stat } from '../../components/ui'
import type { HomeData } from './types'

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'
}

function percent(value: number | null) {
  return value === null ? 0 : Math.round(value * 100)
}

function activityLabel(kind: string) {
  if (kind === 'diagnostic') return 'Iniciar diagnóstico'
  if (kind === 'transfer') return 'Resolver problema'
  return 'Comenzar práctica'
}

export function StudentHomePage() {
  const { courseId = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const home = useQuery({ queryKey: ['student-home', courseId], queryFn: () => api<HomeData>(`/student/courses/${courseId}/home`) })
  const startActivity = useMutation({
    mutationFn: (assessmentId: string) => api<{ id: string }>(`/student/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    onSuccess: (attempt) => navigate(`/student/attempts/${attempt.id}`),
  })
  if (home.isLoading) return <LoadingState />
  if (home.isError) return <ErrorState message="No pudimos cargar tu inicio." retry={() => void home.refetch()} />
  const data = home.data!
  const { summary, next_activity: next } = data
  const firstName = profile?.first_name || 'estudiante'
  const activity = next.activity

  return <div className="student-view">
    <PageHeader
      title={`${greeting()}, ${firstName}`}
      description={`${data.units.length} unidades · ${summary.total_skills} habilidades · dominio estimado con BKT`}
    />
    <div className="proto-grid proto-grid-4">
      <Stat icon={Target} label="Dominio promedio" value={`${percent(summary.average_mastery)}%`} detail="estimación BKT" />
      <Stat icon={Repeat2} label="Repasos para hoy" value={summary.due_reviews} detail={summary.due_reviews ? 'conceptos por recordar' : 'todo al día'} />
      <Stat icon={Flame} label="Racha de estudio" value={`${summary.streak_days} d`} detail="días consecutivos" />
      <Stat icon={CheckCircle2} label="Habilidades dominadas" value={`${summary.mastered_skills}/${summary.total_skills}`} detail="dominio ≥ 85%" />
    </div>

    <Card className="next-activity-panel">
      <div className="next-activity-row">
        <span className="next-activity-icon"><Sparkles size={22} /></span>
        <div className="next-activity-copy">
          <Badge tone="info">Siguiente mejor actividad</Badge>
          <h2>{activity?.title || 'Explora tu ruta de aprendizaje'}</h2>
          <p className="muted-text text-small">{next.reason}</p>
          {next.skill && <small className="muted-text">{next.skill.unit} · {next.skill.title}{next.skill.probability !== null ? ` · dominio ${percent(next.skill.probability)}%` : ''}</small>}
        </div>
        {activity ? <Button size="large" disabled={startActivity.isPending} onClick={() => startActivity.mutate(activity.id)}>
          {startActivity.isPending ? 'Preparando…' : activityLabel(activity.kind)}<ArrowRight size={16} />
        </Button> : <Link className="button button-outline button-large" to={`/student/courses/${courseId}/path`}>Ver mi ruta<ArrowRight size={16} /></Link>}
      </div>
      {startActivity.isError && <div className="inline-alert alert-error" role="alert">{startActivity.error.message}</div>}
    </Card>

    <div className="proto-grid proto-grid-21">
      <Card>
        <div className="card-heading card-heading-row">
          <div><h2>Progreso por unidad</h2><p className="muted-text text-small">Dominio estimado en cada unidad del curso.</p></div>
          <Link className="subtle-link" to={`/student/courses/${courseId}/path`}>Ver ruta<ArrowRight size={14} /></Link>
        </div>
        <div className="card-content unit-progress-list">
          {data.units.length ? data.units.map((unit) => <div className="unit-progress-row" key={unit.id}>
            <ProgressRing value={unit.mastery ?? 0} />
            <div className="unit-progress-copy">
              <strong>Unidad {unit.position} · {unit.title}</strong>
              <small className="muted-text">{unit.skill_count} {unit.skill_count === 1 ? 'habilidad' : 'habilidades'}</small>
            </div>
            <Link className="button button-outline button-small" to={`/student/courses/${courseId}/path#unit-${unit.id}`}>Continuar</Link>
          </div>) : <EmptyState icon={BookOpen} title="Ruta en preparación" description="Tu docente todavía no ha publicado unidades para este curso." />}
        </div>
      </Card>

      <div className="student-side-column">
        <Card>
          <div className="card-heading card-heading-row">
            <h2>Repasos para hoy</h2>
            {summary.due_reviews > 0 && <Badge tone="warning">{summary.due_reviews}</Badge>}
          </div>
          <div className="card-content">
            {data.due_skills.length ? <>
              {data.due_skills.slice(0, 4).map((item) => <div className="due-review-row" key={item.skill_id}>
                <span className={`due-review-mark${(item.probability ?? 0) >= 0.5 ? ' is-strong' : ''}`} />
                <div><strong>{item.skill}</strong><small className="muted-text">{item.unit}</small></div>
                <span className="muted-text text-small">{percent(item.probability)}%</span>
              </div>)}
              <Link className="button button-outline button-small due-review-action" to={`/student/courses/${courseId}/review`}>Iniciar repaso<ArrowRight size={14} /></Link>
            </> : <p className="muted-text text-small">No tienes repasos pendientes. Sigue practicando para programar nuevos.</p>}
          </div>
        </Card>

        <Card>
          <div className="card-heading"><h2>Actividad reciente</h2></div>
          <div className="card-content">
            {data.recent_activity.length ? <div className="recent-activity-list">{data.recent_activity.map((item, index) =>
              <div className="recent-activity-row" key={`${item.skill}-${item.created_at}-${index}`}>
                <span className={`recent-activity-dot${item.is_correct ? ' is-correct' : ''}`} />
                <div><strong>{item.skill}</strong><small className="muted-text">{item.is_transfer ? 'Transferencia' : 'Práctica'} · {new Date(item.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</small></div>
                <Badge tone={item.is_correct ? 'success' : 'warning'}>{item.is_correct ? 'Correcta' : 'Por reforzar'}</Badge>
              </div>)}
            </div> : <p className="muted-text text-small">Aún no hay actividad registrada. Empieza con una práctica o el tutor.</p>}
          </div>
        </Card>
      </div>
    </div>
  </div>
}
