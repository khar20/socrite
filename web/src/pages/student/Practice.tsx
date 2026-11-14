import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, ClipboardCheck, Layers3, Lock, Sparkles, Target, X } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'
import type { NextActivity, PathData, PracticeAssessment } from './types'

const KIND_LABELS: Record<string, string> = {
  diagnostic: 'Diagnóstico',
  practice: 'Práctica',
  quiz: 'Evaluación',
  transfer: 'Transferencia',
}

function percent(value: number | null | undefined) {
  return Math.round((value ?? 0) * 100)
}

export function StudentPracticePage() {
  const { courseId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const skillId = searchParams.get('skill_id') || ''
  const unitId = searchParams.get('unit_id') || ''
  const filterQuery = skillId ? `?skill_id=${skillId}` : unitId ? `?unit_id=${unitId}` : ''

  const path = useQuery({ queryKey: ['student-path', courseId], queryFn: () => api<PathData>(`/student/courses/${courseId}/path`) })
  const next = useQuery({ queryKey: ['student-next-activity', courseId], queryFn: () => api<NextActivity>(`/student/courses/${courseId}/next-activity`) })
  const assessments = useQuery({
    queryKey: ['student-assessments', courseId, skillId, unitId],
    queryFn: () => api<PracticeAssessment[]>(`/student/courses/${courseId}/assessments${filterQuery}`),
  })
  const start = useMutation({
    mutationFn: (assessmentId: string) => api<{ id: string }>(`/student/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    onSuccess: (attempt) => navigate(`/student/attempts/${attempt.id}`),
    onError: (error) => toast(error.message, 'error'),
  })

  if (path.isLoading || next.isLoading || assessments.isLoading) return <LoadingState />
  if (path.isError || next.isError || assessments.isError) return <ErrorState message="No pudimos cargar la práctica." retry={() => { void path.refetch(); void next.refetch(); void assessments.refetch() }} />

  const units = path.data!.units
  const activeSkill = skillId ? units.flatMap((unit) => unit.skills).find((skill) => skill.id === skillId) : undefined
  const activeUnit = unitId ? units.find((unit) => unit.id === unitId) : undefined
  const filtering = Boolean(skillId || unitId)
  const activity = next.data!.activity
  const skills = units.flatMap((unit) => unit.skills.map((skill) => ({ ...skill, unitTitle: unit.title })))
  const available = assessments.data!.filter((item) => item.kind !== 'transfer' && item.learning_technique !== 'spaced_repetition')
  const groups = [
    { title: 'Prácticas', description: 'Ejercita habilidades y recibe evidencia para orientar tu estudio.', items: available.filter((item) => item.kind === 'practice' || item.kind === 'diagnostic') },
    { title: 'Evaluaciones', description: 'Comprueba lo aprendido en cuestionarios y evaluaciones publicadas.', items: available.filter((item) => item.kind === 'quiz' || (!['practice', 'diagnostic', 'transfer'].includes(item.kind) && item.learning_technique !== 'spaced_repetition')) },
  ].filter((group) => group.items.length)

  function clearFilter() {
    navigate(`/student/courses/${courseId}/practice`)
  }

  return <div className="student-view">
    <PageHeader title="Prácticas y evaluaciones" description="Responde actividades publicadas para practicar y comprobar lo que sabes." help="Las prácticas y el diagnóstico te ayudan a ejercitar y orientar el estudio; las evaluaciones comprueban el aprendizaje. El repaso espaciado programa recuperaciones breves y los problemas de transferencia te piden aplicar lo aprendido en casos nuevos." />

    <div className="practice-note"><Lock size={17} /><div><strong>Sin apuntes.</strong> Si dudas, indícalo: tu nivel de confianza también es evidencia para tu metacognición.</div></div>

    {filtering && <Card className="practice-filter">
      <div>
        <span className="muted-text text-small">Filtrando actividades por</span>
        <strong>{activeSkill?.title || activeUnit?.title || 'tu selección'}</strong>
        {activeUnit && !activeSkill && <small className="muted-text">Unidad {activeUnit.position}</small>}
      </div>
      <Button variant="outline" size="small" onClick={clearFilter}><X size={14} />Quitar filtro</Button>
    </Card>}

    <div className="proto-grid proto-grid-2">
      <Card className="practice-option">
        <span className="practice-option-icon"><Target size={20} /></span>
        <h2>{filtering ? 'Practicar la selección' : 'Práctica adaptativa'}</h2>
        <p className="muted-text text-small">{activity
          ? `El motor adaptativo eligió «${activity.title}» según tus habilidades con menor dominio.`
          : 'El motor adaptativo elegirá la siguiente actividad cuando haya preguntas publicadas para tus habilidades.'}</p>
        {activity ? <Button disabled={start.isPending} onClick={() => start.mutate(activity.id)}>
          {start.isPending ? 'Preparando…' : 'Comenzar'}<ArrowRight size={15} />
        </Button> : <Link className="button button-outline" to={`/student/courses/${courseId}/tutor`}>Reforzar con el tutor</Link>}
      </Card>

      <Card className="practice-option">
        <span className="practice-option-icon"><Layers3 size={20} /></span>
        <h2>Diagnóstico por unidad</h2>
        <p className="muted-text text-small">Identifica tus conocimientos previos unidad por unidad, con preguntas de cada habilidad.</p>
        <div className="topic-chips">
          {units.map((unit) => <Link className="practice-chip" key={unit.id}
            to={`/student/courses/${courseId}/practice?unit_id=${unit.id}`}>
            Unidad {unit.position} · {unit.title}
          </Link>)}
          {!units.length && <span className="muted-text text-small">Aún no hay unidades publicadas.</span>}
        </div>
      </Card>
    </div>

    <Card>
      <div className="card-heading"><h2>Actividades por habilidad</h2><p className="muted-text text-small">Elige una habilidad para filtrar las prácticas y evaluaciones que la trabajan.</p></div>
      <div className="card-content">
        {skills.length ? <div className="topic-chips">{skills.map((skill) => <Link key={skill.id}
          className={`practice-chip${skill.id === skillId ? ' is-active' : ''}`}
          to={`/student/courses/${courseId}/practice?skill_id=${skill.id}`}>
          {skill.title}<b>{percent(skill.probability)}%</b>
        </Link>)}</div> : <p className="muted-text text-small">Tu docente todavía no ha publicado habilidades para este curso.</p>}
      </div>
    </Card>

    {groups.length ? groups.map((group) => <Card key={group.title}>
      <div className="card-heading"><h2>{group.title}</h2><p className="muted-text text-small">{group.description}</p></div>
      <div className="card-content"><div className="practice-list">{group.items.map((assessment) => <div className="practice-row" key={assessment.id}>
          <span className="practice-row-icon"><ClipboardCheck size={18} /></span>
          <div className="practice-row-copy">
            <div className="practice-row-heading">
              <Badge tone={assessment.kind === 'diagnostic' ? 'info' : assessment.kind === 'quiz' ? 'warning' : 'neutral'}>{KIND_LABELS[assessment.kind] || 'Práctica'}</Badge>
              <Badge>{assessment.question_count} {assessment.question_count === 1 ? 'pregunta' : 'preguntas'}</Badge>
            </div>
            <strong>{assessment.title}</strong>
            <p className="muted-text text-small">{assessment.description || 'Responde y revisa qué conceptos conviene practicar.'}</p>
            {!!assessment.skills.length && <div className="topic-chips">{assessment.skills.slice(0, 4).map((skill) => <span className="topic-chip" key={skill.id}><Target size={12} />{skill.title}</span>)}</div>}
          </div>
          <Button disabled={start.isPending} onClick={() => start.mutate(assessment.id)}>{start.isPending ? 'Preparando…' : 'Comenzar'}<ArrowRight size={15} /></Button>
        </div>)}</div></div>
    </Card>) : <Card><EmptyState icon={Sparkles} title={filtering ? 'Sin actividades para esta selección' : 'No hay prácticas ni evaluaciones disponibles'}
      description={filtering ? 'Tu docente todavía no ha publicado actividades para esta habilidad o unidad.' : 'Las prácticas y evaluaciones aparecerán aquí cuando tu docente las publique. Repaso espaciado y transferencia tienen secciones propias.'}
      action={filtering ? <Button variant="outline" onClick={clearFilter}>Ver todas</Button> : undefined} /></Card>}
  </div>
}
