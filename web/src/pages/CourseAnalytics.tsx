import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Brain, Clock3, Target, Users } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, PaginationControls, Stat, TableWrap } from '../components/ui'

type AnalyticsStudent = {
  id: string; name: string; email: string; is_active: boolean
  mastery_average: number | null; evidence_count: number; evidence_accuracy: number | null
  last_evidence_at: string | null; transfer_count: number; transfer_accuracy: number | null
  review_count: number; average_review_rating: number | null; on_time_reviews: number
}
type HeatSkill = {
  id: string; title: string; unit: string
  cells: { student_id: string; probability: number | null; observations: number }[]
}
type CourseAnalytics = {
  students: AnalyticsStudent[]
  skills: { id: string; title: string; unit: string }[]
  heatmap: HeatSkill[]
  pagination: { total: number; limit: number; offset: number }
  summary: {
    students: number; average_mastery: number | null; transfer_evidence: number
    transfer_accuracy: number | null; completed_retention_reviews: number; overdue_reviews: number
  }
}

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function accuracyLabel(value: number | null) {
  return value === null ? 'Sin resultados' : `${Math.round(value * 100)}% de respuestas correctas`
}

export function CourseAnalyticsPage() {
  const { courseId = '' } = useParams()
  const [offset, setOffset] = useState(0)
  const limit = 25
  const report = useQuery({
    queryKey: ['course-analytics', courseId, offset],
    queryFn: () => api<CourseAnalytics>(`/courses/${courseId}/analytics?limit=${limit}&offset=${offset}`),
  })

  if (report.isLoading) return <LoadingState />
  if (report.isError) return <ErrorState message="No se pudo cargar la analítica del curso." retry={() => void report.refetch()} />
  const data = report.data!

  return <>
    <PageHeader title="Analítica del aprendizaje" description="Evidencias de dominio, transferencia y repasos. Las estimaciones orientan la enseñanza; no son calificaciones definitivas." />
    <div className="stats-grid cohort-summary">
      <Stat icon={Users} label="Estudiantes" value={data.summary.students} detail="matriculados en el curso" />
      <Stat icon={Brain} label="Dominio estimado" value={percent(data.summary.average_mastery)} detail="promedio de habilidades con evidencia" />
      <Stat icon={Activity} label="Transferencia" value={accuracyLabel(data.summary.transfer_accuracy)} detail={`${data.summary.transfer_evidence} evidencias en problemas nuevos`} />
      <Stat icon={Clock3} label="Repasos" value={data.summary.overdue_reviews} detail={`${data.summary.completed_retention_reviews} autoevaluaciones a tiempo`} />
    </div>

    <Card className="cohort-heatmap-card">
      <div className="card-heading"><h2>Mapa de evidencias por habilidad</h2><p className="muted-text text-small">Cada celda muestra la probabilidad BKT más reciente y cuántas observaciones la sustentan. Sin datos no significa falta de dominio. Desplázate horizontalmente para comparar todo el grupo.</p></div>
      <div className="card-content">
        {!data.students.length ? <EmptyState icon={Users} title="Aún no hay estudiantes" description="Cuando se matriculen estudiantes, sus evidencias aparecerán por habilidad." /> : !data.skills.length ? <EmptyState icon={Target} title="Aún no hay habilidades" description="Agrega habilidades al currículo para empezar a seguir evidencias de dominio." /> : <TableWrap><thead><tr><th className="heatmap-skill-header">Habilidad</th>{data.students.map((student) => <th key={student.id} className="heatmap-student-header"><span>{student.name}</span><small>{student.is_active ? student.email : 'Cuenta suspendida'}</small></th>)}</tr></thead><tbody>{data.heatmap.map((skill) => <tr key={skill.id}><th scope="row" className="heatmap-skill-cell"><strong>{skill.title}</strong><small>{skill.unit}</small></th>{skill.cells.map((cell) => <td key={cell.student_id} className="heatmap-cell-wrap"><span className={`heatmap-cell ${cell.probability === null ? 'is-empty' : cell.probability < 0.4 ? 'is-low' : cell.probability < 0.7 ? 'is-building' : 'is-strong'}`} aria-label={`${skill.title}: ${percent(cell.probability)}, ${cell.observations} evidencias`} title={`${percent(cell.probability)} estimado · ${cell.observations} evidencias`}>
          <strong>{percent(cell.probability)}</strong><small>{cell.observations} evid.</small>
        </span></td>)}</tr>)}</tbody></TableWrap>}
        <PaginationControls total={data.pagination.total} limit={data.pagination.limit} offset={data.pagination.offset} onChange={setOffset} />
      </div>
    </Card>

    <Card className="cohort-retention-card"><div className="card-heading"><h2>Retención reportada</h2><p className="muted-text text-small">Basada en la autoevaluación del estudiante después del repaso.</p></div><div className="card-content analytics-summary-lines">
      <div><span>Repasos realizados a tiempo</span><strong>{data.summary.completed_retention_reviews}</strong></div>
      <div><span>Repasos pendientes</span><strong>{data.summary.overdue_reviews}</strong></div>
      <p className="analytics-caveat">Una valoración personal complementa, pero no sustituye, la evidencia de una evaluación.</p>
    </div></Card>

    <Card className="cohort-student-card"><div className="card-heading"><h2>Evidencias individuales</h2><p className="muted-text text-small">Respuestas, transferencia y autoevaluaciones registradas por estudiante.</p></div><div className="card-content">
      {!data.students.length ? <p className="muted-text text-small">Sin estudiantes matriculados.</p> : <div className="cohort-student-list">{data.students.map((student) => <div className="cohort-student-row" key={student.id}><div><strong>{student.name}</strong><small>{student.email}{!student.is_active && ' · Cuenta suspendida'}</small></div><div><span>Dominio {percent(student.mastery_average)}</span><small>{student.evidence_count} evidencias · {accuracyLabel(student.evidence_accuracy)}</small></div><div><span>Transferencia {accuracyLabel(student.transfer_accuracy)}</span><small>{student.transfer_count} evidencias · {student.review_count} repasos, {student.on_time_reviews} a tiempo</small></div><Badge tone={student.evidence_count ? 'success' : 'warning'}>{student.evidence_count ? 'Con evidencia' : 'Sin evidencia'}</Badge></div>)}</div>}
    </div></Card>
  </>
}
