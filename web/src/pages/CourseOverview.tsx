import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, ClipboardCheck, FileText, Layers3, Settings2, Users } from 'lucide-react'
import { api } from '../api'
import type { Course, Configuration, CurriculumUnit, Material } from '../types'
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui'

export function CourseOverviewPage() {
  const { courseId = '' } = useParams()
  const course = useQuery({ queryKey: ['course', courseId], queryFn: () => api<Course>(`/courses/${courseId}`), enabled: !!courseId })
  const curriculum = useQuery({ queryKey: ['curriculum', courseId], queryFn: () => api<CurriculumUnit[]>(`/courses/${courseId}/curriculum`), enabled: !!courseId })
  const materials = useQuery({ queryKey: ['materials', courseId], queryFn: () => api<Material[]>(`/courses/${courseId}/materials`), enabled: !!courseId })
  const config = useQuery({ queryKey: ['configuration'], queryFn: () => api<Configuration>('/configuration') })

  if (course.isLoading || curriculum.isLoading || materials.isLoading || config.isLoading) return <LoadingState />
  if (course.isError || curriculum.isError || materials.isError || config.isError) return <ErrorState message="No pudimos cargar la información del curso." retry={() => { void course.refetch(); void curriculum.refetch(); void materials.refetch(); void config.refetch() }} />
  const item = course.data!
  const units = curriculum.data!
  const docs = materials.data!
  const checklist = [
    { done: units.length > 0, text: 'Estructura académica', detail: units.length ? `${units.length} unidades` : 'Agrega unidades, temas y habilidades', route: 'curriculum', icon: Layers3 },
    { done: docs.some((material) => material.status === 'ready'), text: 'Materiales de curso', detail: docs.length ? `${docs.length} recursos · ${docs.filter((material) => material.status === 'ready').length} listos` : 'Sube documentos o añade enlaces', route: 'materials', icon: FileText },
    { done: config.data!.ai_configured, text: 'Proveedor de IA', detail: config.data!.ai_configured ? config.data!.chat_model : 'Configúralo en el entorno del servidor', route: 'settings', icon: Settings2 },
  ]

  return <>
    <PageHeader title={item.title} description={`${item.code || 'Sin código'}${item.academic_period ? ` · ${item.academic_period}` : ''}`} actions={<Link className="button button-outline" to={`/teacher/courses/${courseId}/settings`}><Settings2 size={16} />Configuración</Link>} />
    <div className="course-overview-layout">
      <div className="course-overview-main">
        <Card className="course-welcome"><div className="course-welcome-icon"><BookOpen size={22} /></div><div><Badge tone={item.status === 'active' ? 'success' : 'neutral'}>{item.status === 'active' ? 'Activo' : 'Borrador'}</Badge><h2>{item.description || 'Tu espacio de curso está listo para configurarse.'}</h2><p>{item.credits ? `${item.credits} créditos` : 'Créditos sin definir'}{item.academic_period ? ` · ${item.academic_period}` : ''}</p></div></Card>
        <div className="stats-grid stats-grid-compact">
          <SummaryCard icon={Layers3} title="Unidades" value={String(units.length)} route="curriculum" />
          <SummaryCard icon={FileText} title="Materiales" value={String(docs.length)} route="materials" />
          <SummaryCard icon={Users} title="Estudiantes" value={String(item.student_count)} route="students" />
          <SummaryCard icon={ClipboardCheck} title="Por revisar" value={String(item.pending_reviews || 0)} route="reviews" />
        </div>
        <Card><div className="card-heading card-heading-row"><div><h2>Estructura académica</h2><p className="muted-text text-small">Unidades y resultados de aprendizaje.</p></div><Link className="subtle-link" to={`/teacher/courses/${courseId}/curriculum`}>Editar estructura <ArrowRight size={14} /></Link></div>
          <div className="card-content overview-units">{units.length ? units.slice(0, 5).map((unit, index) => <div className="overview-unit" key={unit.id}><span className="unit-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{unit.title}</strong><p>{unit.outcome || 'Sin resultado de aprendizaje definido'}</p></div><span className="muted-text text-small">{unit.topics.length} temas</span></div>) : <EmptyState icon={Layers3} title="Sin unidades definidas" description="Organiza el curso en unidades para vincular temas, habilidades y materiales." action={<Link className="button button-primary" to={`/teacher/courses/${courseId}/curriculum`}>Definir estructura</Link>} />}</div>
        </Card>
      </div>
      <aside className="course-overview-aside">
        <Card><div className="card-heading"><h2>Preparación del curso</h2><p className="muted-text text-small">Completa cada punto a medida que configuras el espacio.</p></div><div className="card-content readiness-checklist">{checklist.map(({ done, text, detail, route, icon: Icon }) => <Link className="checklist-row" to={`/teacher/courses/${courseId}/${route}`} key={route}><span className={`checklist-icon${done ? ' is-done' : ''}`}><Icon size={16} /></span><span><strong>{text}</strong><small>{detail}</small></span><ArrowRight size={14} /></Link>)}</div></Card>
        <Card><div className="card-heading"><h2>Acciones del curso</h2></div><div className="card-content quick-actions"><Link to={`/teacher/courses/${courseId}/materials`}><FileText size={17} />Administrar materiales<ArrowRight size={14} /></Link><Link to={`/teacher/courses/${courseId}/students`}><Users size={17} />Ver estudiantes<ArrowRight size={14} /></Link><Link to={`/teacher/courses/${courseId}/reviews`}><ClipboardCheck size={17} />Revisar entregas<ArrowRight size={14} /></Link></div></Card>
      </aside>
    </div>
  </>
}

function SummaryCard({ icon: Icon, title, value, route }: { icon: React.ComponentType<{ size?: number }>; title: string; value: string; route: string }) {
  const { courseId } = useParams()
  return <Link className="content-card summary-card" to={`/teacher/courses/${courseId}/${route}`}><div className="summary-card-top"><span>{title}</span><Icon size={16} /></div><strong>{value}</strong></Link>
}
